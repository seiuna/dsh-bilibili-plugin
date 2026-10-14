import fs from 'node:fs/promises';
import path from 'node:path';
import type { BiliPollerConfig, BiliWhitelistUser } from '../types.js';
import { isMissingFile, removeIfExists, writePrivateAtomic } from '../storage/atomic-file.js';
import { SerialTaskQueue } from '../storage/serial-task-queue.js';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('轮询配置必须为对象');
  return value as Record<string, unknown>;
}
function text(value: unknown, key: string, limit = 262_144): string {
  if (typeof value !== 'string' || value.includes('\0') || value.length > limit) throw new Error(`${key} 格式无效`);
  return value;
}
function integer(value: unknown, key: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${key} 超出有效整数范围`);
  return value;
}

/** Local file and programmatic callers get the same shape protection as HTTP callers. */
export function validateConfigPatch(value: unknown): Partial<BiliPollerConfig> {
  const input = object(value), patch: Partial<BiliPollerConfig> = {};
  for (const key of ['enableReply', 'enableAt', 'enableWhitelist', 'autoLikeOnReply'] as const) {
    if (Object.hasOwn(input, key)) {
      if (typeof input[key] !== 'boolean') throw new Error(`${key} 必须为布尔值`);
      patch[key] = input[key];
    }
  }
  const ranges = { pollIntervalSeconds: [2, 86400], imageDownloadTimeoutMs: [1000, 60_000],
    imageDownloadMaxBytes: [65536, 33554432], imageDownloadMaxCount: [0, 10] } as const;
  for (const key of Object.keys(ranges) as Array<keyof typeof ranges>) {
    if (Object.hasOwn(input, key)) patch[key] = integer(input[key], key, ranges[key][0], ranges[key][1]);
  }
  // Historical default was 2, but the timer has always enforced a 3 second minimum.
  if (patch.pollIntervalSeconds !== undefined) patch.pollIntervalSeconds = Math.max(3, patch.pollIntervalSeconds);
  for (const key of ['systemPrompt', 'targetWorkspacePath'] as const) {
    if (Object.hasOwn(input, key)) patch[key] = text(input[key], key);
  }
  if (Object.hasOwn(input, 'whitelist')) {
    if (!Array.isArray(input.whitelist) || input.whitelist.length > 5000) throw new Error('whitelist 格式无效');
    const seen = new Set<number>();
    patch.whitelist = input.whitelist.map(value => {
      const row = object(value);
      const item: BiliWhitelistUser = { mid: integer(row.mid, 'mid', 1, Number.MAX_SAFE_INTEGER),
        uname: text(row.uname, 'uname', 256), face: text(row.face ?? '', 'face', 4096) };
      if (row.sign !== undefined) item.sign = text(row.sign, 'sign', 4096);
      return item;
    }).filter(item => { if (seen.has(item.mid)) return false; seen.add(item.mid); return true; });
  }
  if (Object.hasOwn(input, 'modelSelection')) {
    if (input.modelSelection === null) patch.modelSelection = null;
    else {
      const model = object(input.modelSelection);
      const provider = text(model.provider, 'provider', 256).trim(), name = text(model.model, 'model', 512).trim();
      if (!provider || !name) throw new Error('模型配置不能为空');
      const effort = model.reasoningEffort === undefined ? undefined : text(model.reasoningEffort, 'reasoningEffort', 128).trim();
      patch.modelSelection = { provider, model: name, ...(effort ? { reasoningEffort: effort } : {}) };
    }
  }
  return patch;
}

async function readOptional(file: string): Promise<string | undefined> {
  try { return await fs.readFile(file, 'utf8'); }
  catch (error) { if (isMissingFile(error)) return undefined; throw error; }
}

/** Serialized settings and persona persistence. Neither file errors nor corrupt JSON mean defaults. */
export class PollerConfigStore {
  private readonly writes = new SerialTaskQueue();
  private current: BiliPollerConfig;
  private faulted = false;
  constructor(private readonly configPath: () => string, private readonly promptPath: () => string,
    private readonly defaults: BiliPollerConfig) { this.current = structuredClone(defaults); }

  get(): BiliPollerConfig { return structuredClone(this.current); }
  private assertHealthy(): void { if (this.faulted) throw new Error('配置文件回滚失败，请修复存储后重新加载插件'); }

  async load(): Promise<BiliPollerConfig> {
    return this.writes.run(async () => {
      const raw = await readOptional(this.configPath());
      const next = { ...structuredClone(this.defaults), ...(raw === undefined ? {} : validateConfigPatch(JSON.parse(raw))) };
      await this.validateWorkspace(next.targetWorkspacePath);
      const prompt = await readOptional(this.promptPath());
      next.systemPrompt = prompt ?? next.systemPrompt ?? '';
      if (prompt === undefined) await writePrivateAtomic(this.promptPath(), next.systemPrompt);
      this.current = next;
      this.faulted = false;
      return this.get();
    });
  }

  async prompt(): Promise<string> {
    this.assertHealthy();
    const existing = await readOptional(this.promptPath());
    if (existing !== undefined) return existing; // Empty is a valid explicitly cleared persona.
    return this.writes.run(async () => {
      this.assertHealthy();
      const retry = await readOptional(this.promptPath());
      if (retry !== undefined) return retry;
      const initial = this.current.systemPrompt ?? '';
      await writePrivateAtomic(this.promptPath(), initial);
      return initial;
    });
  }

  save(value: Partial<BiliPollerConfig> | ((current: BiliPollerConfig) => Partial<BiliPollerConfig>)): Promise<BiliPollerConfig> {
    // Clone public input before queue admission; caller mutations cannot alter queued writes.
    const input = typeof value === 'function' ? value : structuredClone(value);
    return this.writes.run(async () => {
      this.assertHealthy();
      const patch = validateConfigPatch(typeof input === 'function' ? input(this.get()) : input);
      const next = { ...this.current, ...patch };
      await this.validateWorkspace(next.targetWorkspacePath);
      const file = this.configPath();
      const previous = await readOptional(file);
      const { systemPrompt: _persona, ...persisted } = next;
      try {
        await writePrivateAtomic(file, JSON.stringify(persisted, null, 2));
        if (patch.systemPrompt !== undefined) {
          try { await writePrivateAtomic(this.promptPath(), patch.systemPrompt); }
          catch (error) {
            try { if (previous === undefined) await removeIfExists(file); else await writePrivateAtomic(file, previous); }
            catch { this.faulted = true; }
            throw error;
          }
        }
      } catch { throw new Error(this.faulted ? '配置文件回滚失败，请修复存储后重新加载插件' : '保存轮询配置失败'); }
      this.current = next;
      return this.get();
    });
  }

  private async validateWorkspace(value?: string): Promise<void> {
    const selected = value?.trim();
    if (!selected) return;
    if (!path.isAbsolute(selected)) throw new Error('工作区必须为绝对路径');
    const canonical = await fs.realpath(selected);
    if (!(await fs.stat(canonical)).isDirectory()) throw new Error('工作区不是目录');
  }
}
