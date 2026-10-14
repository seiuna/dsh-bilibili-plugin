import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchAPI, UserAPI, type BiliClient } from '@seiuna/bilibili-api';
import { BiliUserNotFoundError, getFollowings, searchUser } from '../src/poller/users.js';
afterEach(() => vi.restoreAllMocks());
const account = { mid: 42, uname: 'example', face: 'https://i0.hdslb.com/test.png', sign: '' };
function client(response?: unknown) {
  const request = vi.fn().mockResolvedValue(response);
  return { request, userId: '42' } as unknown as BiliClient<any>;
}

describe('poller user SDK boundary', () => {
  it('reads and validates a following page without loading a profile', async () => {
    const sdk = client({ code: 0, data: { list: [account], total: 1 } });
    expect(await getFollowings(sdk, 2, 20)).toEqual({ list: [account], total: 1 });
    expect(sdk.request).toHaveBeenCalledExactlyOnceWith('https://api.bilibili.com/x/relation/followings?vmid=42&pn=2&ps=20&order=desc');
  });
  it.each([{ code: -412 }, { code: 0 }, { code: 0, data: {} }, { code: 0, data: { list: [], total: -1 } }])('does not turn failed or missing following response into empty: %j', async response => {
    await expect(getFollowings(client(response))).rejects.toThrow();
  });
  it('accepts a confirmed empty page and propagates request failures', async () => {
    expect(await getFollowings(client({ code: 0, data: { list: [], total: 0 } }))).toEqual({ list: [], total: 0 });
    const sdk = client(); vi.mocked(sdk.request).mockRejectedValue(new Error('offline'));
    await expect(getFollowings(sdk)).rejects.toThrow('offline');
  });
  it('rejects invalid pagination before transport', async () => {
    const sdk = client();
    await expect(getFollowings(sdk, NaN, 50)).rejects.toThrow();
    await expect(getFollowings(sdk, 1, 51)).rejects.toThrow();
    expect(sdk.request).not.toHaveBeenCalled();
  });
  it('looks up numeric UID and validates exact response', async () => {
    const api = vi.spyOn(UserAPI, 'getInfo').mockResolvedValue({ code: 0, data: { ...account, name: account.uname } } as any);
    expect(await searchUser(client(), '42')).toEqual(account);
    expect(api).toHaveBeenCalledWith(expect.anything(), 42);
    api.mockResolvedValueOnce({ code: 0, data: { ...account, mid: 43 } } as any);
    await expect(searchUser(client(), '42')).rejects.toThrow('不匹配');
  });
  it('distinguishes explicit not-found from API/transport/missing failures', async () => {
    const api = vi.spyOn(UserAPI, 'getInfo').mockResolvedValue({ code: -404 } as any);
    await expect(searchUser(client(), '42')).rejects.toBeInstanceOf(BiliUserNotFoundError);
    for (const result of [{ code: -412 }, { code: 0, data: null }]) {
      api.mockResolvedValueOnce(result as any);
      await expect(searchUser(client(), '42')).rejects.not.toBeInstanceOf(BiliUserNotFoundError);
    }
    api.mockRejectedValueOnce(new Error('offline'));
    await expect(searchUser(client(), '42')).rejects.toThrow('offline');
  });
  it('does not round unsafe identifiers into a different user', async () => {
    const api = vi.spyOn(UserAPI, 'getInfo');
    await expect(searchUser(client(), '9007199254740993')).rejects.toThrow('安全整数');
    await expect(searchUser(client(), '0')).rejects.toThrow();
    await expect(searchUser(client(), '')).rejects.toThrow();
    expect(api).not.toHaveBeenCalled();
  });
  it('uses exact name preference and typed search results', async () => {
    vi.spyOn(SearchAPI, 'searchAll').mockResolvedValue({ code: 0, data: { result: [{ result_type: 'bili_user', data: [{ mid: 1, uname: 'other', upic: '' }, { mid: '42', uname: 'example', upic: account.face }] }] } } as any);
    expect(await searchUser(client(), 'example')).toEqual({ mid: 42, uname: 'example', face: account.face });
  });
  it('distinguishes empty search from failed search', async () => {
    const api = vi.spyOn(SearchAPI, 'searchAll').mockResolvedValue({ code: 0, data: { result: [] } } as any);
    await expect(searchUser(client(), 'missing')).rejects.toBeInstanceOf(BiliUserNotFoundError);
    api.mockResolvedValueOnce({ code: -412 } as any);
    await expect(searchUser(client(), 'missing')).rejects.toThrow('code=-412');
    api.mockResolvedValueOnce({ code: 0 } as any);
    await expect(searchUser(client(), 'missing')).rejects.toThrow('响应缺失');
  });
});
