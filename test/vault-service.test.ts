import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { VaultService, InvalidPasswordError } from '../src/vault-service.js';
import type { DecryptedBiliCredentials, VaultAccountSummary } from '../src/types.js';

describe('VaultService (安全保险箱与加解密测试)', () => {
  const tempDir = path.join(os.tmpdir(), `dsh-bili-test-${Date.now()}`);
  const testVaultFile = path.join(tempDir, 'test-vault.json');

  beforeEach(async () => {
    process.env.BILIBILI_VAULT_PATH = testVaultFile;
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    delete process.env.BILIBILI_VAULT_PATH;
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('在没有 Vault 文件时，hasVault 返回 false，readSummary 返回 null', async () => {
    const exists = await VaultService.hasVault();
    expect(exists).toBe(false);

    const summary = await VaultService.readSummary();
    expect(summary).toBeNull();
  });

  it('使用主密码成功加密落盘，磁盘零明文，readSummary 正确读取公开信息', async () => {
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

  it('removeVault 能彻底抹除本地加密文件及自动解锁密钥', async () => {
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
});
