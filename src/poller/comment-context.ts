import { CommentAPI, DynamicAPI, ReplyType, VideoAPI } from '@seiuna/bilibili-api';
import type { BiliClient, BiliApiResponse, ReplyEntry } from '@seiuna/bilibili-api';
import type { BiliSessionContext } from '../types.js';
import { commentId, dynamicIdFromUri, isCommentBusiness } from './identifiers.js';

/** Response identity string fields are authoritative when the numeric counterpart is rounded. */
export type ExactComment = Omit<Partial<ReplyEntry>, 'rpid' | 'oid' | 'root' | 'parent' | 'mid' | 'type' | 'content' | 'replies' | 'member'> & {
  rpid?: string | number; oid?: string | number; oid_str?: string;
  root?: string | number; root_str?: string; parent?: string | number; parent_str?: string;
  mid?: string | number; type?: string | number;
  member?: { mid?: string | number };
  content?: { message?: string; pictures?: Array<{ img_src?: string }> };
  replies?: ExactComment[] | null;
};

type PageData = {
  root?: ExactComment; replies?: ExactComment[] | null; hots?: ExactComment[] | null;
  upper?: { top?: ExactComment | null } | null;
  page?: { count?: number; acount?: number; size?: number };
};

// 1.1.3's single-page implementations serialize IDs with String(), but declarations
// still restrict oid/root to number and incorrectly type dialog data as ReplyMainData.
// Keep the declaration bridge local; never convert a long identifier to number.
const getReplies = CommentAPI.getReplies as unknown as (client: BiliClient<any>, oid: string,
  type: number, sort: 0, nohot: 0, page: number, size: number) => Promise<BiliApiResponse<PageData>>;
const getReplyDialog = CommentAPI.getReplyDialog as unknown as (client: BiliClient<any>, oid: string,
  root: string, type: number, page: number, size: number) => Promise<BiliApiResponse<PageData>>;

function commentText(entry?: ExactComment): BiliSessionContext['parentComment'] {
  const id = commentId(entry?.rpid_str ?? entry?.rpid);
  const authorId = commentId(entry?.mid) ?? commentId(entry?.member?.mid);
  return id && authorId && typeof entry?.content?.message === 'string'
    ? { id, authorId, text: entry.content.message } : undefined;
}

export class CommentContextResolver {
  private readonly direct = new WeakMap<BiliSessionContext, Map<string, Promise<ExactComment | undefined>>>();
  private readonly scans = new WeakMap<BiliSessionContext, Promise<Map<string, ExactComment>>>();

  constructor(private readonly getClient: () => BiliClient<any>, private readonly warn: (message: string) => void) {}

  private matches(entry: ExactComment | null | undefined, oid: string, type: number): entry is ExactComment {
    return !!entry && commentId(entry.oid_str ?? entry.oid) === oid && String(entry.type) === String(type);
  }

  async exact(context: BiliSessionContext, value: unknown): Promise<ExactComment | undefined> {
    const id = commentId(value), oid = commentId(context.subjectId);
    if (!id || !oid || !isCommentBusiness(context.businessId)) return;
    let cache = this.direct.get(context);
    if (!cache) { cache = new Map(); this.direct.set(context, cache); }
    const key = `${oid}:${context.businessId}:${id}`;
    let query = cache.get(key);
    if (!query) {
      query = (async () => {
        try {
          // SDK 1.1.3 accepts string oid/rpid and preserves non-zero API codes.
          const response = await CommentAPI.getReply(this.getClient(), oid, context.businessId, id);
          const entry = response.data;
          if (response.code === 0 && this.matches(entry, oid, context.businessId)
            && commentId(entry.rpid_str ?? entry.rpid) === id) return entry;
        } catch { this.warn('单条评论定位失败，尝试有界列表回退'); }
        return undefined;
      })();
      cache.set(key, query);
    }
    const entry = await query;
    if (entry) return entry;
    let scan = this.scans.get(context);
    if (!scan) { scan = this.scan(context, oid); this.scans.set(context, scan); }
    return (await scan).get(id);
  }

  private async scan(context: BiliSessionContext, oid: string): Promise<Map<string, ExactComment>> {
    const entries = new Map<string, ExactComment>();
    const collect = (entry: ExactComment | null | undefined, depth = 0) => {
      if (depth > 8 || !this.matches(entry, oid, context.businessId)) return;
      const id = commentId(entry.rpid_str ?? entry.rpid);
      if (!id) return;
      entries.set(id, entry);
      if (Array.isArray(entry.replies)) for (const child of entry.replies) collect(child, depth + 1);
    };
    const root = commentId(context.rootId);
    const scanPages = async (dialog: boolean) => {
      for (let pn = 1; pn <= 5; pn++) {
        try {
          const result = dialog
            ? await getReplyDialog(this.getClient(), oid, root!, context.businessId, pn, 20)
            : await getReplies(this.getClient(), oid, context.businessId, 0, 0, pn, 20);
          if (result.code !== 0 || !result.data) { this.warn(`评论分页响应不可用，code=${result.code}`); break; }
          const data = result.data;
          collect(data.root); collect(data.upper?.top);
          if (Array.isArray(data.hots)) data.hots.forEach(entry => collect(entry));
          if (Array.isArray(data.replies)) data.replies.forEach(entry => collect(entry));
          const total = dialog ? data.page?.count : data.page?.acount;
          if (!data.replies?.length || (typeof total === 'number' && typeof data.page?.size === 'number'
            && data.page.size > 0 && pn * data.page.size >= total)) break;
        } catch { this.warn('评论分页查询失败，缺失上下文保持未知'); break; }
      }
    };
    if (root) await scanPages(true);
    // The SDK generator omits data.root. Single pages preserve incoming root pictures,
    // pinned/hot comments, and an independent fallback when dialog retrieval fails.
    await scanPages(false);
    return entries;
  }

  async hydrateImages(context: BiliSessionContext): Promise<void> {
    context.images = [];
    const entry = await this.exact(context, context.sourceId);
    if (Array.isArray(entry?.content?.pictures)) {
      context.images = [...new Set(entry.content.pictures.map(pic => pic?.img_src)
        .filter((src): src is string => typeof src === 'string' && /^https?:\/\//i.test(src)))];
    }
  }

  private async hydrateSubject(context: BiliSessionContext, incoming?: ExactComment): Promise<void> {
    if (!incoming) return;
    try {
      if (context.businessId === ReplyType.VIDEO) {
        const oid = commentId(context.subjectId)!;
        // Video aid remains number-only in the SDK; skip impossible IDs rather than round.
        const aid = Number(oid);
        if (!Number.isSafeInteger(aid) || String(aid) !== oid) return;
        const response = await VideoAPI.getInfoByAid(this.getClient(), aid);
        if (response.code !== 0 || !response.data || commentId(response.data.aid) !== oid) return;
        if (typeof response.data.title === 'string') context.actualVideoTitle = response.data.title;
        if (typeof response.data.bvid === 'string') context.videoBvid = response.data.bvid;
        return;
      }
      if (![ReplyType.DYNAMIC, ReplyType.ALBUM, ReplyType.WORD_DYNAMIC].includes(context.businessId)) return;
      const dynamicId = commentId(incoming.dynamic_id_str)
        ?? dynamicIdFromUri(context.uri)
        ?? (context.businessId === ReplyType.WORD_DYNAMIC ? commentId(context.subjectId) : undefined);
      if (!dynamicId) return;
      const response = await DynamicAPI.getDetail(this.getClient(), dynamicId);
      const item = response.data?.item;
      if (response.code !== 0 || !item || commentId(item.id_str) !== dynamicId
        || commentId(item.basic?.comment_id_str) !== commentId(context.subjectId)
        || String(item.basic?.comment_type) !== String(context.businessId)) return;
      context.dynamicId = dynamicId;
      const modules = item.modules;
      const dynamic = Array.isArray(modules) ? modules.find(module => module.module_dynamic)?.module_dynamic : modules?.module_dynamic;
      const desc = dynamic?.desc;
      const description = desc && typeof desc === 'object' && 'text' in desc ? desc.text : undefined;
      const body = typeof description === 'string' ? description : dynamic?.major?.opus?.summary?.text;
      if (typeof body === 'string') context.dynamicBodyExcerpt = body.slice(0, 500);
    } catch { this.warn('获取来源正文失败，来源保持未知'); }
  }

  async hydrateSource(context: BiliSessionContext): Promise<void> {
    delete context.actualVideoTitle; delete context.videoBvid; delete context.dynamicId;
    delete context.parentCommentId; delete context.dynamicBodyExcerpt; delete context.rootComment;
    delete context.parentComment; delete context.botRepliedComment;
    if (!context.subjectId || !context.sourceId) return;
    const incoming = await this.exact(context, context.sourceId);
    await this.hydrateSubject(context, incoming);
    const rawTarget = commentId(context.event.raw?.item?.target_id);
    const parentValue = incoming?.parent_str ?? incoming?.parent;
    // Only exact zero establishes no parent, not a missing field or failed lookup.
    const parentId = parentValue != null ? commentId(parentValue) : rawTarget;
    if (parentId && parentId !== String(context.sourceId)) context.parentCommentId = parentId;
    const rootValue = incoming?.root_str ?? incoming?.root;
    const rootId = rootValue != null
      ? (String(rootValue) === '0' ? commentId(context.sourceId) : commentId(rootValue))
      : commentId(context.rootId);
    const [parent, root] = await Promise.all([
      context.parentCommentId ? this.exact(context, context.parentCommentId) : undefined,
      rootId && rootId !== String(context.sourceId) ? this.exact(context, rootId) : undefined,
    ]);
    context.parentComment = commentText(parent); context.rootComment = commentText(root);
    if (!context.parentComment && context.parentCommentId && context.parentCommentId === rawTarget && context.targetReplyContent) {
      context.parentComment = { id: rawTarget!, authorId: '未知', text: '[通知快照] ' + context.targetReplyContent };
    }
    if (!context.rootComment && rootId && rootId !== String(context.sourceId)
      && rootId === commentId(context.rootId) && context.rootReplyContent) {
      context.rootComment = { id: rootId, authorId: '未知', text: '[通知快照] ' + context.rootReplyContent };
    }
    const botId = commentId(this.getClient().userId);
    let ancestor = parent;
    const visited = new Set<string>([String(context.sourceId)]);
    for (let depth = 0; ancestor && depth < 8; depth++) {
      const comment = commentText(ancestor);
      if (!comment || visited.has(comment.id)) break;
      visited.add(comment.id);
      if (botId && comment.authorId === botId) { context.botRepliedComment = comment; break; }
      ancestor = await this.exact(context, ancestor.parent_str ?? ancestor.parent);
    }
  }
}
