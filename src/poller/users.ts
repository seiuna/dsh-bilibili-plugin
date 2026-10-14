import { SearchAPI, UserAPI, type BiliClient } from '@seiuna/bilibili-api';
import type { BiliWhitelistUser } from '../types.js';

export class BiliUserNotFoundError extends Error {
  constructor() { super('未找到对应的 B站用户'); this.name = 'BiliUserNotFoundError'; }
}

function safeInteger(value: unknown, name: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} 必须是正安全整数`);
  }
  return value;
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function user(value: unknown, search = false): BiliWhitelistUser {
  const data = object(value);
  if (!data) throw new Error('用户信息响应不完整');
  const mid = safeInteger(typeof data.mid === 'string' && /^[1-9]\d*$/.test(data.mid) ? Number(data.mid) : data.mid, '用户 UID');
  const name = search ? data.uname : data.uname ?? data.name;
  const face = search ? data.upic ?? data.face ?? '' : data.face;
  const sign = search ? data.usign : data.sign;
  if (typeof name !== 'string' || typeof face !== 'string') throw new Error('用户信息响应不完整');
  return { mid, uname: name, face, ...(typeof sign === 'string' ? { sign } : {}) };
}

/** SDK 1.1.3 has no dedicated followings API: this is the isolated typed extension. */
export async function getFollowings(client: BiliClient<any>, page = 1, pageSize = 50): Promise<{ list: BiliWhitelistUser[]; total: number }> {
  safeInteger(page, 'page'); safeInteger(pageSize, 'pageSize', 50);
  const rawMid = client.userId;
  if (!rawMid || !/^[1-9]\d*$/.test(rawMid)) throw new Error('登录账号 UID 不可用');
  const mid = safeInteger(Number(rawMid), '登录账号 UID');
  const response = await client.request<{ code: number; data?: { list?: unknown[] | null; total?: number } }>(
    `https://api.bilibili.com/x/relation/followings?vmid=${mid}&pn=${page}&ps=${pageSize}&order=desc`,
  );
  if (response.code !== 0) throw new Error(`获取关注列表失败 (code=${response.code})`);
  if (!response.data || !Array.isArray(response.data.list) || !Number.isSafeInteger(response.data.total) || response.data.total! < 0) {
    throw new Error('关注列表响应缺失，不能判定为没有关注用户');
  }
  return { list: response.data.list.map(item => user(item)), total: response.data.total! };
}

export async function searchUser(client: BiliClient<any>, query: string): Promise<BiliWhitelistUser> {
  const q = query.trim();
  if (!q) throw new Error('请输入 UID 或用户名');
  if (/^\d+$/.test(q)) {
    const mid = safeInteger(Number(q), 'UID');
    const response = await UserAPI.getInfo(client, mid);
    if (response.code === -404) throw new BiliUserNotFoundError();
    if (response.code !== 0) throw new Error(`用户查询失败 (code=${response.code})`);
    const result = user(response.data);
    if (result.mid !== mid) throw new Error('用户查询响应 UID 不匹配');
    return result;
  }
  const response = await SearchAPI.searchAll(client, q);
  if (response.code !== 0) throw new Error(`用户搜索失败 (code=${response.code})`);
  if (!Array.isArray(response.data?.result)) throw new Error('用户搜索响应缺失');
  const group = response.data.result.find(item => item.result_type === 'bili_user');
  if (!group) throw new BiliUserNotFoundError();
  if (!Array.isArray(group.data)) throw new Error('用户搜索列表响应缺失');
  if (!group.data.length) throw new BiliUserNotFoundError();
  const users = group.data.map(item => user(item, true));
  return users.find(item => item.uname.toLowerCase() === q.toLowerCase()) ?? users[0];
}
