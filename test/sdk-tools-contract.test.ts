import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BiliClient, CommentAPI, DanmakuAPI, HistoryAPI, bv2av } from '@seiuna/bilibili-api';
import { registerBilibiliTools } from '../src/tools.js';
import type { ToolManager } from '../src/tools/shared.js';

const BV = 'BV1GJ411x7h7';
const AID = bv2av(BV);
const ok = (data: unknown) => ({ code: 0, message: '0', ttl: 1, data });
const reply = (rpid = 10) => ({ rpid, oid: AID, type: 1, root: 0, parent: 0, member: { mid: 2, uname: 'viewer' }, content: { message: 'hello' }, like: 3, replies: [] });
const video = { aid: AID, bvid: BV, title: 'video', cid: 30, pages: [], owner: { mid: 2, name: 'author' }, stat: {}, duration: 60, pubdate: 1 };
const dynamic = { id_str: '100', basic: { comment_id_str: '90', comment_type: 11 }, modules: { module_author: { name: 'author', pub_time: 'today' }, module_dynamic: { desc: { text: 'dynamic' } }, module_stat: { like: { count: 2 } } } };
const user = { mid: 2, name: 'author', level: 6, vip: { status: 1 } };
const fixtures: Record<string, unknown> = {
  '/x/web-interface/wbi/search/all/v2': { numResults: 10, result: [{ result_type: 'video', data: [{ title: '<em>video</em>', bvid: BV }] }] },
  '/x/web-interface/wbi/search/square': { list: [{ show_name: 'hot' }] },
  '/x/web-interface/popular': { list: [video] },
  '/x/web-interface/ranking/v2': { list: [video] },
  '/x/web-interface/popular/precious': { list: [video] },
  '/x/web-interface/wbi/view': video,
  '/x/web-interface/view/detail/tag': [{ tag_name: 'tag' }],
  '/x/web-interface/view/conclusion/get': { code: 0, model_result: { summary: 'summary', outline: [] } },
  '/x/player/wbi/playurl': { quality: 80, timelength: 10, dash: { video: [{ id: 64, baseUrl: '720' }, { id: 80, baseUrl: '1080' }], audio: [{ baseUrl: 'audio' }] }, support_formats: [] },
  '/x/web-interface/archive/related': [video],
  '/x/v2/reply': { page: { acount: 1 }, replies: [reply()] },
  '/x/v2/reply/jump': { replies: [reply()] },
  '/x/v2/reply/reply': { page: { count: 1 }, root: reply(), replies: [reply(11)] },
  '/x/v2/reply/add': { rpid: 10, rpid_str: '10' },
  '/x/space/wbi/acc/info': user,
  '/x/relation/stat': { follower: 4, following: 5 },
  '/x/space/upstat': { likes: 6 },
  '/x/space/wbi/arc/search': { list: { vlist: [] }, page: { count: 0 } },
  '/x/space/myinfo': user,
  '/x/im/web/msgfeed/unread': { reply: 0, at: 1, like: 2 },
  '/x/web-interface/history/cursor': { list: [{ title: 'history', history: { bvid: BV }, progress: -1 }], cursor: { max: 0 } },
  '/x/v2/history/toview': { count: 0, list: [] },
  '/x/v2/history/toview/add': null,
  '/x/v2/history/toview/del': null,
  '/x/v3/fav/folder/created/list-all': { list: [] },
  '/x/v3/fav/resource/list': { info: { title: 'folder' }, medias: [] },
  '/x/web-interface/archive/like': null,
  '/x/web-interface/coin/add': null,
  '/x/web-interface/archive/like/triple': { like: true, coin: false, fav: true },
  '/x/relation/modify': null,
  '/x/polymer/web-dynamic/v1/detail': { item: dynamic },
  '/x/polymer/web-dynamic/v1/feed/space': { has_more: false, items: [dynamic], offset: 'next' },
  '/x/dynamic/feed/dyn/thumb': null,
  '/x/article/viewinfo': { title: 'article', stats: { view: 3 } },
  '/x/article/view': { title: 'article', content: '<p>body</p>', author: { mid: 2, name: 'author' } },
  '/room/v1/Room/get_info': { room_id: 1, uid: 2, title: 'live', live_status: 2 },
};
type TestTool = { name: string; execute(args: Record<string, unknown>): Promise<Record<string, any>>; output: { render(args: unknown, result: unknown): Array<{ text: string }> } };
function harness() {
  const request = vi.fn(async (url: string, _options?: unknown) => {
    const path = new URL(url).pathname;
    if (!(path in fixtures)) throw new Error(`Unmocked SDK path: ${path}`);
    return ok(structuredClone(fixtures[path]));
  });
  const rawRequest = vi.fn(async (_url: string) => new Response('<i><d p="1,1,25">hello</d></i>'));
  const client = { request, rawRequest, userId: '2', config: { getCsrf: () => 'offline-csrf' } };
  const manager = { getClient: () => client, requireAuthedClient: vi.fn(() => client) };
  const tools = new Map<string, TestTool>();
  const unregister = registerBilibiliTools({ register(definition) {
    tools.set(definition.name, definition as unknown as TestTool);
    return () => { tools.delete(definition.name); };
  } }, manager as unknown as ToolManager);
  return { request, rawRequest, client, manager, tools, unregister, execute: (name: string, args: Record<string, unknown>) => tools.get(name)!.execute(args) };
}
const cases: Array<[string, Record<string, unknown>]> = [
  ['bilibili_search', { keyword: 'video' }],
  ['bilibili_get_trends', { category: 'hot' }], ['bilibili_get_trends', { category: 'popular' }],
  ['bilibili_get_trends', { category: 'ranking' }], ['bilibili_get_trends', { category: 'precious' }],
  ['bilibili_get_video_info', { bvid: BV }], ['bilibili_get_video_ai_summary', { bvid: BV }],
  ['bilibili_get_video_play_url', { bvid: BV }], ['bilibili_get_video_recommend', { bvid: BV }],
  ['bilibili_get_comments', { aid: AID }], ['bilibili_get_comment_detail', { oid: AID, rpid: '10' }],
  ['bilibili_get_sub_comments', { oid: AID, rootRpid: 10 }], ['bilibili_get_user_info', { mid: 2 }],
  ['bilibili_get_user_videos', { mid: 2 }], ['bilibili_get_my_info', {}], ['bilibili_view_history', {}],
  ['bilibili_manage_toview', { action: 'list' }], ['bilibili_manage_toview', { action: 'add', bvid: BV }],
  ['bilibili_manage_toview', { action: 'delete', bvid: BV }],
  ['bilibili_manage_favorite', { action: 'list_folders' }], ['bilibili_manage_favorite', { action: 'get_folder', mediaId: 1 }],
  ['bilibili_video_interact', { bvid: BV, action: 'like', confirm: true }],
  ['bilibili_video_interact', { bvid: BV, action: 'coin', multiply: 2, confirm: true }],
  ['bilibili_video_interact', { bvid: BV, action: 'triple', confirm: true }],
  ['bilibili_send_comment', { bvid: BV, message: 'offline', confirm: true }],
  ['bilibili_send_comment', { dynamicId: '100', message: 'offline', confirm: true }],
  ['bilibili_user_relation', { mid: 2, action: 'follow' }], ['bilibili_user_relation', { mid: 2, action: 'unfollow' }], ['bilibili_user_relation', { mid: 2, action: 'block' }],
  ['bilibili_get_dynamic_detail', { dynamicId: '100' }], ['bilibili_get_user_dynamics', { mid: 2 }],
  ['bilibili_dynamic_interact', { dynamicId: '100', action: 'like', confirm: true }],
  ['bilibili_dynamic_interact', { dynamicId: '100', action: 'unlike', confirm: true }],
  ['bilibili_get_article_info', { id: 1 }], ['bilibili_get_live_info', { roomId: 1 }],
];

beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is disabled'); })));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('SDK 1.1.3 static implementations + mocked transport', () => {
  it.each(cases)('%s handles successful branch %j and renders standard JSON', async (name, args) => {
    const h = harness();
    const result = await h.execute(name, args);
    const rendered = h.tools.get(name)!.output.render(args, result)[0].text;
    expect(() => JSON.parse(rendered)).not.toThrow();
    if ('warnings' in result) expect(result.warnings).toEqual([]);
    expect(h.request).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(cases)('%s rejects nonzero code for branch %j', async (name, args) => {
    const h = harness(); h.request.mockResolvedValue({ code: -412, message: 'risk control', ttl: 1, data: null });
    await expect(h.execute(name, args)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(cases)('%s rejects a malformed response for branch %j', async (name, args) => {
    const h = harness(); h.request.mockResolvedValue({} as ReturnType<typeof ok>);
    await expect(h.execute(name, args)).rejects.toThrow();
  });
  it.each(cases.filter(([name, args]) => !['bilibili_user_relation', 'bilibili_dynamic_interact'].includes(name) &&
    !(name === 'bilibili_manage_toview' && args.action !== 'list') && !(name === 'bilibili_video_interact' && args.action !== 'triple')))
  ('%s rejects missing read/result data %j', async (name, args) => {
    const h = harness(); h.request.mockResolvedValue(ok(null));
    await expect(h.execute(name, args)).rejects.toThrow();
  });
  it('uses correct argument order, WBI option and POST bodies', async () => {
    const h = harness();
    await h.execute('bilibili_get_comments', { oid: 90, replyType: 11, sort: 'time' });
    let url = new URL(h.request.mock.calls.at(-1)![0]);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ oid: '90', type: '11', sort: '0', nohot: '0', pn: '1', ps: '20' });
    await h.execute('bilibili_get_sub_comments', { oid: 90, rootRpid: 10, replyType: 11, page: 3, pageSize: 49 });
    url = new URL(h.request.mock.calls.at(-1)![0]);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ oid: '90', type: '11', root: '10', pn: '3', ps: '49' });
    await h.execute('bilibili_get_user_videos', { mid: 2, page: 3, pageSize: 25 });
    expect(h.request.mock.calls.at(-1)?.[1]).toEqual({ wbi: true });
    expect(h.request.mock.calls.at(-1)?.[0]).toContain('mid=2&pn=3&ps=25');
    await h.execute('bilibili_video_interact', { bvid: BV, action: 'coin', multiply: 2, confirm: true });
    const coinOptions = h.request.mock.calls.at(-1)![1] as { method: string; body: string };
    expect(coinOptions.method).toBe('POST');
    expect(Object.fromEntries(new URLSearchParams(coinOptions.body))).toMatchObject({ aid: String(AID), multiply: '2', select_like: '1', csrf: 'offline-csrf' });
    await h.execute('bilibili_send_comment', { bvid: BV, message: 'reply', rootRpid: 10, confirm: true });
    const commentOptions = h.request.mock.calls.at(-1)![1] as { body: string };
    expect(Object.fromEntries(new URLSearchParams(commentOptions.body))).toMatchObject({ oid: String(AID), type: '1', root: '10', parent: '10' });
    await h.execute('bilibili_dynamic_interact', { dynamicId: '100', action: 'unlike', confirm: true });
    const dynamicOptions = h.request.mock.calls.at(-1)![1] as { body: string };
    expect(JSON.parse(dynamicOptions.body)).toMatchObject({ dyn_id_str: '100', up: 2 });
  });
  it('sends dynamic comments to the resolved comment area, not the dynamic ID', async () => {
    const h = harness();
    await h.execute('bilibili_send_comment', { dynamicId: '100', message: 'hello', rootRpid: 10, parentRpid: 11, confirm: true });
    expect(new URL(h.request.mock.calls[0][0]).searchParams.get('id')).toBe('100');
    const options = h.request.mock.calls.at(-1)![1] as { body: string };
    expect(Object.fromEntries(new URLSearchParams(options.body))).toMatchObject({ oid: '90', type: '11', root: '10', parent: '11' });
  });
  it('refuses to post when a dynamic comment area cannot be resolved', async () => {
    const h = harness(); h.request.mockResolvedValue(ok({ ...dynamic, basic: { comment_type: 11 } }));
    await expect(h.execute('bilibili_send_comment', { dynamicId: '100', message: 'x', confirm: true })).rejects.toThrow('动态评论区');
    expect(h.request.mock.calls.every(([, options]) => (options as { method?: string } | undefined)?.method !== 'POST')).toBe(true);
  });
  it('merges SDK upper.top pinned variant and prefers precise rpid strings', async () => {
    const h = harness(); h.request.mockResolvedValue(ok({ page: { acount: 2 }, upper: { top: { ...reply(), rpid_str: '10' } }, replies: [reply(), reply(11)] }));
    const result = await h.execute('bilibili_get_comments', { aid: AID });
    expect(result.comments.map((r: { rpid: string | number }) => r.rpid)).toEqual(['10', 11]);
  });
  it('normalizes BV whitespace before passing it to the SDK', async () => {
    const h = harness(); await h.execute('bilibili_get_video_info', { bvid: ` ${BV} ` });
    expect(new URL(h.request.mock.calls[0][0]).searchParams.get('bvid')).toBe(BV);
  });
  it('normalizes dynamic object/array modules consistently and preserves cursor strings', async () => {
    const h = harness(); h.request.mockResolvedValue(ok({ items: [{ ...dynamic, modules: Object.entries(dynamic.modules).map(([key, value]) => ({ [key]: value })) }], has_more: true, offset: '9007199254740993' }));
    const result = await h.execute('bilibili_get_user_dynamics', { mid: 2, offset: '9007199254740993' });
    expect(result.items[0].text).toBe('dynamic'); expect(result.items[0].pubTime).toBe('today'); expect(result.items[0].like).toBe(2);
    expect(result.nextOffset).toBe('9007199254740993');
    expect(new URL(h.request.mock.calls[0][0]).searchParams.get('offset')).toBe('9007199254740993');
  });
  it.each(['https://t.bilibili.com/100?x=2', 'https://www.bilibili.com/opus/100'])('accepts only recognized dynamic URL form %s', async dynamicId => {
    const h = harness(); await h.execute('bilibili_get_dynamic_detail', { dynamicId });
    expect(new URL(h.request.mock.calls[0][0]).searchParams.get('id')).toBe('100');
  });
  it('selects requested DASH quality rather than first array entry', async () => {
    const h = harness(); const result = await h.execute('bilibili_get_video_play_url', { bvid: BV, cid: 30 });
    expect(result.videoUrl).toBe('1080'); expect(result.dash.video).toHaveLength(2);
    expect(h.request).toHaveBeenCalledTimes(1);
  });
  it('keeps filtered search totals local and includes live_room/live_user', async () => {
    const h = harness(); h.request.mockResolvedValue(ok({ numResults: 100, result: [
      { result_type: 'live_room', data: [{ title: 'room', roomid: 1 }] },
      { result_type: 'live_user', data: [{ uname: 'host', uid: 2 }] }, { result_type: 'video', data: [] },
    ] }));
    const result = await h.execute('bilibili_search', { keyword: 'live', searchType: 'live' });
    expect(result.total).toBe(2); expect(result.totalScope).toBe('filtered_page'); expect(result.results[1].mid).toBe(2);
  });
  it('preserves large precise IDs and rejects unsafe numeric IDs', async () => {
    const h = harness(); const id = '9007199254740993';
    h.request.mockResolvedValue(ok({ replies: [{ ...reply(), rpid: Number(id), rpid_str: id, oid: Number(id), oid_str: id, root: Number(id), root_str: id, parent_str: id }] }));
    const result = await h.execute('bilibili_get_comment_detail', { oid: id, rpid: id });
    expect(result.rpid).toBe(id); expect(result.root).toBe(id); expect(result.parent).toBe(id);
    expect(new URL(h.request.mock.calls[0][0]).searchParams.get('oid')).toBe(id);
    await expect(h.execute('bilibili_get_comment_detail', { oid: Number(id), rpid: id })).rejects.toThrow('安全整数');
  });
  it.each([{ oid: 999 }, { type: 11 }, { oid: undefined }, { type: undefined }])('rejects wrong or missing comment subject/type %j', async fields => {
    const h = harness(); h.request.mockResolvedValue(ok({ replies: [{ ...reply(), ...fields }] }));
    await expect(h.execute('bilibili_get_comment_detail', { oid: AID, rpid: '10' })).rejects.toThrow();
  });
  it('serializes missing parent/root/like/count as unknown nulls rather than absent or zero', async () => {
    const h = harness(); h.request.mockResolvedValue(ok({ replies: [{ ...reply(), root: undefined, parent: undefined, like: undefined, count: undefined }] }));
    const result = await h.execute('bilibili_get_comment_detail', { oid: AID, rpid: '10' });
    expect(result.root).toBeNull(); expect(result.parent).toBeNull(); expect(result.like).toBeNull(); expect(result.subReplyCount).toBeNull();
    const json = JSON.parse(h.tools.get('bilibili_get_comment_detail')!.output.render({}, result)[0].text);
    expect(json.root).toBeNull(); expect(json.parent).toBeNull(); expect(json.like).toBeNull(); expect(json.subReplyCount).toBeNull();
  });
  it('does not mislabel unresolved comments as deleted', async () => {
    const h = harness(); h.request.mockResolvedValue(ok({ replies: [] }));
    await expect(h.execute('bilibili_get_comment_detail', { oid: AID, rpid: '10' })).rejects.toThrow('不能据此认定已删除');
  });
  it('handles optional data failure with warnings/null rather than fabricated zero', async () => {
    const h = harness();
    const defaults = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (url, options) => new URL(url).pathname === '/x/space/upstat'
      ? { code: -403, message: 'denied', ttl: 1, data: null } : defaults(url, options));
    const result = await h.execute('bilibili_get_user_info', { mid: 2 });
    expect(result.likes).toBeNull(); expect(result.warnings).toHaveLength(1);
    const json = JSON.parse(h.tools.get('bilibili_get_user_info')!.output.render({}, result)[0].text);
    expect(json.likes).toBeNull(); expect(json.warnings).toHaveLength(1);
  });
  it('distinguishes missing AI summary from API errors and inner error codes', async () => {
    const h = harness(); h.request.mockResolvedValueOnce(ok(video)).mockResolvedValueOnce(ok({ code: 0, model_result: null }));
    expect((await h.execute('bilibili_get_video_ai_summary', { bvid: BV })).available).toBe(false);
    h.request.mockResolvedValueOnce(ok(video)).mockResolvedValueOnce(ok({ code: -1 }));
    await expect(h.execute('bilibili_get_video_ai_summary', { bvid: BV })).rejects.toThrow('code=-1');
  });
  it('does not claim complete triple success when an individual result is false', async () => {
    const h = harness(); const result = await h.execute('bilibili_video_interact', { bvid: BV, action: 'triple', confirm: true });
    expect(result.result.coin).toBe(false); expect(result.message).not.toContain('已成功');
  });
  it('warns on article partial failure and falls back to view stats, not account coin/like status', async () => {
    const h = harness(); h.request.mockResolvedValueOnce(ok({ title: 'article', coin: 2, like: 1 })).mockResolvedValueOnce(ok({ title: 'article', content: 'body', stats: { coin: 20, like: 10 } }));
    const result = await h.execute('bilibili_get_article_info', { id: 1 });
    expect(result.stats.coin).toBe(20); expect(result.stats.like).toBe(10);
    h.request.mockResolvedValueOnce(ok({ title: 'article', stats: {} })).mockRejectedValueOnce(new Error('offline error'));
    const partial = await h.execute('bilibili_get_article_info', { id: 1 });
    expect(partial.content).toBeNull(); expect(partial.warnings).toHaveLength(1);
  });
});

describe('validation, auth and write safeguards', () => {
  it.each([
    ['bilibili_search', { keyword: '' }], ['bilibili_search', { keyword: 'x', searchType: 'invalid' }],
    ['bilibili_get_trends', { category: 'invalid' }], ['bilibili_get_video_info', {}],
    ['bilibili_get_video_info', { bvid: BV, aid: 1 }], ['bilibili_get_video_info', { bvid: 'bad' }],
    ['bilibili_get_user_info', { mid: -1 }], ['bilibili_get_user_videos', { mid: 2, page: 0 }],
    ['bilibili_get_user_videos', { mid: 2, pageSize: 51 }], ['bilibili_view_history', { limit: 31 }],
    ['bilibili_get_sub_comments', { oid: AID, rootRpid: 10, pageSize: 50 }],
    ['bilibili_get_danmaku', { cid: 30, limit: 0 }], ['bilibili_get_danmaku', { cid: 30, limit: 1.5 }],
    ['bilibili_manage_toview', { action: 'add' }], ['bilibili_manage_favorite', { action: 'get_folder' }],
    ['bilibili_video_interact', { bvid: BV, action: 'coin', multiply: 3, confirm: true }],
    ['bilibili_video_interact', { bvid: BV, action: 'triple', multiply: 2, confirm: true }],
    ['bilibili_video_interact', { bvid: BV, action: 'like', confirm: 'true' }],
    ['bilibili_send_comment', { bvid: BV, message: ' ' }], ['bilibili_send_comment', { bvid: BV, message: 'x', parentRpid: 10 }],
    ['bilibili_send_comment', { message: 'x' }], ['bilibili_send_comment', { bvid: BV, dynamicId: '100', message: 'x' }],
    ['bilibili_user_relation', { mid: 2, action: 'typo' }],
    ['bilibili_dynamic_interact', { dynamicId: '100', action: 'typo', confirm: true }],
    ['bilibili_get_dynamic_detail', { dynamicId: 'garbage100' }],
    ['bilibili_get_dynamic_detail', { dynamicId: 'https://example.com/100' }],
    ['bilibili_get_dynamic_detail', { dynamicId: 'https://t.bilibili.com@evil.com/100' }],
    ['bilibili_get_comments', { oid: 90, bvid: BV }], ['bilibili_get_comments', { bvid: BV, replyType: 11 }],
  ] as Array<[string, Record<string, unknown>]>)('%s rejects bad parameters %j without requesting', async (name, args) => {
    const h = harness(); await expect(h.execute(name, args)).rejects.toThrow(); expect(h.request).not.toHaveBeenCalled(); expect(h.rawRequest).not.toHaveBeenCalled();
  });
  it.each([
    ['bilibili_video_interact', { bvid: BV, action: 'coin' }],
    ['bilibili_send_comment', { bvid: BV, message: 'offline' }],
    ['bilibili_dynamic_interact', { dynamicId: '100', action: 'like' }],
  ] as Array<[string, Record<string, unknown>]>)('%s defaults to no-write preview', async (name, args) => {
    const h = harness(); expect((await h.execute(name, args)).confirmed).toBe(false); expect(h.request).not.toHaveBeenCalled();
  });
  it.each(['bilibili_get_my_info', 'bilibili_view_history', 'bilibili_manage_toview', 'bilibili_manage_favorite', 'bilibili_video_interact', 'bilibili_send_comment', 'bilibili_user_relation', 'bilibili_dynamic_interact'])('%s enforces authentication before work', async name => {
    const h = harness(); h.manager.requireAuthedClient.mockImplementation(() => { throw new Error('locked'); });
    await expect(h.execute(name, {})).rejects.toThrow('locked'); expect(h.request).not.toHaveBeenCalled();
  });
  it('rolls back partial tool registration and unregisters idempotently', () => {
    const releases = [vi.fn(), vi.fn(() => { throw new Error('dispose'); })]; let count = 0;
    expect(() => registerBilibiliTools({ register() { if (count === 2) throw new Error('register'); return releases[count++]; } }, {} as ToolManager)).toThrow('register');
    for (const release of releases) expect(release).toHaveBeenCalledOnce();
    const h = harness(); expect(h.tools.size).toBe(24); h.unregister(); h.unregister(); expect(h.tools.size).toBe(0);
  });
});

describe('XML and SDK upstream evidence, no real network', () => {
  it('decodes XML entities, orders by timestamp and accepts a valid empty pool', async () => {
    const h = harness(); h.rawRequest.mockResolvedValueOnce(new Response('<i><d p="5,1">last</d><d p="1,1">&lt;x&gt; &amp; &#65;</d></i>'));
    const result = await h.execute('bilibili_get_danmaku', { cid: 30, limit: 1 });
    expect(result.danmaku).toEqual([{ time: 1, timeFormatted: '00:01', text: '<x> & A' }]);
    h.rawRequest.mockResolvedValueOnce(new Response('<i></i>'));
    expect((await h.execute('bilibili_get_danmaku', { cid: 30 })).total).toBe(0);
  });
  it.each(['<html>forbidden</html>', '{"code":-412}', ''])('rejects error bodies %s, never returns an empty success', async body => {
    const h = harness(); h.rawRequest.mockResolvedValueOnce(new Response(body, { status: 403 }));
    await expect(h.execute('bilibili_get_danmaku', { cid: 30 })).rejects.toThrow('XML'); expect(h.rawRequest).toHaveBeenCalledOnce();
  });
  it('propagates transport failure without fallback retry', async () => {
    const h = harness(); h.rawRequest.mockRejectedValueOnce(new Error('network failure'));
    await expect(h.execute('bilibili_get_danmaku', { cid: 30 })).rejects.toThrow('network failure'); expect(h.rawRequest).toHaveBeenCalledOnce();
  });
  it('documents SDK1.1.3 DanmakuAPI missing HTTP status checks with an injected fetch', async () => {
    const fetcher = vi.fn(async () => new Response('<html>forbidden</html>', { status: 403 }));
    const client = new BiliClient(undefined, fetcher);
    // No create/load/ensureLogin calls; this client has no profile or credentials.
    await expect(DanmakuAPI.getXmlDanmaku(client, 30)).resolves.toBe('<html>forbidden</html>');
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it('documents generator API errors being indistinguishable from exhaustion', async () => {
    const h = harness(); h.request.mockResolvedValue({ code: -412, message: 'risk', ttl: 1, data: null });
    const comments = []; for await (const page of CommentAPI.replies(h.client as unknown as BiliClient, AID, 1)) comments.push(page);
    const history = []; for await (const item of HistoryAPI.history(h.client as unknown as BiliClient, 15)) history.push(item);
    expect(comments).toEqual([]); expect(history).toEqual([]);
    await expect(h.execute('bilibili_view_history', {})).rejects.toThrow('code=-412');
    await expect(h.execute('bilibili_get_comments', { aid: AID })).rejects.toThrow('code=-412');
  });
});
