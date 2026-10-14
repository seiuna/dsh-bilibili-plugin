import type { DecryptedBiliCredentials, VaultAccountSummary, VaultEncryptedRecord } from '../types.js';

export class InvalidVaultError extends Error {
  constructor() {
    super('本地凭据文件格式无效或版本不受支持');
    this.name = 'InvalidVaultError';
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function account(value: unknown): value is VaultAccountSummary {
  return object(value) && Number.isSafeInteger(value.mid) && (value.mid as number) > 0
    && typeof value.uname === 'string' && typeof value.face === 'string';
}

function base64(value: unknown, bytes?: number): boolean {
  if (typeof value !== 'string' || !value || value.length > 1024 * 1024) return false;
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value && (bytes === undefined || decoded.length === bytes);
}

export function parseVaultRecord(content: string): VaultEncryptedRecord {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new InvalidVaultError(); }
  if (!object(value) || value.version !== 1 || !account(value.account)
    || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)
    || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || !object(value.crypto)) {
    throw new InvalidVaultError();
  }
  const info = value.crypto;
  if (info.algorithm !== 'aes-256-gcm' || info.kdf !== 'pbkdf2-sha256' || info.iterations !== 100_000
    || !base64(info.salt, 16) || !base64(info.iv, 12) || !base64(info.authTag, 16)
    || !base64(info.verifier, 32) || !base64(info.ciphertext)) throw new InvalidVaultError();
  return value as unknown as VaultEncryptedRecord;
}

export function validateCredentials(value: unknown): asserts value is DecryptedBiliCredentials {
  if (!object(value) || typeof value.cookie !== 'string' || !value.cookie || typeof value.refreshToken !== 'string'
    || (value.mid !== undefined && (!Number.isSafeInteger(value.mid) || (value.mid as number) <= 0))) {
    throw new InvalidVaultError();
  }
}

export function validateAccount(value: unknown): asserts value is VaultAccountSummary {
  if (!account(value)) throw new InvalidVaultError();
}
