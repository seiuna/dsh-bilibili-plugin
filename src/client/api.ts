import type {
  BiliUserInfo,
  QrcodeGenerateResponse,
  QrcodePollResponse,
  VaultStatusResponse,
} from '../types.js';

export async function fetchAuthStatus(): Promise<VaultStatusResponse> {
  const res = await fetch('/api/bilibili/auth/status');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function generateQrcode(): Promise<QrcodeGenerateResponse> {
  const res = await fetch('/api/bilibili/auth/qrcode/generate', {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function pollQrcode(key: string): Promise<QrcodePollResponse> {
  const res = await fetch(`/api/bilibili/auth/qrcode/poll?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 获取安全可访问的头像 URL（绕过 B 站防盗链 403） */
export function getSafeAvatarUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('/api/bilibili/avatar/proxy')) {
    return url;
  }
  return `/api/bilibili/avatar/proxy?url=${encodeURIComponent(url)}`;
}

export async function setupVaultPassword(
  tempToken: string,
  password: string,
  remember: boolean = true,
): Promise<{ success: boolean; user: BiliUserInfo }> {
  const res = await fetch('/api/bilibili/vault/setup-pwd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tempToken, password, remember }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || '设置密码加密存储失败');
  }
  return json;
}

export async function unlockVault(
  password: string,
  remember: boolean = true,
): Promise<{ success: boolean; user: BiliUserInfo }> {
  const res = await fetch('/api/bilibili/vault/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, remember }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || '密码错误，解锁失败');
  }
  return json;
}

export async function logoutVault(): Promise<{ success: boolean }> {
  const res = await fetch('/api/bilibili/vault/logout', {
    method: 'POST',
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || '退出登录失败');
  }
  return json;
}
