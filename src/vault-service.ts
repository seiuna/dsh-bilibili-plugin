import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  DecryptedBiliCredentials,
  VaultAccountSummary,
  VaultEncryptedRecord,
} from './types.js';

export class InvalidPasswordError extends Error {
  constructor(message = '密码错误，无法解密 B 站凭据') {
    super(message);
    this.name = 'InvalidPasswordError';
  }
}

export class VaultService {
  private static readonly ITERATIONS = 100_000;
  private static readonly KEY_LEN = 32;
  private static readonly VERIFIER_MESSAGE = 'DSH_BILIBILI_VAULT_AUTH_V1';

  /** 获取 DSH 存储根目录及 Vault 存储文件路径 */
  static getVaultPath(): string {
    if (process.env.BILIBILI_VAULT_PATH) {
      return path.resolve(process.env.BILIBILI_VAULT_PATH);
    }
    const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
    return path.join(dshHome, 'storages', 'bilibili-vault.json');
  }

  /** 检查 DSH 本地是否存在加密凭据文件 */
  static async hasVault(): Promise<boolean> {
    try {
      const vaultPath = this.getVaultPath();
      await fs.access(vaultPath);
      return true;
    } catch {
      return false;
    }
  }

  /** 读取加密存储中的公开账号摘要（用于未解密时展示头像昵称） */
  static async readSummary(): Promise<VaultAccountSummary | null> {
    try {
      const vaultPath = this.getVaultPath();
      const content = await fs.readFile(vaultPath, 'utf8');
      const record = JSON.parse(content) as VaultEncryptedRecord;
      return record.account || null;
    } catch {
      return null;
    }
  }

  /** 派生加密密钥 (PBKDF2-HMAC-SHA256) */
  private static deriveKey(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        password,
        salt,
        this.ITERATIONS,
        this.KEY_LEN,
        'sha256',
        (err, derivedKey) => {
          if (err) reject(err);
          else resolve(derivedKey);
        },
      );
    });
  }

  /** 计算快速密码校验子 */
  private static computeVerifier(key: Buffer): string {
    return crypto
      .createHmac('sha256', key)
      .update(this.VERIFIER_MESSAGE)
      .digest('base64');
  }

  /** 使用用户设置的密码加密凭据并安全落盘 */
  static async encryptAndSave(
    password: string,
    credentials: DecryptedBiliCredentials,
    account: VaultAccountSummary,
  ): Promise<void> {
    if (!password || password.length < 1) {
      throw new Error('保护密码不能为空');
    }

    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = await this.deriveKey(password, salt);
    const verifier = this.computeVerifier(key);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = JSON.stringify(credentials);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    const record: VaultEncryptedRecord = {
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      account,
      crypto: {
        algorithm: 'aes-256-gcm',
        kdf: 'pbkdf2-sha256',
        iterations: this.ITERATIONS,
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        verifier,
        ciphertext: encrypted.toString('base64'),
      },
    };

    const vaultPath = this.getVaultPath();
    await fs.mkdir(path.dirname(vaultPath), { recursive: true });
    await fs.writeFile(vaultPath, JSON.stringify(record, null, 2), 'utf8');
  }

  /** 使用用户提供的密码动态解密凭据 */
  static async decrypt(password: string): Promise<DecryptedBiliCredentials> {
    const vaultPath = this.getVaultPath();
    const content = await fs.readFile(vaultPath, 'utf8');
    const record = JSON.parse(content) as VaultEncryptedRecord;

    const { salt, iv, authTag, verifier, ciphertext } = record.crypto;
    const saltBuf = Buffer.from(salt, 'base64');
    const key = await this.deriveKey(password, saltBuf);

    const checkVerifier = this.computeVerifier(key);
    if (checkVerifier !== verifier) {
      throw new InvalidPasswordError();
    }

    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(authTag, 'base64'));

      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final(),
      ]);

      return JSON.parse(decrypted.toString('utf8')) as DecryptedBiliCredentials;
    } catch (err: any) {
      if (err instanceof InvalidPasswordError) throw err;
      throw new InvalidPasswordError('解密失败，认证标签验证未通过');
    }
  }

  /** 获取用于自动解密的本地凭据密钥文件路径 */
  static getKeyPath(): string {
    const vaultPath = this.getVaultPath();
    const dir = path.dirname(vaultPath);
    return path.join(dir, 'bilibili-key.json');
  }

  /** 保存自动解密密码到 DSH 仓库存储 */
  static async saveAutoUnlockPassword(password: string): Promise<void> {
    const keyPath = this.getKeyPath();
    await fs.mkdir(path.dirname(keyPath), { recursive: true });
    await fs.writeFile(
      keyPath,
      JSON.stringify({ password, updatedAt: Date.now() }, null, 2),
      'utf8',
    );
  }

  /** 从 DSH 仓库存储读取自动解密密码 */
  static async getAutoUnlockPassword(): Promise<string | null> {
    try {
      const keyPath = this.getKeyPath();
      const content = await fs.readFile(keyPath, 'utf8');
      const json = JSON.parse(content);
      return typeof json.password === 'string' ? json.password : null;
    } catch {
      return null;
    }
  }

  /** 移除保存的自动解密密码 */
  static async removeAutoUnlockPassword(): Promise<void> {
    try {
      const keyPath = this.getKeyPath();
      await fs.unlink(keyPath);
    } catch {
      // ignore
    }
  }

  /** 删除本地加密凭据仓库（退出登录 / 重置） */
  static async removeVault(): Promise<void> {
    const vaultPath = this.getVaultPath();
    try {
      await fs.unlink(vaultPath);
    } catch {
      // 忽略文件不存在的情况
    }
    await this.removeAutoUnlockPassword();
  }
}
