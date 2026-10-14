import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBilibiliImage, parseBilibiliImageUrl } from '../src/network/bilibili-image.js';
import { BilibiliAgentBridge } from '../src/agent-bridge.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const url = 'https://i0.hdslb.com/bfs/face/test.png';

describe('Bilibili shared image boundary', () => {
  it.each(['https://evilhdslb.com/a', 'https://hdslb.com.evil.test/a', 'https://127.0.0.1/a', 'https://localhost/a', 'file:///a', 'https://user:pwd@i0.hdslb.com/a', 'https://i0.hdslb.com:8080/a'])('rejects non-CDN target without network: %s', async target => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(downloadBilibiliImage(target)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('normalizes legacy URLs and uses redirect:error', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await downloadBilibiliImage('//i0.hdslb.com/test.png');
    expect(result).toEqual({ data: new Uint8Array([1, 2]), mediaType: 'image/png', extension: 'png' });
    expect(parseBilibiliImageUrl('http://i0.hdslb.com/test.png').protocol).toBe('https:');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });
  it.each([
    () => new Response('error', { status: 503 }),
    () => new Response('markup', { headers: { 'content-type': 'text/html' } }),
    () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
    () => new Response('', { headers: { 'content-type': 'image/png' } }),
    () => new Response('xx', { headers: { 'content-type': 'image/png', 'content-length': '100' } }),
    () => new Response('123456', { headers: { 'content-type': 'image/png' } }),
  ])('rejects failed, missing, unsupported, and oversized bodies', async response => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    await expect(downloadBilibiliImage(url, { maxBytes: 5 })).rejects.toThrow();
  });
  it('propagates transport errors rather than fabricating image data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(downloadBilibiliImage(url)).rejects.toThrow('offline');
  });
  it('honors cancellation before a request', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController(); controller.abort();
    await expect(downloadBilibiliImage(url, { signal: controller.signal })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('saves real attachment blocks only after a valid download, skips missing service', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('png', { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetcher);
    const bridge = new BilibiliAgentBridge({} as never);
    const saveImage = vi.fn().mockResolvedValue({ attachmentId: 'test-attachment' });
    try {
      expect(await (bridge as any).downloadAndCreateImageBlock(url, undefined)).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
      expect(await (bridge as any).downloadAndCreateImageBlock(url, { saveImage })).toEqual({ type: 'image', attachment: { attachmentId: 'test-attachment' } });
      expect(saveImage.mock.calls[0][0]).toMatchObject({ name: 'bilibili_image.png', mediaType: 'image/png' });
      expect(await (bridge as any).downloadAndCreateImageBlock('https://localhost/a', { saveImage })).toBeNull();
      expect(saveImage).toHaveBeenCalledTimes(1);
    } finally { bridge.dispose(); }
  });
});
