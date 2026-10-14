import { it, expect, vi, afterEach, beforeEach } from 'vitest';

import { PollerService } from '../src/poller-service.js';
import { CommentAPI, DynamicAPI, VideoAPI } from '@seiuna/bilibili-api';
import { replyPagesMock, requestedPages } from './reply-detail-mock.js';
let testTempDir: string;
beforeEach(async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  testTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bili-source-test-'));
  vi.stubEnv('BILIBILI_POLLER_CONFIG_PATH', path.join(testTempDir, 'config.json'));
  vi.stubEnv('BILIBILI_PROMPT_PATH', path.join(testTempDir, 'prompt.md'));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('offline tests prohibit network'); }));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  (PollerService as any).instance = null;
  if (testTempDir) {
    const fs = await import('node:fs/promises');
    await fs.rm(testTempDir, { recursive: true, force: true }).catch(() => {});
  }
});
function fixture(businessId = 1, notifyType: 'at' | 'reply' = 'reply') {
  (PollerService as any).instance = null;
  const entries: Record<string, any> = {
    30: { rpid: '30', root: '0', parent: '0', mid: '7', content: { message: 'root original' } },
    31: { rpid: '31', root: '30', parent: '30', mid: '99', content: { message: 'bot ancestor' } },
    32: { rpid: '32', root: '30', parent: '31', mid: '7', content: { message: 'parent user' } },
    33: { rpid: '33', root: '30', parent: '32', mid: '7', content: { message: 'current' } },
    34: { rpid: '34', root: '30', parent: '30', mid: '99', content: { message: 'unrelated newest bot' } },
  };
  Object.values(entries).forEach(e => Object.assign(e, { oid: '20', type: String(businessId) }));
  const request = replyPagesMock(entries, 20, businessId);
  const subject = businessId === 1
    ? { code: 0, data: { aid: 20, title: 'actual video', bvid: 'BV1actual' } }
    : { code: 0, data: { item: { id_str: '200', basic: { comment_id_str: '20', comment_type: businessId }, modules: { module_dynamic: { desc: { text: 'actual dynamic body' } } } } } };
  const getSubject = businessId === 1 ? vi.spyOn(VideoAPI, 'getInfoByAid') : vi.spyOn(DynamicAPI, 'getDetail');
  getSubject.mockResolvedValue(subject as any);
  const getComment = vi.spyOn(CommentAPI, 'getReply').mockImplementation(async (_client, oid, type, id) => {
    const entry = entries[String(id)];
    return { code: 0, message: '0', ttl: 1, data: entry ?? null };
  });
  const p = PollerService.getInstance({ getClient: () => ({ userId: 99, request }) } as any);
  const c = p.buildSessionContext(notifyType, { user: { mid: 7 }, item: { business_id: businessId, subject_id: 20, root_id: 30, source_id: 33, title: 'misleading notification summary', source_content: 'current', uri: 'https://t.bilibili.com/200' } });
  return { p, c, request, entries, getComment, getSubject, subject };
}
it.each(['at', 'reply'] as const)('%s fetches verified current, root, parent and verified bot ancestry', async type => {
  const { p, c, request } = fixture(1, type);
  await p.hydrateSourceContext(c);
  expect(c.actualVideoTitle).toBe('actual video');
  expect(c.rootComment?.text).toBe('root original');
  expect(c.parentComment?.text).toBe('parent user');
  expect(c.botRepliedComment?.text).toBe('bot ancestor');
  expect(c.message).toBe('current');
  expect(request).not.toHaveBeenCalled();
});
it('SDK Comment entity shares in-flight and settled cache without listing', async () => {
  const { p, c, entries, request, getComment, getSubject } = fixture();
  entries[33].content.pictures = [{ img_src: 'https://example.com/current.jpg' }];
  await Promise.all([p.hydrateSourceContext(c), p.hydrateCommentImages(c)]);
  await p.hydrateSourceContext(c); await p.hydrateCommentImages(c);
  expect(c.parentComment?.text).toBe('parent user');
  expect(c.botRepliedComment?.text).toBe('bot ancestor');
  expect(c.images).toEqual(['https://example.com/current.jpg']);
  expect(request).not.toHaveBeenCalled();
  expect(getSubject).toHaveBeenCalledTimes(2);
  expect(getComment.mock.calls.map(call => String(call[3])).sort()).toEqual(['30', '31', '32', '33']);
});
it.each(['throw', 'missing', 'rpid', 'oid', 'type'] as const)('SDK Comment entity %s falls back to verified shared listing', async mode => {
  const { p, c, entries, request, getComment } = fixture();
  getComment.mockImplementation(async (_client, oid, type, id) => {
    if (String(id) === '33') {
      if (mode === 'throw') throw new Error('offline');
      if (mode === 'missing') return { code: 0, message: '0', ttl: 1, data: null };
      return { code: 0, message: '0', ttl: 1, data: { ...entries[33], [mode]: '999', content: { message: 'wrong detail', pictures: [{ img_src: 'https://example.com/wrong.jpg' }] } } };
    }
    return { code: 0, message: '0', ttl: 1, data: entries[String(id)] ?? null };
  });
  await Promise.all([p.hydrateSourceContext(c), p.hydrateCommentImages(c)]);
  expect(c.parentComment?.text).toBe('parent user'); expect(c.images).toEqual([]);
  expect(requestedPages(request)).toHaveLength(2);
  expect(getComment.mock.calls.filter(call => String(call[3]) === '33')).toHaveLength(1);
});
it('uses actual dynamic body with matching comment oid, not notification title', async () => {
  const { p, c } = fixture(11);
  await p.hydrateSourceContext(c); expect(c.dynamicBodyExcerpt).toBe('actual dynamic body');
});
it.each(['missing', 'api error', 'network error'] as const)('%s does not fabricate comment context', async mode => {
  const { p, c, request, getComment } = fixture();
  getComment.mockRejectedValue(new Error('offline'));
  if (mode === 'network error') request.mockRejectedValue(new Error('offline'));
  else request.mockResolvedValue(mode === 'missing' ? { code: 0, data: { replies: [], hots: [], upper: {}, page: { count: 0, size: 20 } } } : { code: -400, data: {} });
  await p.hydrateSourceContext(c);
  expect(c.actualVideoTitle).toBeUndefined();
  expect(c.rootComment).toBeUndefined(); expect(c.parentComment).toBeUndefined();
  expect(c.botRepliedComment).toBeUndefined(); expect(c.message).toBe('current');
});
it.each(['rpid', 'oid', 'type'] as const)('rejects a mismatched %s even when reply text exists', async field => {
  const { p, c, entries } = fixture(); entries[33][field] = '999';
  await p.hydrateSourceContext(c);
  expect(c.parentComment).toBeUndefined(); expect(c.botRepliedComment).toBeUndefined();
});
it('missing parent does not prevent separately fetching the root', async () => {
  const { p, c, entries, request } = fixture(); delete entries[32];
  await p.hydrateSourceContext(c);
  expect(c.parentCommentId).toBe('32'); expect(c.parentComment).toBeUndefined();
  expect(c.rootComment?.text).toBe('root original');
  expect(requestedPages(request)).toHaveLength(2);
});
it.each(['rpid', 'oid', 'type'] as const)('rejects listing entry missing identity field %s', async field => {
  const { p, c, entries } = fixture(); delete entries[33][field];
  await p.hydrateSourceContext(c);
  expect(c.parentComment).toBeUndefined(); expect(c.botRepliedComment).toBeUndefined();
});
it('root listing failure does not discard dialog context', async () => {
  const { p, c, request, getComment } = fixture();
  getComment.mockRejectedValue(new Error('jump offline'));
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (url, options) => {
    if (new URL(url).pathname === '/x/v2/reply') throw new Error('root listing offline');
    return original(url, options);
  });
  await p.hydrateSourceContext(c);
  expect(c.rootComment?.text).toBe('root original'); expect(c.parentComment?.text).toBe('parent user');
  expect(c.botRepliedComment?.text).toBe('bot ancestor');
});
it('does not identify another user as the bot', async () => {
  const { p, c, entries } = fixture(); entries[31].mid = '8';
  await p.hydrateSourceContext(c); expect(c.botRepliedComment).toBeUndefined();
});
it('exact root_str and parent_str zero override stale numeric chain and notification root', async () => {
  const { p, c, entries, request } = fixture();
  Object.assign(entries[33], { root_str: '0', parent_str: '0', content: { message: 'exact top-level body' } });
  await p.hydrateSourceContext(c);
  expect(c.message).toBe('current');
  expect(c.parentCommentId).toBeUndefined(); expect(c.parentComment).toBeUndefined();
  expect(c.rootComment).toBeUndefined(); expect(c.botRepliedComment).toBeUndefined();
  expect(requestedPages(request).every(p => p.page === 1)).toBe(true);
});
it.each(['missing detail', 'missing chain'] as const)('notification target zero does not fabricate a root when %s', async mode => {
  const { p, c, entries, request } = fixture();
  c.rootId = 0;
  c.event.raw.item.root_id = 0;
  c.event.raw.item.target_id = 0;
  c.event.raw.item.target_reply_content = 'unverified parent notification';
  c.event.raw.item.root_reply_content = 'unverified root notification';
  if (mode === 'missing detail') delete entries[33];
  else { delete entries[33].root; delete entries[33].parent; }
  await p.hydrateSourceContext(c);
  expect(c.parentCommentId).toBeUndefined(); expect(c.parentComment).toBeUndefined();
  expect(c.rootComment).toBeUndefined(); expect(c.botRepliedComment).toBeUndefined();
  expect(requestedPages(request).every(p => p.page === 1)).toBe(true);
});
it.each(['hots', 'upper'] as const)('collects verified root-list %s entries without changing notification text', async slot => {
  const { p, c, request, entries, getComment } = fixture(); c.rootId = 0;
  getComment.mockRejectedValue(new Error('jump offline'));
  request.mockResolvedValue({ code: 0, data: { replies: [], hots: slot === 'hots' ? [entries[33], entries[32], entries[31], entries[30]] : [], upper: slot === 'upper' ? { top: { ...entries[30], replies: [entries[31], entries[32], entries[33]] } } : {}, page: { count: 0, size: 20 } } });
  await p.hydrateSourceContext(c);
  expect(c.parentComment?.text).toBe('parent user'); expect(c.rootComment?.text).toBe('root original');
  expect(c.botRepliedComment?.text).toBe('bot ancestor'); expect(c.message).toBe('current');
});
it('caps each shared listing scan at five pages even when more results exist', async () => {
  const { p, c, request, getComment } = fixture();
  getComment.mockRejectedValue(new Error('not found'));
  request.mockImplementation(async () => ({ code: 0, data: { replies: [{ rpid: '999', oid: '20', type: '1', root: '30', parent: '0', mid: '8', content: { message: 'unrelated' } }], page: { count: 10000, size: 20 } } }));
  await Promise.all([p.hydrateSourceContext(c), p.hydrateCommentImages(c)]);
  expect(requestedPages(request)).toEqual([
    ...[1, 2, 3, 4, 5].map(page => ({ path: '/x/v2/reply/reply', page, root: '30' })),
    ...[1, 2, 3, 4, 5].map(page => ({ path: '/x/v2/reply', page, root: null })),
  ]);
  expect(c.parentComment).toBeUndefined(); expect(c.images).toEqual([]); expect(c.message).toBe('current');
});
it('dialog failure still permits verified root-list context without unrelated pictures', async () => {
  const { p, c, request, entries, getComment } = fixture();
  getComment.mockRejectedValue(new Error('not found'));
  const original = request.getMockImplementation()!;
  entries[30].content.pictures = [{ img_src: 'https://example.com/root-only.jpg' }];
  request.mockImplementation(async (url, options) => {
    if (new URL(url).pathname === '/x/v2/reply/reply') throw new Error('dialog offline');
    return original(url, options);
  });
  await p.hydrateCommentImages(c); await p.hydrateSourceContext(c);
  expect(c.rootComment?.text).toBe('root original'); expect(c.parentComment).toBeUndefined();
  expect(c.images).toEqual([]); expect(c.message).toBe('current'); expect(request).toHaveBeenCalledTimes(2);
});
it('SDK 1.1.3 jump preserves oversized string identifiers without numeric conversion', async () => {
  const oid = '90071992547409931234', current = '90071992547409931235', parent = '90071992547409931236', root = '90071992547409931237';
  const entries = Object.fromEntries([[current, parent, root], [parent, root, root], [root, '0', '0']].map(([rpid, parent, root]) => [rpid, { rpid: Number(rpid), rpid_str: rpid, oid: Number(oid), oid_str: oid, type: '1', parent, root, mid: '7', content: { message: rpid } }]));
  const request = replyPagesMock(entries, oid);
  const p = PollerService.getInstance({ getClient: () => ({ userId: 99, request }) } as any);
  const c = p.buildSessionContext('at', { user: { mid: 7 }, item: { business_id: 1, subject_id: oid, source_id: current, root_id: root, source_content: 'current' } });
  await p.hydrateSourceContext(c);
  expect(c.parentCommentId).toBe(parent); expect(c.parentComment?.id).toBe(parent); expect(c.rootComment?.id).toBe(root);
  expect(requestedPages(request)).toEqual([]);
  expect(request.mock.calls.map(([url]) => new URL(url).searchParams.get('oid'))).toEqual([oid, oid, oid]);
});
it.each(['at', 'reply'] as const)('%s preserves identified snapshots without guessing author on failure', async kind => {
  const { p, request, getComment } = fixture(); getComment.mockRejectedValue(new Error('offline')); request.mockRejectedValue(new Error('offline'));
  const c = p.buildSessionContext(kind, { user: { mid: 7 }, item: { business_id: 1, subject_id: 20, source_id: 33, root_id: 30, target_id: 32, source_content: 'current', target_reply_content: 'parent snapshot', root_reply_content: 'root snapshot' } });
  await p.hydrateSourceContext(c);
  expect(c.parentComment).toEqual({ id: '32', authorId: '未知', text: '[通知快照] parent snapshot' });
  expect(c.rootComment).toEqual({ id: '30', authorId: '未知', text: '[通知快照] root snapshot' });
  expect(c.botRepliedComment).toBeUndefined(); expect(c.message).toBe('current');
});
it('supports album type 16 only with verified dynamic comment identity', async () => {
  const { p, c, request } = fixture(16);
  expect(c.sourceType).toBe('dynamic');
  await p.hydrateSourceContext(c);
  expect(c.dynamicBodyExcerpt).toBe('actual dynamic body'); expect(c.dynamicId).toBe('200');
  expect(c.parentComment?.text).toBe('parent user'); expect(request).not.toHaveBeenCalled();
});

it.each([11, 16, 17])('hydrates type %s from verified dynamic ID instead of calling unsupported Comment.getSubject', async type => {
  const { p, c, entries, getSubject } = fixture(type);
  entries[33].dynamic_id_str = '200';
  c.uri = '';
  await p.hydrateSourceContext(c);
  expect(getSubject).toHaveBeenCalledWith(expect.anything(), '200');
  expect(c.dynamicId).toBe('200');
  expect(c.dynamicBodyExcerpt).toBe('actual dynamic body');
});

it.each(['https://www.bilibili.com/opus/200', 'https://t.bilibili.com/200', 'https://m.bilibili.com/dynamic/200', 'bilibili://dynamic/200'])('resolves verified dynamic notification URI %s', async uri => {
  const { p, c, getSubject } = fixture(11); c.uri = uri;
  await p.hydrateSourceContext(c);
  expect(getSubject).toHaveBeenCalledWith(expect.anything(), '200');
  expect(c.dynamicId).toBe('200');
});

it.each(['', 'https://www.bilibili.com.evil.example/opus/200', 'file:///opus/200', 'https://evil.example/200', 'https://u:p@www.bilibili.com/opus/200'])('does not treat an album oid or untrusted URI %s as a dynamic ID', async uri => {
  const { p, c, getSubject } = fixture(11); c.uri = uri;
  await p.hydrateSourceContext(c);
  expect(getSubject).not.toHaveBeenCalled();
  expect(c.dynamicId).toBeUndefined(); expect(c.dynamicBodyExcerpt).toBeUndefined();
  expect(c.parentComment?.id).toBe('32');
});

it('word dynamic may use exact string oid but album may not', async () => {
  const { p, c, getSubject, subject } = fixture(17);
  c.uri = ''; subject.data.item!.id_str = '20';
  await p.hydrateSourceContext(c);
  expect(getSubject).toHaveBeenCalledWith(expect.anything(), '20');
  expect(c.dynamicId).toBe('20');
});

it.each(['missing', 'code', 'throw', 'oid', 'type', 'id'] as const)('dynamic source %s stays unavailable while exact ancestry remains', async mode => {
  const { p, c, getSubject, subject } = fixture(11);
  if (mode === 'throw') getSubject.mockRejectedValue(new Error('offline'));
  else if (mode === 'missing') getSubject.mockResolvedValue({ code: 0, data: null } as any);
  else if (mode === 'code') getSubject.mockResolvedValue({ ...subject, code: -404 } as any);
  else if (mode === 'oid') subject.data.item!.basic.comment_id_str = '999';
  else if (mode === 'type') subject.data.item!.basic.comment_type = 17;
  else subject.data.item!.id_str = '999';
  await p.hydrateSourceContext(c);
  expect(c.dynamicId).toBeUndefined(); expect(c.dynamicBodyExcerpt).toBeUndefined();
  expect(c.parentComment?.id).toBe('32');
});

it.each(['code', 'missing', 'aid', 'throw'] as const)('video source %s never reuses notification summary', async mode => {
  const { p, c, getSubject, subject } = fixture();
  if (mode === 'throw') getSubject.mockRejectedValue(new Error('offline'));
  else if (mode === 'missing') getSubject.mockResolvedValue({ code: 0, data: null } as any);
  else if (mode === 'code') getSubject.mockResolvedValue({ ...subject, code: -404 } as any);
  else subject.data.aid = 999;
  await p.hydrateSourceContext(c);
  expect(c.videoBvid).toBeUndefined(); expect(c.actualVideoTitle).toBeUndefined();
  expect(c.parentComment?.id).toBe('32');
});

it('supports opus summary module arrays and truncates the real body to 500 characters', async () => {
  const { p, c, getSubject } = fixture(11);
  getSubject.mockResolvedValue({ code: 0, data: { item: { id_str: '200', basic: { comment_id_str: '20', comment_type: 11 }, modules: [{ module_dynamic: { major: { opus: { summary: { text: 'a'.repeat(800) } } } } }] } } } as any);
  await p.hydrateSourceContext(c);
  expect(c.dynamicBodyExcerpt).toBe('a'.repeat(500));
});

it('nonzero jump code ignores even a matching payload and uses verified list fallback', async () => {
  const { p, c, getComment, entries, request } = fixture();
  getComment.mockResolvedValue({ code: -400, data: { ...entries[33], content: { pictures: [{ img_src: 'https://example.com/untrusted.jpg' }] } } } as any);
  await p.hydrateCommentImages(c);
  expect(c.images).toEqual([]); expect(requestedPages(request)).toHaveLength(2);
});

it('SDK list declaration bridge preserves oversized oid and root strings after jump is missing', async () => {
  const oid = '90071992547409931234', root = '90071992547409931235';
  const entries = { [root]: { rpid_str: root, oid_str: oid, type: 17, root: 0, parent: 0, mid: 7, content: { message: '', pictures: [{ img_src: 'https://example.com/current.jpg' }] } } };
  vi.spyOn(CommentAPI, 'getReply').mockResolvedValue({ code: 0, data: null } as any);
  const request = replyPagesMock(entries, oid, 17);
  const p = PollerService.getInstance({ getClient: () => ({ request }) } as any);
  const c = p.buildSessionContext('at', { item: { business_id: 17, subject_id: oid, source_id: root, root_id: root }, user: { mid: 7 } });
  await p.hydrateCommentImages(c);
  expect(c.images).toEqual(['https://example.com/current.jpg']);
  expect(requestedPages(request)).toEqual([{ path: '/x/v2/reply/reply', page: 1, root }, { path: '/x/v2/reply', page: 1, root: null }]);
});