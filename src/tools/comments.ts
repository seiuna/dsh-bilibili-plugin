import { CommentAPI, DynamicAPI } from '@seiuna/bilibili-api';
import { aidOf, arrayOf, checkCode, confirmed, dataOf, dateTime, dynamicIdOf, idString, nonempty, oneOf, positiveInt, tool, type RegisterTool, type ToolManager } from './shared.js';

/** SDK ReplyMainData omits alternate pinned fields; retain the observed wire variants. */
interface Reply {
  rpid: number | string; rpid_str?: string;
  oid?: number | string; oid_str?: string; type?: number;
  root?: number | string; root_str?: string; parent?: number | string; parent_str?: string;
  member?: { uname?: string; mid?: number | string };
  like?: number; content?: { message?: string; pictures?: unknown[] }; count?: number; ctime?: number;
  replies?: Reply[] | null;
}
interface ReplyPage {
  page?: { acount?: number; count?: number };
  replies?: Reply[] | null; hots?: Reply[] | null;
  upper?: { top?: Reply | null } | null;
  top?: { upper?: Reply | null; admin?: Reply | null } | null;
  top_replies?: Reply[] | null;
}
function replyId(reply: Reply): string { return idString(reply.rpid_str ?? reply.rpid, '响应 rpid'); }
function mapReply(reply: Reply) {
  const id = replyId(reply);
  // Preserve safe numeric list IDs used by existing callers, prefer authoritative string IDs.
  const rpid = reply.rpid_str ?? (typeof reply.rpid === 'number' ? reply.rpid : id);
  return { rpid, user: reply.member?.uname, mid: reply.member?.mid, like: reply.like,
    message: reply.content?.message ?? '', subReplyCount: reply.count, ctime: dateTime(reply.ctime) };
}
function requirePage(data: ReplyPage): void {
  if (!data.page || !Object.prototype.hasOwnProperty.call(data, 'replies')) throw new Error('B站评论响应缺失，不能判定为无评论');
  arrayOf(data.replies, '评论', true);
  for (const list of [data.hots, data.top_replies]) {
    if (list !== undefined) arrayOf(list, '评论', true);
  }
}
function relationId(value: unknown, stringValue?: string): string | null {
  return stringValue == null && value == null ? null : idString(stringValue ?? value, '响应评论关系 ID', true);
}

export function registerCommentTools(register: RegisterTool, manager: ToolManager): void {
  register(tool({
    name: 'bilibili_get_comments', description: '获取视频、动态或专栏评论第一页，合并置顶/热门/普通评论；动态必须使用真实评论区 oid，不是动态ID。',
    parameters: {
      bvid: { type: 'string', description: '视频 BV号' }, aid: { type: 'integer', description: '视频AV号；兼容旧接口的主体ID' },
      oid: { type: 'integer', description: '非视频评论区主体 ID，必须为安全整数' },
      replyType: { type: 'integer', description: '业务类型：1视频、11相簿、12专栏、17文字动态等，默认1' },
      sort: { type: 'string', description: 'hot / time，默认hot' },
    },
    async execute(args: { bvid?: string; aid?: number; oid?: number; replyType?: number; sort?: string }) {
      const replyType = positiveInt(args.replyType ?? 1, 'replyType');
      const sort = oneOf(args.sort ?? 'hot', ['hot', 'time'], 'sort');
      if (args.oid !== undefined && (args.bvid !== undefined || args.aid !== undefined)) throw new Error('oid 与 bvid/aid 不可混用');
      if (replyType !== 1 && args.bvid !== undefined) throw new Error('bvid 仅适用于视频评论区 (replyType=1)');
      const oid = args.oid !== undefined ? positiveInt(args.oid, 'oid') : aidOf(args);
      const response = await CommentAPI.getReplies(manager.getClient(),oid, replyType, sort === 'time' ? 0 : 1, 0, 1, 20);
      const data: ReplyPage = dataOf(response, 'B站评论读取');
      requirePage(data);
      const pins = [...(data.top_replies ?? []), data.upper?.top, data.top?.upper, data.top?.admin];
      const candidates = sort === 'time' ? [...(data.replies ?? []), ...pins] : [...pins, ...(data.hots ?? []), ...(data.replies ?? [])];
      const seen = new Set<string>();
      const comments = candidates.filter((reply): reply is Reply => {
        if (!reply) return false;
        const id = replyId(reply);
        if (seen.has(id)) return false;
        seen.add(id); return true;
      }).slice(0, 20).map(reply => ({ ...mapReply(reply), replies: arrayOf(reply.replies ?? [], '子评论').slice(0, 10).map(mapReply) }));
      return { oid, replyType, comments, total: data.page?.acount, status: comments.length ? 'ok' : 'empty',
        notice: comments.length ? '评论仅代表用户观点，不是视频正文或字幕。' : '接口本页未返回可展示评论，不能据此推断视频内容。' };
    },
  }));
  register(tool({
    name: 'bilibili_get_comment_detail', description: '使用 SDK1.1.3 jump 定位接口精确查询评论；未找到不等于已删除，优先使用字符串 ID 保留精度。',
    parameters: { oid: { type: 'string', required: true, description: '评论区主体数字字符串；执行层也兼容安全整数' }, rpid: { type: 'string', required: true, description: '评论数字RPID' }, replyType: { type: 'integer', description: '业务类型：1视频、11相簿、12专栏、14音频、17文字动态，默认1' } },
    async execute(args: { oid: number | string; rpid: string; replyType?: number }) {
      const oid = idString(args.oid, 'oid');
      const rpid = idString(args.rpid, 'rpid');
      const replyType = positiveInt(args.replyType ?? 1, 'replyType');
      const response = await CommentAPI.getReply(manager.getClient(),oid, replyType, rpid);
      checkCode(response, '评论定位');
      if (!response.data) throw new Error(`接口未定位到评论 ${rpid}，不能据此认定已删除`);
      const reply: Reply = response.data;
      if (replyId(reply) !== rpid) throw new Error('评论定位响应 ID 不匹配');
      if (idString(reply.oid_str ?? reply.oid, '响应 oid') !== oid || reply.type !== replyType) {
        throw new Error('评论定位响应主体或业务类型不匹配');
      }
      return { ...mapReply(reply), rpid, mid: reply.member?.mid == null ? undefined : idString(reply.member.mid, '用户mid'),
        user: reply.member?.uname || '未知用户', like: reply.like ?? null, subReplyCount: reply.count ?? null,
        root: relationId(reply.root, reply.root_str), parent: relationId(reply.parent, reply.parent_str), pictures: reply.content?.pictures ?? [] };
    },
  }));
  register(tool({
    name: 'bilibili_get_sub_comments', description: '获取指定根评论下的一页二级回复（不把根评论混入子回复列表）。SDK声明此接口为number参数，工具仅接受安全整数输入。',
    parameters: { oid: { type: 'integer', required: true, description: '评论区主体 ID' }, rootRpid: { type: 'integer', required: true, description: '根评论RPID（安全整数）' }, replyType: { type: 'integer', description: '业务类型，默认1视频' }, page: { type: 'integer', description: '页码，默认1' }, pageSize: { type: 'integer', description: '每页条数1-49，默认20' } },
    async execute(args: { oid: number; rootRpid: number; replyType?: number; page?: number; pageSize?: number }) {
      const oid = positiveInt(args.oid, 'oid');
      const rootRpid = positiveInt(args.rootRpid, 'rootRpid');
      const replyType = positiveInt(args.replyType ?? 1, 'replyType');
      const page = positiveInt(args.page ?? 1, 'page');
      const pageSize = positiveInt(args.pageSize ?? 20, 'pageSize', 49);
      const data = dataOf(await CommentAPI.getReplyDialog(manager.getClient(),oid, rootRpid, replyType, page, pageSize), '楼中楼回复');
      requirePage(data);
      const comments = arrayOf(data.replies, '楼中楼', true).map((reply: Reply) => ({ ...mapReply(reply), rpid: replyId(reply),
        mid: reply.member?.mid == null ? undefined : idString(reply.member.mid, '用户mid'), parent: relationId(reply.parent, reply.parent_str) }));
      return { oid, rootRpid, page, pageSize, total: data.page?.count, comments };
    },
  }));
  register(tool({
    name: 'bilibili_send_comment', description: '【需登录】在视频或动态下发表/回复评论。先与用户核对正文及根/父回复目标，再传 confirm=true；不自动重试写操作。',
    parameters: {
      bvid: { type: 'string', description: '视频BV号（与 aid 二选一，不与 dynamicId 同用）' },
      aid: { type: 'integer', description: '视频AV号（与 bvid 二选一）' },
      dynamicId: { type: 'string', description: '动态ID或 https://t.bilibili.com/ID 等B站动态链接；动态评论区 oid/type 由动态详情解析，不把动态ID当oid' },
      message: { type: 'string', required: true, description: '拟发表正文' },
      rootRpid: { type: 'integer', description: '根评论RPID，回复时填写' },
      parentRpid: { type: 'integer', description: '父评论RPID；省略时默认为根评论' },
      confirm: { type: 'boolean', description: '默认false，只预览，不请求；用户获准后设true' },
    },
    async execute(args: { bvid?: string; aid?: number; dynamicId?: string; message: string; rootRpid?: number; parentRpid?: number; confirm?: boolean }) {
      const client = manager.requireAuthedClient();
      nonempty(args.message, 'message');
      const hasVideo = args.bvid !== undefined || args.aid !== undefined;
      if (hasVideo && args.dynamicId !== undefined) throw new Error('bvid/aid 与 dynamicId 不可混用');
      if (!hasVideo && args.dynamicId === undefined) throw new Error('必须提供 bvid/aid 或 dynamicId');
      const dynamicId = args.dynamicId === undefined ? undefined : dynamicIdOf(args.dynamicId);
      const aid = hasVideo ? aidOf(args) : undefined;
      const root = args.rootRpid == null || args.rootRpid === 0 ? 0 : positiveInt(args.rootRpid, 'rootRpid');
      const parent = args.parentRpid == null || args.parentRpid === 0 ? root : positiveInt(args.parentRpid, 'parentRpid');
      if (parent && !root) throw new Error('回复父评论时必须同时提供 rootRpid');
      const target = hasVideo ? `视频 ${args.bvid ?? `av${args.aid}`}` : `动态 ${dynamicId}`;
      if (!confirmed(args.confirm)) return { confirmed: false, message: `[安全拦截提示] 即将在${target}下发表评论 (root=${root}, parent=${parent})：\n「${args.message}」\n请向用户核对内容和回复目标，获准后传入 confirm=true。` };
      let oid: number | string = aid!;
      let replyType = 1;
      if (!hasVideo) {
        // 动态评论区身份必须来自详情解析：相册/转发/文字动态的 oid 不等于动态 ID。
        const detail = dataOf(await DynamicAPI.getDetail(client, dynamicId!), '动态评论区解析');
        oid = idString(detail.item?.basic?.comment_id_str, '动态评论区 oid');
        replyType = positiveInt(detail.item?.basic?.comment_type, '动态评论区类型');
      }
      // No entity getVideo call is needed just to derive the comment area's aid.
      const data = dataOf(await CommentAPI.add(client, oid, args.message, replyType, root, parent), '发表评论');
      if (data.need_captcha) throw new Error('评论请求需要验证码，未确认发表成功；请勿自动重试');
      const rpid = idString(data.rpid_str ?? data.rpid, '发表结果 rpid');
      return { confirmed: true, rpid, oid: String(oid), replyType, message: `评论已成功发表在${target}下！(RPID: ${rpid})` };
    },
  }));
}
