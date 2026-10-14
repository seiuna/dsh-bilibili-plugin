import { expect, vi } from 'vitest';

/** Offline SDK 1.1.3 transport: accurate jump envelope and bounded listing pages. */
export function replyPagesMock(entries: Record<string, any>, oid: string | number = 20, type: string | number = 1) {
  return vi.fn(async (url: string, options?: { method?: string }): Promise<any> => {
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://api.bilibili.com');
    expect(['/x/v2/reply/jump', '/x/v2/reply/reply', '/x/v2/reply']).toContain(parsed.pathname);
    expect(options?.method ?? 'GET').toBe('GET');
    expect(parsed.searchParams.get('oid')).toBe(String(oid));
    expect(parsed.searchParams.get('type')).toBe(String(type));
    if (parsed.pathname === '/x/v2/reply/jump') {
      const rpid = parsed.searchParams.get('rpid');
      expect(rpid).toMatch(/^[1-9][0-9]*$/);
      expect(parsed.searchParams.get('pn')).toBeNull();
      const entry = entries[rpid!];
      // Do not fill missing/mismatched identity fields: production must validate them.
      const root = entry && entries[String(entry.root_str ?? entry.root)];
      return { code: 0, message: '0', ttl: 1, data: { root: root ?? null, replies: entry ? [entry] : [] } };
    }
    expect(parsed.searchParams.get('rpid')).toBeNull();
    const pn = Number(parsed.searchParams.get('pn')), ps = Number(parsed.searchParams.get('ps'));
    expect(pn).toBeGreaterThanOrEqual(1); expect(ps).toBe(20);
    const dialog = parsed.pathname.endsWith('/reply/reply');
    const root = parsed.searchParams.get('root');
    if (dialog) expect(root).toMatch(/^[1-9][0-9]*$/);
    else expect(parsed.searchParams.get('sort')).toBe('0');
    const all = Object.values(entries);
    const rows = all.filter(e => dialog ? String(e.root_str ?? e.root) === root : String(e.root_str ?? e.root ?? '0') === '0');
    const replies = rows.slice((pn - 1) * ps, pn * ps);
    return { code: 0, data: dialog
      ? { root: entries[root!], replies, page: { count: rows.length, acount: rows.length, size: ps } }
      : { replies, hots: [], upper: {}, page: { count: rows.length, acount: rows.length, size: ps } } };
  });
}
export function requestedPages(request: ReturnType<typeof replyPagesMock>) {
  return request.mock.calls.filter(([url]) => new URL(url).pathname !== '/x/v2/reply/jump').map(([url]) => {
    const parsed = new URL(url);
    return { path: parsed.pathname, page: Number(parsed.searchParams.get('pn')), root: parsed.searchParams.get('root') };
  });
}
