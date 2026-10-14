import { NotifyURIHelper, ReplyType } from '@seiuna/bilibili-api';

/** IDs are identifiers, not quantities. Never stringify an already rounded number. */
export function commentId(value: unknown): string | undefined {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) return;
  return (typeof value === 'string' || typeof value === 'number') && /^[1-9]\d*$/.test(String(value))
    ? String(value) : undefined;
}

export function isCommentBusiness(value: unknown): value is number {
  return typeof value === 'number' && [ReplyType.VIDEO, ReplyType.DYNAMIC, ReplyType.ARTICLE,
    ReplyType.AUDIO, ReplyType.ALBUM, ReplyType.WORD_DYNAMIC, ReplyType.COMIC, ReplyType.COURSE].includes(value);
}

/** SDK 1.1.3 handles opus URLs; retain only the other known Bilibili notification formats. */
export function dynamicIdFromUri(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (url.username || url.password) return;
    if (url.protocol === 'bilibili:') {
      return url.hostname === 'dynamic' ? commentId(url.pathname.slice(1)) : undefined;
    }
    if (!['https:', 'http:'].includes(url.protocol)) return;
    const host = url.hostname.toLowerCase();
    if (!['www.bilibili.com', 'm.bilibili.com', 't.bilibili.com'].includes(host)) return;
    const sdkId = commentId(new NotifyURIHelper(value).dynamicId);
    if (sdkId) return sdkId;
    const match = host === 't.bilibili.com'
      ? url.pathname.match(/^\/(\d+)\/?$/)
      : url.pathname.match(/^\/dynamic\/(\d+)\/?$/);
    return commentId(match?.[1]);
  } catch { return; }
}

export function commentKey(context: { businessId: number; subjectId: string | number; sourceId: string | number }): string {
  return `${context.businessId}_${context.subjectId}_${context.sourceId}`;
}
