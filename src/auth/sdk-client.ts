import { BiliClient, UserAPI } from '@seiuna/bilibili-api';
import type { BiliUserInfo, DecryptedBiliCredentials } from '../types.js';

/**
 * 不调用 create/load/ensureLogin：它们可能探测或写入真实 profile。
 * 显式的非 default 名称同时避免 SDK mergeCookie 自动迁移/删除 profile。
 * 该配置仅在内存中存在；主客户端的 save 由 manager 换成加密存储。
 */
export function createMemoryClient(getRevision?: () => number): BiliClient<any> {
  const client = new BiliClient<any>('dsh-memory-only', async (input, init) => {
    const revision = getRevision?.();
    const response = await fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) });
    // SDK 会把响应 Cookie 合入配置；账号切换/退出后禁止旧请求污染新会话。
    if (getRevision && revision !== getRevision()) throw new Error('凭据会话已变更，请重试请求');
    return response;
  });
  client.config.save = async () => {};
  return client;
}

export function getCredentials(client: BiliClient<any>): DecryptedBiliCredentials {
  const { cookie, refreshToken, mid } = client.config.data;
  return { cookie, refreshToken, mid };
}

export async function readNavUser(client: BiliClient<any>): Promise<BiliUserInfo> {
  const response = await UserAPI.getNavInfo(client);
  const data = response.data;
  if (response.code !== 0 || !data?.isLogin || !Number.isSafeInteger(data.mid) || data.mid <= 0) {
    throw new Error('当前凭据已失效，需要重新扫码登录');
  }
  if (typeof data.uname !== 'string' || typeof data.face !== 'string') {
    throw new Error('账号信息响应不完整，请稍后重试');
  }
  return {
    mid: data.mid,
    uname: data.uname,
    face: data.face,
    level: data.level_info?.current_level ?? 0,
    coins: data.money ?? 0,
    vipType: data.vipType ?? 0,
  };
}
