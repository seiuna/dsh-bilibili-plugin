import { afterEach, expect, it, vi } from 'vitest';
import { registerBilibiliTools } from '../src/tools.js';
afterEach(() => vi.restoreAllMocks());
function harness(response: unknown) {
  const request = vi.fn(async () => response);
  const registered = new Map<string, any>();
  registerBilibiliTools({ register: t => registered.set(t.name, t) }, { getClient: () => ({ request }) } as any);
  return { tool: registered.get('bilibili_get_comments'), request };
}
const reply = (id: number, message = 'comment') => ({ rpid: id, content: { message }, member: { uname: 'user', mid: 1 }, replies: [] });
it.each([-412, -101, 12002])('reports API failure %s instead of zero comments', async code => {
  const h = harness({ code });
  await expect(h.tool.execute({ aid: 123 })).rejects.toThrow('code=' + code);
});
it.each([undefined, {}, { page: {} }, { page: {}, replies: {} }])('rejects malformed data %j', async data => {
  const h = harness({ code: 0, data });
  await expect(h.tool.execute({ aid: 123 })).rejects.toThrow();
});
it('merges pinned, hot and normal replies without duplicates and renders child replies', async () => {
  const pinned = reply(1); const hot = { ...reply(2), replies: [reply(4, 'child')] };
  const h = harness({ code: 0, data: { page: { acount: 3 }, top: { upper: pinned }, hots: [hot], replies: [pinned, hot, reply(3)] } });
  const result = await h.tool.execute({ bvid: 'BV1DGbN66EPT', sort: 'hot' });
  expect(result.comments.map((r: any) => r.rpid)).toEqual([1, 2, 3]);
  expect(h.tool.output.render({}, result)[0].text).toContain('child');
  expect(new URL(h.request.mock.calls[0][0] as string).searchParams.get('sort')).toBe('1');
});
it('preserves latest order and distinguishes a valid empty page', async () => {
  const h = harness({ code: 0, data: { page: { acount: 0 }, replies: null } });
  const result = await h.tool.execute({ aid: 123, sort: 'time' });
  expect(result.status).toBe('empty'); expect(result.comments).toEqual([]);
  expect(result.notice).toContain('本页');
  expect(new URL(h.request.mock.calls[0][0] as string).searchParams.get('sort')).toBe('0');
});
it('propagates network errors rather than returning an empty list', async () => {
  const h = harness(null); h.request.mockRejectedValueOnce(new Error('network failure'));
  await expect(h.tool.execute({ aid: 123 })).rejects.toThrow('network failure');
});
