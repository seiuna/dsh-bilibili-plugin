import { it, expect, vi, afterEach, beforeEach } from 'vitest';
import { CommentAPI, VideoAPI } from '@seiuna/bilibili-api';
import { PollerService } from '../src/poller-service.js';
import { replyPagesMock, requestedPages } from './reply-detail-mock.js';
let testTempDir: string;
beforeEach(async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  testTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bili-img-test-'));
  vi.stubEnv('BILIBILI_POLLER_CONFIG_PATH', path.join(testTempDir, 'config.json'));
  vi.stubEnv('BILIBILI_PROMPT_PATH', path.join(testTempDir, 'prompt.md'));
  // These listing regressions explicitly exercise the SDK not-found fallback.
  vi.spyOn(CommentAPI, 'getReply').mockResolvedValue({ code: 0, data: null } as any);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('offline tests prohibit network'); }));
  vi.spyOn(VideoAPI, 'getInfoByAid').mockResolvedValue({ code: 0, data: {} } as any);
});
afterEach(async () => {
  await (PollerService as any).instance?.flushRecentMessages();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  (PollerService as any).instance = null;
  if (testTempDir) {
    const fs = await import('node:fs/promises');
    await fs.rm(testTempDir, { recursive: true, force: true }).catch(() => {});
  }
});
function fixture(sourceId = 31, notifyType: 'at' | 'reply' = 'reply') {
  (PollerService as any).instance = null;
  const entries: Record<string, any> = {
    30: { rpid: 30, oid: 20, type: 1, root: 0, parent: 0, mid: 2, content: { message: 'parent', pictures: [{ img_src: 'https://example.com/parent.jpg' }] } },
    31: { rpid: 31, oid: 20, type: 1, root: 30, parent: 30, mid: 1, content: { message: '', pictures: [{ img_src: 'https://example.com/comment.jpg' }] } },
  };
  const request = replyPagesMock(entries);
  const poller = PollerService.getInstance({ getClient: () => ({ request }) } as any);
  const context = poller.buildSessionContext(notifyType, { user: { mid: 1 }, item: { business_id: 1, subject_id: 20, source_id: sourceId, root_id: sourceId === 30 ? 0 : 30, image: 'https://example.com/dynamic.jpg', pictures: [{ img_src: 'https://example.com/cover.jpg' }], target_reply_content: 'https://example.com/parent.jpg' } });
  return { poller, context, request, entries };
}
it.each(['at', 'reply'] as const)('%s image-only dispatch uses exact incoming pictures and shares pagination cache with text', async type => {
  const { poller, context, request } = fixture(31, type);
  expect(context.images).toEqual([]);
  const handler = vi.fn(); poller.setDshHandler(handler);
  await poller.dispatch(context);
  expect(context.images).toEqual(['https://example.com/comment.jpg']);
  expect(handler).toHaveBeenCalledWith(context);
  expect(requestedPages(request)).toEqual([{ path: '/x/v2/reply/reply', page: 1, root: '30' }, { path: '/x/v2/reply', page: 1, root: null }]);
});
it('supports pictures on the incoming top-level root itself', async () => {
  const { poller, context, request } = fixture(30);
  await poller.hydrateCommentImages(context); await poller.hydrateSourceContext(context);
  expect(context.images).toEqual(['https://example.com/parent.jpg']);
  expect(context.parentComment).toBeUndefined();
  expect(requestedPages(request)).toEqual([{ path: '/x/v2/reply', page: 1, root: null }]);
});
it('no current pictures means no parent, root, notification or cover fallback', async () => {
  const { poller, context, entries } = fixture(); entries[31].content = { message: 'text' };
  await poller.hydrateCommentImages(context); await poller.hydrateSourceContext(context);
  expect(context.images).toEqual([]); expect(context.parentComment?.text).toBe('parent');
});
it.each(['missing', 'failure', 'rpid', 'oid', 'type'] as const)('%s listing preserves text dispatch without unrelated images', async mode => {
  const { poller, context, entries, request } = fixture(); context.message = 'hello';
  if (mode === 'missing') delete entries[31];
  else if (mode === 'failure') request.mockRejectedValue(new Error('offline'));
  else entries[31][mode] = '999';
  const handler = vi.fn(); poller.setDshHandler(handler); await poller.dispatch(context);
  expect(context.images).toEqual([]); expect(handler).toHaveBeenCalled(); expect(context.message).toBe('hello');
  expect(requestedPages(request)).toHaveLength(2);
});
it('concurrent text and image hydration shares the in-flight listing scan', async () => {
  const { poller, context, request } = fixture();
  await Promise.all([poller.hydrateSourceContext(context), poller.hydrateCommentImages(context)]);
  expect(context.images).toEqual(['https://example.com/comment.jpg']);
  expect(context.parentComment?.text).toBe('parent');
  expect(requestedPages(request)).toEqual([{ path: '/x/v2/reply/reply', page: 1, root: '30' }, { path: '/x/v2/reply', page: 1, root: null }]);
});
it('does not share cached current images across separate notification contexts', async () => {
  const { poller, context, entries, request } = fixture();
  await poller.hydrateCommentImages(context);
  entries[31].content.pictures = [{ img_src: 'https://example.com/updated.jpg' }];
  const second = poller.buildSessionContext('reply', context.event.raw);
  await poller.hydrateCommentImages(second);
  expect(context.images).toEqual(['https://example.com/comment.jpg']);
  expect(second.images).toEqual(['https://example.com/updated.jpg']);
  expect(requestedPages(request)).toHaveLength(4);
});