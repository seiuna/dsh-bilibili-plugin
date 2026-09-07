export interface BiliUserInfo {
  mid: number;
  uname: string;
  face: string;
  level: number;
  coins: number;
  vipType: number;
}

export interface VaultAccountSummary {
  mid: number;
  uname: string;
  face: string;
}

export interface VaultStatusResponse {
  hasVault: boolean;
  isUnlocked: boolean;
  user: BiliUserInfo | null;
  accountSummary?: VaultAccountSummary | null;
}

export interface QrcodeGenerateResponse {
  qrcodeKey: string;
  url: string;
  qrcodeDataUrl: string;
}

export type QrcodePollStatusCode = 'waiting' | 'scanned' | 'success' | 'expired' | 'error';

export interface QrcodePollResponse {
  code: number;
  status: QrcodePollStatusCode;
  message: string;
  tempToken?: string;
  user?: BiliUserInfo | null;
}

export interface VaultEncryptedRecord {
  version: 1;
  createdAt: number;
  updatedAt: number;
  account: VaultAccountSummary;
  crypto: {
    algorithm: 'aes-256-gcm';
    kdf: 'pbkdf2-sha256';
    iterations: number;
    salt: string;
    iv: string;
    authTag: string;
    verifier: string;
    ciphertext: string;
  };
}

export interface DecryptedBiliCredentials {
  cookie: string;
  refreshToken: string;
  mid?: number;
}
