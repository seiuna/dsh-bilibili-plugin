import type { BiliPollerConfig, BiliWhitelistUser } from '../types.js';
import {
  arrayOf, isAuthStatus, isConfig, isConfigUpdate, isFollowings, isModelGroup,
  isQrcode, isQrcodePoll, isRecentMessages, isSuccess, isVaultUserResponse,
  isWhitelistUser, isWorkspace,
} from './contracts.js';
import { requestJson } from './request.js';

export function fetchAuthStatus(signal?: AbortSignal) {
  return requestJson('/auth/status', { signal, label: '获取账号状态', validate: isAuthStatus });
}
export function generateQrcode(signal?: AbortSignal) {
  return requestJson('/auth/qrcode/generate', { method: 'POST', signal, label: '申请二维码', validate: isQrcode });
}
export function pollQrcode(key: string, signal?: AbortSignal) {
  return requestJson(`/auth/qrcode/poll?key=${encodeURIComponent(key)}`, { signal, label: '查询二维码状态', validate: isQrcodePoll });
}

/** 获取安全可访问的头像 URL（绕过 B 站防盗链 403） */
export function getSafeAvatarUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('/api/bilibili/avatar/proxy')) return url;
  return `/api/bilibili/avatar/proxy?url=${encodeURIComponent(url)}`;
}

export function setupVaultPassword(tempToken: string, password: string, remember = true, signal?: AbortSignal) {
  return requestJson('/vault/setup-pwd', {
    method: 'POST', body: { tempToken, password, remember }, signal,
    label: '设置密码加密存储', requireSuccess: true, validate: isVaultUserResponse,
  });
}
export function unlockVault(password: string, remember = true, signal?: AbortSignal) {
  return requestJson('/vault/unlock', {
    method: 'POST', body: { password, remember }, signal,
    label: '解锁账号', requireSuccess: true, validate: isVaultUserResponse,
  });
}
export function logoutVault(signal?: AbortSignal) {
  return requestJson('/vault/logout', { method: 'POST', signal, label: '退出登录', requireSuccess: true, validate: isSuccess });
}
export function fetchPollerConfig(signal?: AbortSignal) {
  return requestJson('/poller/config', { signal, label: '获取轮询配置', validate: isConfig });
}
export async function updatePollerConfig(config: Partial<BiliPollerConfig>, signal?: AbortSignal) {
  const result = await requestJson('/poller/config', {
    method: 'POST', body: config, signal, label: '更新轮询配置', requireSuccess: true, validate: isConfigUpdate,
  });
  return result.config;
}
export function fetchFollowings(page = 1, pageSize = 50, signal?: AbortSignal) {
  return requestJson(`/followings?page=${page}&pageSize=${pageSize}`, { signal, label: '获取关注列表', validate: isFollowings });
}
export function fetchWorkspaces(signal?: AbortSignal) {
  return requestJson('/workspaces', { signal, label: '获取工作区列表', validate: arrayOf(isWorkspace) });
}
export function fetchModels(signal?: AbortSignal) {
  return requestJson('/models', { signal, label: '获取模型目录', validate: arrayOf(isModelGroup) });
}
export function searchBiliUser(query: string, signal?: AbortSignal) {
  return requestJson(`/user/search?q=${encodeURIComponent(query)}`, { signal, label: '查询用户', validate: isWhitelistUser });
}
export async function addWhitelistUser(user: BiliWhitelistUser, signal?: AbortSignal) {
  const result = await requestJson('/whitelist/add', {
    method: 'POST', body: user, signal, label: '添加白名单', requireSuccess: true, validate: isConfigUpdate,
  });
  return result.config;
}
export async function removeWhitelistUser(mid: number, signal?: AbortSignal) {
  const result = await requestJson('/whitelist/remove', {
    method: 'POST', body: { mid }, signal, label: '移除白名单', requireSuccess: true, validate: isConfigUpdate,
  });
  return result.config;
}
export async function fetchRecentMessages(signal?: AbortSignal) {
  const result = await requestJson('/poller/recent-messages', { signal, label: '获取最近消息', requireSuccess: true, validate: isRecentMessages });
  return result.list;
}
export async function clearRecentMessages(signal?: AbortSignal): Promise<true> {
  await requestJson('/poller/recent-messages/clear', { method: 'POST', signal, label: '清空最近消息', requireSuccess: true, validate: isSuccess });
  return true;
}
