import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PollerConfigStore, validateConfigPatch } from '../src/poller/config-store.js';
import type { BiliPollerConfig } from '../src/types.js';

let dir: string, file: string, persona: string, store: PollerConfigStore;
const defaults: BiliPollerConfig = { enableReply: true, enableAt: true, autoLikeOnReply: true,
  enableWhitelist: false, pollIntervalSeconds: 3, imageDownloadTimeoutMs: 10000,
  imageDownloadMaxBytes: 8 * 1024 * 1024, imageDownloadMaxCount: 5, whitelist: [], systemPrompt: 'default persona' };
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bili-config-'));
  file = path.join(dir, 'config.json'); persona = path.join(dir, 'persona.md');
  store = new PollerConfigStore(() => file, () => persona, defaults);
});
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(dir, { force: true, recursive: true }); });

describe('serialized validated poller configuration', () => {
  it('initializes missing files and preserves deliberately empty/external persona', async () => {
    expect((await store.load()).systemPrompt).toBe('default persona');
    await fs.writeFile(persona, '');
    expect(await store.prompt()).toBe('');
    expect((await store.load()).systemPrompt).toBe('');
    await fs.writeFile(persona, 'external edit');
    expect(await store.prompt()).toBe('external edit');
  });
  it('migrates legacy two-second cadence and ignores unknown fields', async () => {
    await fs.writeFile(file, JSON.stringify({ pollIntervalSeconds: 2, unknown: 'not persisted', systemPrompt: 'legacy' }));
    expect((await store.load()).pollIntervalSeconds).toBe(3);
    expect(await store.prompt()).toBe('legacy');
    await store.save({ enableAt: false });
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(saved).not.toHaveProperty('unknown');
    expect(saved).not.toHaveProperty('systemPrompt');
  });
  it.each(['{broken', 'null', '[]', '{"enableReply":"false"}', '{"whitelist":{}}', '{"pollIntervalSeconds":-1}'])('fails closed on corrupt config: %s', async raw => {
    await fs.writeFile(file, raw);
    await expect(store.load()).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe(raw);
  });
  it('does not overwrite unreadable persona as a default', async () => {
    await fs.mkdir(persona);
    await expect(store.load()).rejects.toThrow();
    expect((await fs.stat(persona)).isDirectory()).toBe(true);
  });
  it('serializes concurrent patches and updater-based whitelist mutations', async () => {
    await store.load();
    await Promise.all([
      store.save({ enableReply: false }), store.save({ enableAt: false }),
      store.save(current => ({ whitelist: [...current.whitelist, { mid: 1, uname: 'one', face: '' }] })),
      store.save(current => ({ whitelist: [...current.whitelist, { mid: 2, uname: 'two', face: '' }] })),
    ]);
    expect(store.get()).toMatchObject({ enableAt: false, enableReply: false, whitelist: [{ mid: 1 }, { mid: 2 }] });
    expect((await store.load()).whitelist).toHaveLength(2);
  });
  it('clones both input and output to prevent alias mutation', async () => {
    const users = [{ mid: 1, uname: 'one', face: '' }];
    const pending = store.save({ whitelist: users }); users[0].uname = 'mutated input';
    await pending;
    const output = store.get(); output.whitelist[0].uname = 'mutated output';
    expect(store.get().whitelist[0].uname).toBe('one');
  });
  it('fails before persistence for invalid workspace and unsafe UID', async () => {
    await expect(store.save({ targetWorkspacePath: 'relative' })).rejects.toThrow('绝对路径');
    await expect(store.save({ targetWorkspacePath: path.join(dir, 'missing') })).rejects.toThrow();
    await fs.writeFile(persona, 'file');
    await expect(store.save({ targetWorkspacePath: persona })).rejects.toThrow('不是目录');
    expect(() => validateConfigPatch({ whitelist: [{ mid: 9007199254740992, uname: 'x', face: '' }] })).toThrow();
  });
  it('rolls back settings if the second persona replacement fails, then permits retry', async () => {
    await store.load(); await store.save({ enableReply: false });
    const before = await fs.readFile(file, 'utf8');
    const rename = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      if (String(target) === persona) throw new Error('simulated persona storage failure');
      return rename(source, target);
    });
    await expect(store.save({ enableAt: false, systemPrompt: 'new' })).rejects.toThrow('保存轮询配置失败');
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect(await fs.readFile(persona, 'utf8')).toBe('default persona');
    expect(store.get().enableAt).toBe(true);
    vi.restoreAllMocks(); await store.save({ enableAt: false, systemPrompt: 'new' });
    expect(await store.prompt()).toBe('new');
  });
  it('reports rollback failure and refuses further writes until reload', async () => {
    await store.load(); await store.save({ enableReply: false });
    const rename = fs.rename; let calls = 0;
    vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      if (++calls > 1) throw new Error('storage unavailable');
      return rename(source, target);
    });
    await expect(store.save({ enableAt: false, systemPrompt: 'new' })).rejects.toThrow('回滚失败');
    await expect(store.save({ enableAt: true })).rejects.toThrow('回滚失败');
    await expect(store.prompt()).rejects.toThrow('回滚失败');
    vi.restoreAllMocks(); await store.load();
    await expect(store.save({ enableAt: true })).resolves.toMatchObject({ enableAt: true });
  });
});
