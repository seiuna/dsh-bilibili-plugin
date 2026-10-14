import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isMissingFile, removeIfExists, writePrivateAtomic } from './storage/atomic-file.js';
import { SerialTaskQueue } from './storage/serial-task-queue.js';
import { InvalidVaultError, parseVaultRecord, validateAccount, validateCredentials } from './storage/vault-record.js';
import type { DecryptedBiliCredentials, VaultAccountSummary, VaultEncryptedRecord } from './types.js';

export { InvalidVaultError } from './storage/vault-record.js';

export class InvalidPasswordError extends Error {
  constructor(message = '密码错误，无法解密 B 站凭据') {
    super(message);
    this.name = 'InvalidPasswordError';
  }
}

/** Vault 加密 Cookie；公开账号摘要及可选自动解锁密码不加密，不等于系统密钥链。 */
export class VaultService {
  private static readonly ITERATIONS = 100_000;
  private static readonly KEY_LEN = 32;
  private static readonly VERIFIER_MESSAGE = 'DSH_BILIBILI_VAULT_AUTH_V1';
  private static readonly mutations = new SerialTaskQueue();

  static getVaultPath(): string {
    if (process.env.BILIBILI_VAULT_PATH) return path.resolve(process.env.BILIBILI_VAULT_PATH);
    const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
    return path.join(dshHome, 'storages', 'bilibili-vault.json');
  }

  static async hasVault(): Promise<boolean> {
    try {
      await fs.access(this.getVaultPath());
      return true;
    } catch (error) {
      if (isMissingFile(error)) return false;
      throw error;
    }
  }

  static async readSummary(): Promise<VaultAccountSummary | null> {
    try {
      return parseVaultRecord(await fs.readFile(this.getVaultPath(), 'utf8')).account;
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  private static deriveKey(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(password, salt, this.ITERATIONS, this.KEY_LEN, 'sha256', (error, key) => {
        if (error) reject(error);
        else resolve(key);
      });
    });
  }

  private static computeVerifier(key: Buffer): Buffer {
    return crypto.createHmac('sha256', key).update(this.VERIFIER_MESSAGE).digest();
  }

  static encryptAndSave(password: string, credentials: DecryptedBiliCredentials, account: VaultAccountSummary): Promise<void> {
    const vaultPath = this.getVaultPath();
    // 入队前冻结调用时数据，避免 PBKDF2 异步期间 SDK 修改凭据。
    const snapshot = { ...credentials };
    const summary = { ...account };
    return this.mutations.run(async () => {
      if (!password.trim()) throw new Error('保护密码不能为空');
      validateCredentials(snapshot);
      validateAccount(summary);
      const salt = crypto.randomBytes(16);
      const iv = crypto.randomBytes(12);
      const key = await this.deriveKey(password, salt);
      const plaintext = Buffer.from(JSON.stringify(snapshot));
      try {
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const record: VaultEncryptedRecord = {
          version: 1, createdAt: Date.now(), updatedAt: Date.now(), account: summary,
          crypto: {
            algorithm: 'aes-256-gcm', kdf: 'pbkdf2-sha256', iterations: this.ITERATIONS,
            salt: salt.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'),
            verifier: this.computeVerifier(key).toString('base64'), ciphertext: encrypted.toString('base64'),
          },
        };
        await writePrivateAtomic(vaultPath, JSON.stringify(record, null, 2));
      } finally {
        key.fill(0);
        plaintext.fill(0);
      }
    });
  }

  static async decrypt(password: string): Promise<DecryptedBiliCredentials> {
    const record = parseVaultRecord(await fs.readFile(this.getVaultPath(), 'utf8'));
    const { salt, iv, authTag, verifier, ciphertext } = record.crypto;
    const key = await this.deriveKey(password, Buffer.from(salt, 'base64'));
    try {
      if (!crypto.timingSafeEqual(this.computeVerifier(key), Buffer.from(verifier, 'base64'))) {
        throw new InvalidPasswordError();
      }
      let plaintext: Buffer;
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(authTag, 'base64'));
        plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
      } catch {
        throw new InvalidPasswordError('解密失败，认证标签验证未通过');
      }
      try {
        let credentials: unknown;
        try { credentials = JSON.parse(plaintext.toString('utf8')); } catch { throw new InvalidVaultError(); }
        validateCredentials(credentials);
        return credentials;
      } finally {
        plaintext.fill(0);
      }
    } finally {
      key.fill(0);
    }
  }

  static getKeyPath(): string {
    return path.join(path.dirname(this.getVaultPath()), 'bilibili-key.json');
  }

  /** 明文自动解锁材料：选择记住密码代表同一系统用户可读取，不是磁盘零明文。 */
  static saveAutoUnlockPassword(password: string): Promise<void> {
    const keyPath = this.getKeyPath();
    return this.mutations.run(async () => {
      if (!password.trim()) throw new Error('保护密码不能为空');
      await writePrivateAtomic(keyPath, JSON.stringify({ password, updatedAt: Date.now() }, null, 2));
    });
  }

  static async getAutoUnlockPassword(): Promise<string | null> {
    try {
      const content = await fs.readFile(this.getKeyPath(), 'utf8');
      let value: unknown;
      try { value = JSON.parse(content); } catch { throw new InvalidVaultError(); }
      if (typeof value !== 'object' || value === null || !('password' in value)
        || typeof value.password !== 'string' || !value.password.trim()) throw new InvalidVaultError();
      return value.password;
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  static removeAutoUnlockPassword(): Promise<void> {
    const keyPath = this.getKeyPath();
    return this.mutations.run(() => removeIfExists(keyPath));
  }

  static removeVault(): Promise<void> {
    const vaultPath = this.getVaultPath();
    const keyPath = this.getKeyPath();
    return this.mutations.run(async () => {
      // 两个删除均尝试；只有 ENOENT 可以忽略，权限/设备错误必须报告。
      const results = await Promise.allSettled([removeIfExists(vaultPath), removeIfExists(keyPath)]);
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    });
  }
}
