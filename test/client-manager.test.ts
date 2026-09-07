import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BilibiliClientManager } from '../src/client-manager.js';
import { VaultService } from '../src/vault-service.js';
import type { DecryptedBiliCredentials, VaultAccountSummary } from '../src/types.js';

describe('BilibiliClientManager (状态与凭证管理测试)', () => {
  const tempDir = path.join(os.tmpdir(), `dsh-bili-mgr-test-${Date.now()}`);
  const testVaultFile = path.join(tempDir, 'vault.json');

  beforeEach(async () => {
    process.env.BILIBILI_VAULT_PATH = testVaultFile;
    await fs.mkdir(tempDir, { recursive: true });
    // 重置 manager 状态
    const manager = BilibiliClientManager.getInstance();
    manager.isUnlocked = false;
    manager.cachedUser = null;
    manager.accountSummary = null;
  });

  afterEach(async () => {
    delete process.env.BILIBILI_VAULT_PATH;
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('getInstance 返回唯一单例', () => {
    const instance1 = BilibiliClientManager.getInstance();
    const instance2 = BilibiliClientManager.getInstance();
    expect(instance1).toBe(instance2);
  });

  it('未登录且无 Vault 时，getStatus 返回正确状态', async () => {
    const manager = BilibiliClientManager.getInstance();
    const status = await manager.getStatus();

    expect(status.hasVault).toBe(false);
    expect(status.isUnlocked).toBe(false);
    expect(status.user).toBeNull();
    expect(status.accountSummary).toBeNull();
  });

  it('未登录未解锁时，调用 requireAuthedClient 必须抛出明确的解锁提示', () => {
    const manager = BilibiliClientManager.getInstance();
    expect(() => manager.requireAuthedClient()).toThrow(/Bilibili 凭据尚未解锁/);
  });

  it('本地存在 Vault 但未解锁时，getStatus 返回 hasVault=true, isUnlocked=false 并带有 accountSummary', async () => {
    const manager = BilibiliClientManager.getInstance();
    const account: VaultAccountSummary = {
      mid: 888888,
      uname: '锁定的账号',
      face: 'https://example.com/face.png',
    };
    await VaultService.encryptAndSave('test_pwd', { cookie: 'c', refreshToken: 'r' }, account);

    await manager.initOnStartup();
    const status = await manager.getStatus();

    expect(status.hasVault).toBe(true);
    expect(status.isUnlocked).toBe(false);
    expect(status.accountSummary).toEqual(account);
  });

  it('generateQrcode 返回包含 base64 DataURL 的二维码数据', async () => {
    const manager = BilibiliClientManager.getInstance();
    const qrData = await manager.generateQrcode();

    expect(qrData.qrcodeKey).toBeDefined();
    expect(typeof qrData.qrcodeKey).toBe('string');
    expect(qrData.url).toContain('bilibili.com');
    expect(qrData.qrcodeDataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('通过密码解锁后，状态变为 isUnlocked=true 且能够安全调用 requireAuthedClient', async () => {
    const manager = BilibiliClientManager.getInstance();
    const password = 'my_pwd_777';
    const creds: DecryptedBiliCredentials = {
      cookie: 'DedeUserID=1234567; SESSDATA=sess; bili_jct=jct',
      refreshToken: 'rf_token',
      mid: 1234567,
    };
    const account: VaultAccountSummary = {
      mid: 1234567,
      uname: '已解锁用户',
      face: 'https://example.com/user.jpg',
    };

    await VaultService.encryptAndSave(password, creds, account);

    // Mock 网络端 /x/web-interface/nav 响应
    vi.spyOn(manager.client, 'request').mockResolvedValueOnce({
      code: 0,
      message: '0',
      data: {
        isLogin: true,
        mid: 1234567,
        uname: '已解锁用户',
        face: 'https://example.com/user.jpg',
        money: 88,
        vipType: 2,
        level_info: { current_level: 6 },
      },
    });

    const user = await manager.unlock(password);

    expect(user.mid).toBe(1234567);
    expect(user.uname).toBe('已解锁用户');
    expect(user.level).toBe(6);
    expect(manager.isUnlocked).toBe(true);

    // requireAuthedClient 正常返回
    const authedClient = manager.requireAuthedClient();
    expect(authedClient).toBe(manager.client);

    const status = await manager.getStatus();
    expect(status.isUnlocked).toBe(true);
    expect(status.user?.uname).toBe('已解锁用户');
  });

  it('调用 logout 抹除本地凭据并将状态重置为未登录', async () => {
    const manager = BilibiliClientManager.getInstance();
    await VaultService.encryptAndSave('pwd', { cookie: 'c', refreshToken: 'r' }, { mid: 1, uname: 'u', face: 'f' });

    manager.isUnlocked = true;
    manager.cachedUser = {
      mid: 1,
      uname: 'u',
      face: 'f',
      level: 6,
      coins: 10,
      vipType: 1,
    };

    await manager.logout();

    expect(manager.isUnlocked).toBe(false);
    expect(manager.cachedUser).toBeNull();
    expect(await VaultService.hasVault()).toBe(false);
  });
});
