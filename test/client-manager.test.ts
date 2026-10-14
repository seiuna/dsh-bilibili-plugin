import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConfigManager, UserAPI } from '@seiuna/bilibili-api';
import { BilibiliClientManager } from '../src/client-manager.js';
import { VaultService } from '../src/vault-service.js';
import type { DecryptedBiliCredentials, VaultAccountSummary } from '../src/types.js';

const credentials: DecryptedBiliCredentials = {
  cookie: 'DedeUserID=42; SESSDATA=synthetic-session; bili_jct=synthetic-csrf', refreshToken: 'synthetic-refresh', mid: 42,
};
const account: VaultAccountSummary = { mid: 42, uname: '离线用户', face: 'https://example.invalid/avatar.png' };
const nav = { code: 0, data: { isLogin: true, ...account, money: 88, vipType: 2, level_info: { current_level: 6 } } };
const json = (data: unknown, status = 200) => Response.json(data, { status });
function successfulPoll() {
  return Response.json({ code: 0, data: { code: 0, refresh_token: 'synthetic-refresh' } }, {
    headers: [
      ['set-cookie', 'DedeUserID=42; Path=/; Expires=Wed, 21 Oct 2030 07:28:00 GMT'],
      ['set-cookie', 'SESSDATA=synthetic-session==; Path=/; HttpOnly'],
      ['set-cookie', 'bili_jct=synthetic-csrf; Secure; SameSite=None'],
      ['set-cookie', 'unrelated=not-auth; Path=/'],
    ],
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('BilibiliClientManager 离线认证与状态隔离', () => {
  let tempDir: string;
  let manager: BilibiliClientManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-bili-manager-'));
    vi.stubEnv('BILIBILI_VAULT_PATH', path.join(tempDir, 'vault.json'));
    vi.stubEnv('BILIBILI_VAULT_PWD', '');
    // 默认拒绝网络，各用例只能使用合成响应；禁止探测真实 SDK profile。
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('离线测试禁止网络')));
    vi.spyOn(ConfigManager.prototype, 'load').mockRejectedValue(new Error('禁止读取 profile'));
    vi.spyOn(ConfigManager.prototype, 'save').mockRejectedValue(new Error('禁止写入 profile'));
    vi.spyOn(ConfigManager.prototype, 'createProfileForUser').mockRejectedValue(new Error('禁止迁移 profile'));
    Reflect.set(BilibiliClientManager, 'instance', null);
    manager = BilibiliClientManager.getInstance();
  });

  afterEach(async () => {
    expect(ConfigManager.prototype.load).not.toHaveBeenCalled();
    expect(ConfigManager.prototype.save).not.toHaveBeenCalled();
    expect(ConfigManager.prototype.createProfileForUser).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    await manager.logout();
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function saveVault(password = 'password') {
    await VaultService.encryptAndSave(password, credentials, account);
  }
  async function unlock(remember = false) {
    await saveVault();
    vi.mocked(fetch).mockResolvedValueOnce(json(nav));
    return manager.unlock('password', remember);
  }
  async function scan() {
    vi.mocked(fetch).mockResolvedValueOnce(successfulPoll()).mockResolvedValueOnce(json(nav));
    return manager.pollQrcode('offline-key');
  }

  it('保持单例和稳定 client；匿名状态不会读取 profile', async () => {
    expect(BilibiliClientManager.getInstance()).toBe(manager);
    expect(manager.getClient()).toBe(manager.client);
    expect(await manager.getStatus()).toEqual({ hasVault: false, isUnlocked: false, user: null, accountSummary: null });
    expect(() => manager.requireAuthedClient()).toThrow(/尚未解锁/);
    await manager.initOnStartup();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('本地存在 vault 但无自动密码时只展示摘要', async () => {
    await saveVault();
    await manager.initOnStartup();
    expect(await manager.getStatus()).toEqual({ hasVault: true, isUnlocked: false, user: null, accountSummary: account });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('二维码生成使用离线数据并输出 PNG data URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ code: 0, data: { qrcode_key: 'offline-key', url: 'https://passport.bilibili.com/offline' } }));
    const result = await manager.generateQrcode();
    expect(result.qrcodeKey).toBe('offline-key');
    expect(result.qrcodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/generate'), expect.objectContaining({ method: 'GET', redirect: 'error', signal: expect.any(AbortSignal) }));
  });

  it.each([
    [json({}, 503), /HTTP 503/],
    [json({ code: -1 }), /响应无效/],
    [json({ code: 0, data: {} }), /缺少二维码信息/],
  ])('二维码生成失败不会伪造可用结果 %#', async (response, error) => {
    vi.mocked(fetch).mockResolvedValueOnce(response);
    await expect(manager.generateQrcode()).rejects.toThrow(error);
  });

  it('解锁通过 typed UserAPI 验证后才保存密码，并保持 client identity', async () => {
    const originalClient = manager.client;
    const navSpy = vi.spyOn(UserAPI, 'getNavInfo');
    const saveKey = vi.spyOn(VaultService, 'saveAutoUnlockPassword');
    const user = await unlock(true);
    expect(user).toEqual({ ...account, level: 6, coins: 88, vipType: 2 });
    expect(navSpy).toHaveBeenCalledOnce();
    expect(navSpy.mock.calls[0][0]).not.toBe(originalClient);
    expect(navSpy.mock.invocationCallOrder[0]).toBeLessThan(saveKey.mock.invocationCallOrder[0]!);
    expect(manager.client).toBe(originalClient);
    expect(manager.requireAuthedClient()).toBe(originalClient);
    expect(await VaultService.getAutoUnlockPassword()).toBe('password');
    expect((await manager.getStatus()).user).toEqual(user);
  });

  it('记住密码=false 清理之前的 key，启动自动解锁则保留记住设置', async () => {
    await unlock(true);
    vi.mocked(fetch).mockResolvedValueOnce(json(nav));
    await manager.initOnStartup();
    expect(await VaultService.getAutoUnlockPassword()).toBe('password');
    vi.mocked(fetch).mockResolvedValueOnce(json(nav));
    await manager.unlock('password', false);
    expect(await VaultService.getAutoUnlockPassword()).toBeNull();
  });

  it('密码错误不调用网络，不写 key、不污染已有 client', async () => {
    await unlock(true);
    const before = { ...manager.client.config.data };
    const key = await fs.readFile(VaultService.getKeyPath(), 'utf8');
    vi.mocked(fetch).mockClear();
    await expect(manager.unlock('wrong', true)).rejects.toThrow(/密码错误/);
    expect(fetch).not.toHaveBeenCalled();
    expect(manager.client.config.data).toEqual(before);
    expect(manager.isUnlocked).toBe(true);
    expect(await fs.readFile(VaultService.getKeyPath(), 'utf8')).toBe(key);
  });

  it.each([
    { code: -101, data: { isLogin: false } },
    { code: 0, data: { isLogin: false } },
    { code: 0, data: { isLogin: true } },
  ])('无效凭据不会触发 refresh POST 或写密码 %#', async response => {
    await saveVault();
    const snapshot = { ...manager.client.config.data };
    vi.mocked(fetch).mockResolvedValueOnce(json(response));
    await expect(manager.unlock('password', true)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(manager.client.config.data).toEqual(snapshot);
    expect(manager.isUnlocked).toBe(false);
    expect(await VaultService.getAutoUnlockPassword()).toBeNull();
  });

  it('网络校验失败保留原会话与旧 key，而非提前落盘新密码', async () => {
    await unlock(true);
    const user = manager.cachedUser;
    const before = { ...manager.client.config.data };
    await saveVault('next-password');
    await expect(manager.unlock('next-password', true)).rejects.toThrow(/禁止网络/);
    expect(manager.cachedUser).toBe(user);
    expect(manager.client.config.data).toEqual(before);
    expect(await VaultService.getAutoUnlockPassword()).toBe('password');
  });

  it('key 持久化失败不激活候选凭据', async () => {
    await saveVault();
    vi.mocked(fetch).mockResolvedValueOnce(json(nav));
    vi.spyOn(VaultService, 'saveAutoUnlockPassword').mockRejectedValueOnce(new Error('key-write-failed'));
    await expect(manager.unlock('password', true)).rejects.toThrow('key-write-failed');
    expect(manager.isUnlocked).toBe(false);
    expect(manager.client.config.data.cookie).toBe('');
  });

  it('自动解锁失败不破坏本地 vault、不伪装登录', async () => {
    await saveVault();
    await VaultService.saveAutoUnlockPassword('password');
    await manager.initOnStartup();
    expect(manager.isUnlocked).toBe(false);
    expect(await VaultService.hasVault()).toBe(true);
    expect(manager.accountSummary).toEqual(account);
  });

  it.each([[86101, 'waiting'], [86090, 'scanned'], [86038, 'expired'], [123, 'error']] as const)(
    '扫码状态 %s 保持 UI 协议', async (code, status) => {
      vi.mocked(fetch).mockResolvedValueOnce(json({ code: 0, data: { code } }));
      expect(await manager.pollQrcode('offline-key')).toMatchObject({ code, status });
      expect(manager.isUnlocked).toBe(false);
    },
  );

  it('扫码成功采用 SDK 数组 Cookie 解析，未设置密码前不激活/不落盘', async () => {
    const setCookies = vi.spyOn(ConfigManager.prototype, 'setAuthCookies');
    const result = await scan();
    expect(result).toMatchObject({ code: 0, status: 'success', user: expect.objectContaining(account) });
    expect(result.tempToken).toMatch(/^[0-9a-f]{48}$/);
    expect(Array.isArray(setCookies.mock.calls[0][0])).toBe(true);
    expect(manager.isUnlocked).toBe(false);
    expect(await VaultService.hasVault()).toBe(false);
    await manager.setupPassword(result.tempToken!, 'password', false);
    expect(manager.client.config.data.cookie).toBe('DedeUserID=42; SESSDATA=synthetic-session==; bili_jct=synthetic-csrf');
    expect(manager.client.config.data.cookie).not.toMatch(/Path|Expires|HttpOnly|unrelated/);
    expect(await VaultService.decrypt('password')).toEqual(manager.client.config.data);
  });

  it.each([
    json({ code: 0, data: { code: 0 } }),
    json({ code: -1, data: { code: 0 } }),
    json({ code: 0 }),
    json({}, 502),
  ])('缺失 Cookie/状态或错误响应不能生成 tempToken %#', async response => {
    vi.mocked(fetch).mockResolvedValueOnce(response);
    expect(await manager.pollQrcode('offline-key')).toMatchObject({ status: 'error' });
    expect(await VaultService.hasVault()).toBe(false);
  });

  it('扫码后 nav 验证失败不返回伪造用户', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(successfulPoll()).mockResolvedValueOnce(json({ code: -101 }));
    const result = await manager.pollQrcode('offline-key');
    expect(result.status).toBe('error');
    expect(result.tempToken).toBeUndefined();
    expect(result.user).toBeUndefined();
  });

  it('空二维码 key 不发请求', async () => {
    expect((await manager.pollQrcode('')).status).toBe('error');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('并发轮询同一 key 只发一组请求，logout 拒绝在途的旧扫码结果', async () => {
    const pending = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(json(nav));
    const first = manager.pollQrcode('offline-key');
    const second = manager.pollQrcode('offline-key');
    expect(first).toBe(second);
    expect(fetch).toHaveBeenCalledTimes(1);
    await manager.logout();
    pending.resolve(successfulPoll());
    expect((await first).status).toBe('error');
    expect((await second).tempToken).toBeUndefined();
    expect(manager.isUnlocked).toBe(false);
  });

  it('不同二维码在途请求有上限，完成后释放轮询槽位', async () => {
    const pending = Array.from({ length: 16 }, () => deferred<Response>());
    for (const item of pending) vi.mocked(fetch).mockReturnValueOnce(item.promise);
    const requests = pending.map((_, index) => manager.pollQrcode(`offline-${index}`));
    expect((await manager.pollQrcode('overflow')).status).toBe('error');
    expect(fetch).toHaveBeenCalledTimes(16);
    pending.forEach(item => item.resolve(json({ code: 0, data: { code: 86101 } })));
    await Promise.all(requests);
    vi.mocked(fetch).mockResolvedValueOnce(json({ code: 0, data: { code: 86101 } }));
    expect((await manager.pollQrcode('next')).status).toBe('waiting');
  });

  it('并发解锁按提交顺序验证，后一次失败不能回滚先前成功的会话', async () => {
    await saveVault();
    vi.mocked(fetch).mockResolvedValueOnce(json(nav));
    const settled = await Promise.allSettled([
      manager.unlock('password', false), manager.unlock('wrong-password', true),
    ]);
    expect(settled.map(item => item.status)).toEqual(['fulfilled', 'rejected']);
    expect(manager.isUnlocked).toBe(true);
    expect(manager.cachedUser?.mid).toBe(42);
    expect(await VaultService.getAutoUnlockPassword()).toBeNull();
  });

  it('remember=false 删除旧 key 失败时不宣称解锁成功', async () => {
    await saveVault();
    await VaultService.saveAutoUnlockPassword('previous');
    vi.mocked(fetch).mockResolvedValueOnce(json(nav));
    vi.spyOn(VaultService, 'removeAutoUnlockPassword').mockRejectedValueOnce(new Error('key-delete-denied'));
    await expect(manager.unlock('password', false)).rejects.toThrow('key-delete-denied');
    expect(manager.isUnlocked).toBe(false);
    expect(manager.client.config.data.cookie).toBe('');
    expect(await VaultService.getAutoUnlockPassword()).toBe('previous');
  });

  it('同一个 token 的并发设置密码只允许一次成功，remember=false 清理旧 key', async () => {
    const result = await scan();
    await VaultService.saveAutoUnlockPassword('old-password');
    const settled = await Promise.allSettled([
      manager.setupPassword(result.tempToken!, 'new-password', false),
      manager.setupPassword(result.tempToken!, 'another-password', true),
    ]);
    expect(settled.map(item => item.status)).toEqual(['fulfilled', 'rejected']);
    expect(await VaultService.getAutoUnlockPassword()).toBeNull();
    expect((await VaultService.decrypt('new-password')).mid).toBe(42);
  });

  it('缺失 token / 空密码拒绝，持久化失败可用同一 token 重试', async () => {
    await expect(manager.setupPassword('missing', 'password')).rejects.toThrow(/不存在/);
    const result = await scan();
    await expect(manager.setupPassword(result.tempToken!, ' ')).rejects.toThrow(/不能为空/);
    vi.spyOn(VaultService, 'encryptAndSave').mockRejectedValueOnce(new Error('write-failed'));
    await expect(manager.setupPassword(result.tempToken!, 'password')).rejects.toThrow('write-failed');
    expect(manager.isUnlocked).toBe(false);
    await manager.setupPassword(result.tempToken!, 'password', false);
    expect(manager.isUnlocked).toBe(true);
  });

  it('扫码设置时 key 保存失败清空旧会话，可重试完成且不保留旧 key', async () => {
    await unlock(true);
    const result = await scan();
    await VaultService.saveAutoUnlockPassword('old-password');
    vi.spyOn(VaultService, 'saveAutoUnlockPassword').mockRejectedValueOnce(new Error('key-write-failed'));
    await expect(manager.setupPassword(result.tempToken!, 'password', true)).rejects.toThrow('key-write-failed');
    expect(manager.isUnlocked).toBe(false);
    expect(await VaultService.getAutoUnlockPassword()).toBeNull();
    // vault 已安全写入新密码，但跨文件提交未完成，旧会话不能再写回。
    await manager.client.config.save();
    expect(manager.client.config.data.cookie).toBe('');
    expect((await VaultService.decrypt('password')).mid).toBe(42);
    await manager.setupPassword(result.tempToken!, 'password', true);
    expect(manager.isUnlocked).toBe(true);
    expect(await VaultService.getAutoUnlockPassword()).toBe('password');
  });

  it('SDK config.save 持久化失败必须向上传播，之后的 save 仍可正常执行', async () => {
    await unlock(false);
    vi.spyOn(VaultService, 'encryptAndSave').mockRejectedValueOnce(new Error('vault-write-failed'));
    await expect(manager.client.config.save()).rejects.toThrow('vault-write-failed');
    manager.client.config.data.refreshToken = 'next-refresh';
    await manager.client.config.save();
    expect((await VaultService.decrypt('password')).refreshToken).toBe('next-refresh');
  });

  it('并发 SDK save 保存调用时快照，最终 vault 是最后一次调用的数据', async () => {
    await unlock(false);
    manager.client.config.data.refreshToken = 'first';
    const first = manager.client.config.save();
    manager.client.config.data.refreshToken = 'last';
    const last = manager.client.config.save();
    await Promise.all([first, last]);
    expect((await VaultService.decrypt('password')).refreshToken).toBe('last');
  });

  it('并发 unlock/logout 按调用顺序完成，退出后 save 不会重建 vault', async () => {
    await saveVault();
    vi.mocked(fetch).mockResolvedValueOnce(json(nav));
    await Promise.all([manager.unlock('password'), manager.logout()]);
    await manager.client.config.save();
    expect(manager.isUnlocked).toBe(false);
    expect(manager.client.config.data.cookie).toBe('');
    expect(await VaultService.hasVault()).toBe(false);
    expect(await VaultService.getAutoUnlockPassword()).toBeNull();
  });

  it('退出后旧 SDK 响应不能再写 Cookie 或恢复会话', async () => {
    await unlock(false);
    const pending = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    const request = manager.client.request('https://api.bilibili.com/test');
    const rejected = expect(request).rejects.toThrow(/会话已变更/);
    await manager.logout();
    pending.resolve(Response.json({ code: 0 }, { headers: { 'set-cookie': 'SESSDATA=stale; Path=/' } }));
    await rejected;
    expect(manager.client.config.data.cookie).toBe('');
    expect(await VaultService.hasVault()).toBe(false);
  });

  it('删除失败明确报错但清空内存会话', async () => {
    await unlock(true);
    vi.spyOn(VaultService, 'removeVault').mockRejectedValueOnce(new Error('permission-denied'));
    await expect(manager.logout()).rejects.toThrow('permission-denied');
    expect(manager.isUnlocked).toBe(false);
    expect(manager.cachedUser).toBeNull();
    expect(manager.client.config.data.cookie).toBe('');
  });
});
