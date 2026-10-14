import { DynamicAPI } from '@seiuna/bilibili-api';
import { arrayOf, checkCode, confirmed, dataOf, dateTime, dynamicIdOf, numeric, oneOf, positiveInt, record, text, tool, type RegisterTool, type ToolManager } from './shared.js';

/** SDK modules contain unknown and object/array variants: narrow at this boundary once. */
function dynamicFields(value: unknown) {
  const item = record(value);
  if (!item) throw new Error('动态条目响应缺失');
  const basic = record(item.basic);
  const modules = Array.isArray(item.modules) ? item.modules.map(record) : [record(item.modules)];
  const module = (name: string) => record(modules.find(m => m?.[name] != null)?.[name]);
  const author = module('module_author');
  const dynamic = module('module_dynamic');
  const stats = module('module_stat');
  const major = record(dynamic?.major);
  const opus = record(major?.opus);
  const draw = record(major?.draw);
  const rawPictures = draw?.items ?? opus?.pics ?? [];
  const pictures = arrayOf(Array.isArray(rawPictures) ? rawPictures : undefined, '动态图片').map(p => {
    const picture = record(p); return text(picture?.src) || text(picture?.url);
  }).filter(src => /^https?:\/\//i.test(src));
  return {
    id: text(item.id_str), type: text(item.type),
    author: { mid: author?.mid ?? basic?.uid, name: text(author?.name), face: text(author?.face),
      pubTime: text(author?.pub_time_text) || text(author?.pub_time) || dateTime(numeric(author?.pub_ts)) },
    text: text(record(dynamic?.desc)?.text) || text(record(opus?.summary)?.text) || text(basic?.title),
    pictures, stats: { like: numeric(record(stats?.like)?.count), comment: numeric(record(stats?.comment)?.count), repost: numeric(record(stats?.repost)?.count) },
    commentOid: text(basic?.comment_id_str) || undefined, commentType: numeric(basic?.comment_type),
  };
}

export function registerDynamicTools(register: RegisterTool, manager: ToolManager): void {
  register(tool({
    name: 'bilibili_get_dynamic_detail', description: '查询动态正文、作者、配图、统计与真实评论区参数；不把动态ID当作评论区OID。',
    parameters: { dynamicId: { type: 'string', required: true, description: '数字动态ID或 https://t.bilibili.com/ID、https://www.bilibili.com/opus/ID 链接' } },
    async execute(args: { dynamicId: string }) {
      const id = dynamicIdOf(args.dynamicId);
      const data = dataOf(await DynamicAPI.getDetail(manager.getClient(),id), '动态详情');
      const result = dynamicFields(data.item);
      return { ...result, id: result.id || id };
    },
  }));
  register(tool({
    name: 'bilibili_get_user_dynamics', description: '获取UP主的一页动态，支持返回的游标继续查询。',
    parameters: { mid: { type: 'integer', required: true, description: 'UP主UID' }, offset: { type: 'string', description: '上页 nextOffset，保持原样，不转换为数字' } },
    async execute(args: { mid: number; offset?: string }) {
      const mid = positiveInt(args.mid, 'mid');
      if (args.offset !== undefined && typeof args.offset !== 'string') throw new Error('offset 必须为字符串');
      const data = dataOf(await DynamicAPI.getSpace(manager.getClient(),mid, args.offset), 'UP动态列表');
      const items = arrayOf(data.items, 'UP动态').map(item => {
        const result = dynamicFields(item);
        return { id: result.id, pubTime: result.author.pubTime, text: result.text, ...result.stats,
          commentOid: result.commentOid, commentType: result.commentType };
      });
      return { mid, hasMore: data.has_more, nextOffset: data.offset, items };
    },
  }));
  register(tool({
    name: 'bilibili_dynamic_interact', description: '【需登录】动态点赞或取消点赞。默认仅预览，向用户确认后传 confirm=true。',
    parameters: { dynamicId: { type: 'string', required: true, description: '数字动态ID' }, action: { type: 'string', required: true, description: 'like / unlike' }, confirm: { type: 'boolean', description: '默认false，不请求；用户获准后设true' } },
    async execute(args: { dynamicId: string; action: string; confirm?: boolean }) {
      const client = manager.requireAuthedClient();
      const id = dynamicIdOf(args.dynamicId);
      const action = oneOf(args.action, ['like', 'unlike'], 'action');
      const name = action === 'like' ? '点赞' : '取消点赞';
      if (!confirmed(args.confirm)) return { confirmed: false, message: `[安全拦截提示] 即将对动态 ${id} 执行【${name}动态】。\n请向用户确认无误后传入 confirm=true 执行。` };
      checkCode(await DynamicAPI.like(client,id, action === 'unlike' ? 2 : 1), '动态点赞操作');
      return { confirmed: true, message: `已成功对动态 ${id} 执行【${name}】操作！` };
    },
  }));
}
