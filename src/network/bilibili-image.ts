/** Shared, bounded downloader for avatars and exact-comment image attachments. */
const IMAGE_HOSTS = ['hdslb.com', 'biliimg.com', 'bilibili.com'];
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export type BilibiliImageMediaType = typeof MEDIA_TYPES[number];

export interface DownloadedImage {
  data: Uint8Array;
  mediaType: BilibiliImageMediaType;
  extension: string;
}

export function parseBilibiliImageUrl(input: string): URL {
  const url = new URL(input.startsWith('//') ? `https:${input}` : input);
  if (!IMAGE_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) ||
      url.username || url.password || url.port || !['https:', 'http:'].includes(url.protocol)) {
    throw new Error('不允许的 B站图片地址');
  }
  // Legacy Bilibili avatar URLs may still carry http; never send an insecure request.
  url.protocol = 'https:';
  return url;
}

export async function downloadBilibiliImage(
  input: string,
  options: { timeoutMs?: number; maxBytes?: number; signal?: AbortSignal } = {},
): Promise<DownloadedImage> {
  const url = parseBilibiliImageUrl(input);
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('图片下载限制无效');
  }
  const signal = AbortSignal.any([
    AbortSignal.timeout(timeoutMs),
    ...(options.signal ? [options.signal] : []),
  ]);
  signal.throwIfAborted();
  const response = await fetch(url, {
    signal,
    // Do not follow a trusted CDN redirect into an untrusted or private target.
    redirect: 'error',
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' },
  });
  const rejectBody = async (message: string): Promise<never> => {
    await response.body?.cancel().catch(() => {});
    throw new Error(message);
  };
  if (!response.ok) return rejectBody(`图片下载失败: HTTP ${response.status}`);
  if (response.redirected) return rejectBody('图片重定向被拒绝');
  const contentLength = response.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) {
    return rejectBody('图片超过下载大小限制');
  }
  const mediaType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!MEDIA_TYPES.includes(mediaType as BilibiliImageMediaType)) return rejectBody('不支持的图片类型');
  if (!response.body) throw new Error('图片响应缺少正文');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('图片超过下载大小限制');
      chunks.push(value);
    }
    signal.throwIfAborted();
    if (!size) throw new Error('图片响应为空');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return { data, mediaType: mediaType as BilibiliImageMediaType, extension: mediaType === 'image/jpeg' ? 'jpg' : mediaType!.slice(6) };
}
