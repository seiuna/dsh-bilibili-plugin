import { ArticleAPI, LiveAPI, UserAPI } from '@seiuna/bilibili-api';
import { dataOf, optionalData, positiveInt, stripHtml, tool, type RegisterTool, type ToolManager } from './shared.js';

export function registerContentTools(register: RegisterTool, manager: ToolManager): void {
  register(tool({
    name: 'bilibili_get_article_info', description: '查询专栏标题、作者、统计与正文；接口部分不可用时标记缺失，不将失败解释为文章删除。',
    parameters: { id: { type: 'integer', required: true, description: '专栏cv号数字部分' } },
    async execute(args: { id: number }) {
      const id = positiveInt(args.id, 'id');
      const client = manager.getClient();
      const warnings: string[] = [];
      const [info, view] = await Promise.all([
        optionalData(ArticleAPI.getInfo(client,id), '专栏统计', warnings),
        optionalData(ArticleAPI.getView(client,id), '专栏正文', warnings),
      ]);
      if (!info && !view) throw new Error(`专栏 cv${id} 的信息和正文接口均不可用，不能认定文章不存在`);
      const stats = info?.stats ?? view?.stats;
      return { id, title: view?.title || info?.title || '', summary: view?.summary ?? null,
        content: view ? stripHtml(view.content ?? '') : null, contentAvailable: typeof view?.content === 'string',
        author: { name: view?.author?.name || info?.author_name, mid: view?.author?.mid ?? info?.mid, face: view?.author?.face },
        stats: { view: stats?.view ?? null, like: stats?.like ?? null, favorite: stats?.favorite ?? null,
          coin: stats?.coin ?? null, reply: stats?.reply ?? null, share: stats?.share ?? null }, warnings };
    },
  }));
  register(tool({
    name: 'bilibili_get_live_info', description: '查询直播间状态、分区、人气和主播资料；online为上游人气字段，不等同真实在线人数。',
    parameters: { roomId: { type: 'integer', required: true, description: '房间号，支持短号/长号' } },
    async execute(args: { roomId: number }) {
      const roomId = positiveInt(args.roomId, 'roomId');
      const client = manager.getClient();
      const data = dataOf(await LiveAPI.getRoomInfo(client,roomId), '直播间');
      const warnings: string[] = [];
      const user = data.uid ? await optionalData(UserAPI.getInfo(client,data.uid), '主播资料', warnings) : undefined;
      return { roomId: data.room_id, shortId: data.short_id || undefined, uid: data.uid, uname: user?.name, title: data.title,
        isLiving: data.live_status === 1, liveStatus: data.live_status, areaName: data.area_name, parentAreaName: data.parent_area_name,
        online: data.online, liveTime: data.live_time, cover: data.user_cover, keyframe: data.keyframe, warnings };
    },
  }));
}
