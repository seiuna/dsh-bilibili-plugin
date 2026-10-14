import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { VaultService, InvalidPasswordError, InvalidVaultError } from '../src/vault-service.js';
import type { DecryptedBiliCredentials, VaultAccountSummary } from '../src/types.js';

describe('VaultService (安全保险箱与加解密测试)', () => {
  let tempDir: string;
  let testVaultFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-bili-vault-'));
    testVaultFile = path.join(tempDir, 'test-vault.json');
    vi.stubEnv('BILIBILI_VAULT_PATH', testVaultFile);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('在没有 Vault 文件时，hasVault 返回 false，readSummary 返回 null', async () => {
    const exists = await VaultService.hasVault();
    expect(exists).toBe(false);

    const summary = await VaultService.readSummary();
    expect(summary).toBeNull();
  });

  it('使用主密码加密 Cookie 与 refresh token，公开摘要仍可读取', async () => {
    const password = 'my_super_password_123';
    const creds: DecryptedBiliCredentials = {
      cookie: 'SESSDATA=super_secret_cookie; bili_jct=csrf_token_xyz',
      refreshToken: 'refresh_token_abc',
      mid: 390794259,
    };
    const account: VaultAccountSummary = {
      mid: 390794259,
      uname: '测试用户喵',
      face: 'https://i0.hdslb.com/bfs/face/sample.jpg',
    };

    await VaultService.encryptAndSave(password, creds, account);

    // 1. 验证文件存在
    expect(await VaultService.hasVault()).toBe(true);

    // 2. 检查落盘文件内容，严禁出现明文 Cookie
    const rawContent = await fs.readFile(testVaultFile, 'utf8');
    expect(rawContent).not.toContain('super_secret_cookie');
    expect(rawContent).not.toContain('csrf_token_xyz');

    const json = JSON.parse(rawContent);
    expect(json.crypto.algorithm).toBe('aes-256-gcm');
    expect(json.crypto.kdf).toBe('pbkdf2-sha256');
    expect(json.crypto.iterations).toBe(100000);
    expect(json.crypto.salt).toBeDefined();
    expect(json.crypto.iv).toBeDefined();
    expect(json.crypto.authTag).toBeDefined();
    expect(json.crypto.verifier).toBeDefined();

    // 3. 读取公开账号摘要
    const summary = await VaultService.readSummary();
    expect(summary).toEqual(account);
  });

  it('使用正确的主密码可以动态解密并精确还原凭据', async () => {
    const password = 'my_super_password_123';
    const creds: DecryptedBiliCredentials = {
      cookie: 'SESSDATA=test_cookie; bili_jct=test_jct',
      refreshToken: 'test_refresh',
      mid: 123456,
    };
    const account: VaultAccountSummary = {
      mid: 123456,
      uname: 'B站用户',
      face: 'https://example.com/face.png',
    };

    await VaultService.encryptAndSave(password, creds, account);

    // 解密
    const decrypted = await VaultService.decrypt(password);
    expect(decrypted).toEqual(creds);
  });

  it('使用错误的主密码必须抛出 InvalidPasswordError 并拒绝解密', async () => {
    const correctPassword = 'password_A';
    const wrongPassword = 'password_B';
    const creds: DecryptedBiliCredentials = {
      cookie: 'SESSDATA=valuable_secret',
      refreshToken: 'rf',
    };
    const account: VaultAccountSummary = {
      mid: 1,
      uname: '用户',
      face: '',
    };

    await VaultService.encryptAndSave(correctPassword, creds, account);

    await expect(VaultService.decrypt(wrongPassword)).rejects.toThrow(InvalidPasswordError);
  });

  it('当密文或 AuthTag 遭到非法篡改时拒绝解密', async () => {
    const password = 'password_A';
    const creds: DecryptedBiliCredentials = {
      cookie: 'SESSDATA=valuable_secret',
      refreshToken: 'rf',
    };
    const account: VaultAccountSummary = { mid: 1, uname: '用户', face: '' };

    await VaultService.encryptAndSave(password, creds, account);

    // 恶意篡改文件中的 ciphertext
    const rawContent = await fs.readFile(testVaultFile, 'utf8');
    const json = JSON.parse(rawContent);
    // 篡改 ciphertext
    const buf = Buffer.from(json.crypto.ciphertext, 'base64');
    buf[0] = buf[0] ^ 0xff;
    json.crypto.ciphertext = buf.toString('base64');
    await fs.writeFile(testVaultFile, JSON.stringify(json, null, 2), 'utf8');

    await expect(VaultService.decrypt(password)).rejects.toThrow();
  });

  it('removeVault 删除本地加密文件及自动解锁密钥', async () => {
    await VaultService.encryptAndSave(
      'pwd',
      { cookie: 'c', refreshToken: 'r' },
      { mid: 1, uname: 'u', face: 'f' },
    );
    await VaultService.saveAutoUnlockPassword('pwd');
    expect(await VaultService.hasVault()).toBe(true);
    expect(await VaultService.getAutoUnlockPassword()).toBe('pwd');

    await VaultService.removeVault();
    expect(await VaultService.hasVault()).toBe(false);
    expect(await VaultService.readSummary()).toBeNull();
    expect(await VaultService.getAutoUnlockPassword()).toBeNull();
  });

  it('saveAutoUnlockPassword / getAutoUnlockPassword 正常存取自动解密密码', async () => {
    expect(await VaultService.getAutoUnlockPassword()).toBeNull();
    await VaultService.saveAutoUnlockPassword('my_auto_pwd_999');
    expect(await VaultService.getAutoUnlockPassword()).toBe('my_auto_pwd_999');
    await VaultService.removeAutoUnlockPassword();
    expect(await VaultService.getAutoUnlockPassword()).toBeNull();
  });

  it('自动解锁材料明确为明文，本地文件使用独占 0600 临时文件后原子替换', async () => {
    const open = vi.spyOn(fs, 'open');
    const rename = vi.spyOn(fs, 'rename');
    await VaultService.saveAutoUnlockPassword('synthetic-password');
    expect(JSON.parse(await fs.readFile(VaultService.getKeyPath(), 'utf8')).password).toBe('synthetic-password');
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/bilibili-key\.json\.[a-f0-9]+\.tmp$/), 'wx', 0o600);
    expect(rename).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), VaultService.getKeyPath());
    if (process.platform !== 'win32') expect((await fs.stat(VaultService.getKeyPath())).mode & 0o777).toBe(0o600);
    expect((await fs.readdir(tempDir)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  it('原子替换失败保留旧 vault，清理临时文件并传播错误', async () => {
    const creds = { cookie: 'SESSDATA=old', refreshToken: 'old' };
    const account = { mid: 1, uname: 'offline', face: '' };
    await VaultService.encryptAndSave('password', creds, account);
    const previous = await fs.readFile(testVaultFile, 'utf8');
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('rename-denied'), { code: 'EACCES' }));
    await expect(VaultService.encryptAndSave('password', { cookie: 'SESSDATA=new', refreshToken: 'new' }, account)).rejects.toThrow('rename-denied');
    expect(await fs.readFile(testVaultFile, 'utf8')).toBe(previous);
    expect(await VaultService.decrypt('password')).toEqual(creds);
    expect((await fs.readdir(tempDir)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  it('临时文件写入中途失败保持旧 vault，关闭句柄并清理临时文件', async () => {
    const account = { mid: 1, uname: 'offline', face: '' };
    await VaultService.encryptAndSave('password', { cookie: 'SESSDATA=old', refreshToken: '' }, account);
    const before = await fs.readFile(testVaultFile, 'utf8');
    const realOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
      const handle = await realOpen(...args);
      vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(new Error('disk-full'));
      return handle;
    });
    await expect(VaultService.encryptAndSave('password', { cookie: 'SESSDATA=new', refreshToken: '' }, account)).rejects.toThrow('disk-full');
    expect(await fs.readFile(testVaultFile, 'utf8')).toBe(before);
    expect((await fs.readdir(tempDir)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  it('key 原子替换失败不截断旧 key', async () => {
    await VaultService.saveAutoUnlockPassword('old-password');
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('key-rename-failed'));
    await expect(VaultService.saveAutoUnlockPassword('new-password')).rejects.toThrow('key-rename-failed');
    expect(await VaultService.getAutoUnlockPassword()).toBe('old-password');
    expect((await fs.readdir(tempDir)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  it('并发写入按调用顺序提交快照，不产生半个 JSON 或混合密码', async () => {
    const mutable = { cookie: 'SESSDATA=first', refreshToken: 'first' };
    const account = { mid: 1, uname: 'offline', face: '' };
    const first = VaultService.encryptAndSave('first-password', mutable, account);
    mutable.cookie = 'SESSDATA=mutated';
    const second = VaultService.encryptAndSave('last-password', { cookie: 'SESSDATA=last', refreshToken: 'last' }, account);
    await Promise.all([first, second]);
    expect(await VaultService.decrypt('last-password')).toEqual({ cookie: 'SESSDATA=last', refreshToken: 'last' });
    expect((await fs.readdir(tempDir)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  it('并发写入/删除按提交顺序处理，不在 logout 后恢复文件', async () => {
    await Promise.all([
      VaultService.encryptAndSave('password', { cookie: 'SESSDATA=synthetic', refreshToken: '' }, { mid: 1, uname: 'offline', face: '' }),
      VaultService.saveAutoUnlockPassword('password'),
      VaultService.removeVault(),
    ]);
    expect(await VaultService.hasVault()).toBe(false);
    expect(await VaultService.getAutoUnlockPassword()).toBeNull();
    await expect(VaultService.removeVault()).resolves.toBeUndefined();
  });

  it('hasVault/readSummary/getAutoUnlockPassword 仅忽略 ENOENT，不吞权限错误', async () => {
    const denied = Object.assign(new Error('permission-denied'), { code: 'EACCES' });
    vi.spyOn(fs, 'access').mockRejectedValueOnce(denied);
    await expect(VaultService.hasVault()).rejects.toThrow('permission-denied');
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(denied).mockRejectedValueOnce(denied);
    await expect(VaultService.readSummary()).rejects.toThrow('permission-denied');
    await expect(VaultService.getAutoUnlockPassword()).rejects.toThrow('permission-denied');
  });

  it('删除失败仍尝试删除另一个文件，且必须传播非 ENOENT 错误', async () => {
    await VaultService.encryptAndSave('password', { cookie: 'SESSDATA=synthetic', refreshToken: '' }, { mid: 1, uname: 'offline', face: '' });
    await VaultService.saveAutoUnlockPassword('password');
    const unlink = vi.spyOn(fs, 'unlink').mockRejectedValueOnce(Object.assign(new Error('delete-denied'), { code: 'EACCES' }));
    await expect(VaultService.removeVault()).rejects.toThrow('delete-denied');
    expect(unlink).toHaveBeenCalledWith(testVaultFile);
    expect(unlink).toHaveBeenCalledWith(VaultService.getKeyPath());
    expect(await VaultService.getAutoUnlockPassword()).toBeNull();
    expect(await VaultService.hasVault()).toBe(true);
  });

  it.each(['not-json', '{}', '{"version":2}', '{"version":1,"crypto":{}}'])('损坏/缺字段 vault 必须明确失败 %#', async content => {
    await fs.writeFile(testVaultFile, content);
    await expect(VaultService.readSummary()).rejects.toThrow(InvalidVaultError);
    await expect(VaultService.decrypt('password')).rejects.toThrow(InvalidVaultError);
  });

  it('不接受被篡改的 KDF 参数，而不是忽略记录里的 iterations', async () => {
    await VaultService.encryptAndSave('password', { cookie: 'SESSDATA=synthetic', refreshToken: '' }, { mid: 1, uname: 'offline', face: '' });
    const record = JSON.parse(await fs.readFile(testVaultFile, 'utf8'));
    record.crypto.iterations = 1;
    await fs.writeFile(testVaultFile, JSON.stringify(record));
    await expect(VaultService.decrypt('password')).rejects.toThrow(InvalidVaultError);
  });

  it.each(['not-json', '{}', '{"password":42}', '{"password":""}'])('损坏 key 不应被解释为没有记住密码 %#', async content => {
    await fs.writeFile(VaultService.getKeyPath(), content);
    await expect(VaultService.getAutoUnlockPassword()).rejects.toThrow(InvalidVaultError);
  });

  it('拒绝空密码与缺失 Cookie，不创建磁盘文件', async () => {
    const account = { mid: 1, uname: 'offline', face: '' };
    await expect(VaultService.encryptAndSave(' ', { cookie: 'x', refreshToken: '' }, account)).rejects.toThrow(/不能为空/);
    await expect(VaultService.encryptAndSave('password', { cookie: '', refreshToken: '' }, account)).rejects.toThrow(InvalidVaultError);
    await expect(VaultService.saveAutoUnlockPassword('')).rejects.toThrow(/不能为空/);
    expect(await VaultService.hasVault()).toBe(false);
  });
});
