import { FavoriteAPI, HistoryAPI } from '@seiuna/bilibili-api';
import { aidOf, arrayOf, checkCode, clock, dataOf, dateTime, idString, oneOf, positiveInt, tool, type RegisterTool, type ToolManager } from './shared.js';

export function registerLibraryTools(register: RegisterTool, manager: ToolManager): void {
  register(tool({
    name: 'bilibili_view_history', description: '【需登录】查询最近一页观看历史，最多30条。',
    parameters: { limit: { type: 'integer', description: '返回条数1-30，默认15' } },
    async execute(args: { limit?: number }) {
      const client = manager.requireAuthedClient();
      const limit = positiveInt(args.limit ?? 15, 'limit', 30);
      // The generator silently stops on nonzero code; use the checked single page API.
      const data = dataOf(await HistoryAPI.getHistory(client,limit), '观看历史');
      const history = arrayOf(data.list, '观看历史').slice(0, limit).map(item => ({ title: item.title, bvid: item.history?.bvid,
        business: item.history?.business, author: item.author_name, viewAt: dateTime(item.view_at),
        progressStr: item.progress === -1 ? '已看完' : item.progress === 0 ? '刚开始看' : `看到 ${clock(item.progress)}` }));
      return { history };
    },
  }));
  register(tool({
    name: 'bilibili_manage_toview', description: '【需登录】稍后再看：list查询、add添加、delete移除；兼容的增删操作立即写入，必须有用户授权。',
    parameters: { action: { type: 'string', required: true, description: 'list / add / delete' }, bvid: { type: 'string', description: '添加/移除时必填BV号' } },
    async execute(args: { action: string; bvid?: string }) {
      const client = manager.requireAuthedClient();
      const action = oneOf(args.action, ['list', 'add', 'delete'], 'action');
      if (action === 'list') {
        const data = dataOf(await HistoryAPI.getToViewList(client), '稍后再看');
        const list = arrayOf(data.list, '稍后再看', true).map(v => ({ bvid: v.bvid, title: v.title, owner: v.owner?.name }));
        return { count: data.count, list };
      }
      const aid = aidOf(args);
      checkCode(await (action === 'add' ? HistoryAPI.addToView(client, aid) : HistoryAPI.removeFromView(client, aid)), '稍后再看操作');
      return { message: action === 'add' ? `已成功将视频 ${args.bvid} 添加至稍后再看` : `已成功将视频 ${args.bvid} 从稍后再看移除` };
    },
  }));
  register(tool({
    name: 'bilibili_manage_favorite', description: '【需登录】列出个人收藏夹或获取指定收藏夹第一页20条内容（只读，不修改收藏）。',
    parameters: { action: { type: 'string', required: true, description: 'list_folders / get_folder' }, mediaId: { type: 'integer', description: 'get_folder时必填收藏夹ID' } },
    async execute(args: { action: string; mediaId?: number }) {
      const client = manager.requireAuthedClient();
      const action = oneOf(args.action, ['list_folders', 'get_folder'], 'action');
      if (action === 'list_folders') {
        const mid = positiveInt(Number(idString(client.userId, '登录用户mid')), '登录用户mid');
        const data = dataOf(await FavoriteAPI.getCreatedFolders(client,mid), '收藏夹列表');
        return { folders: arrayOf(data.list, '收藏夹', true).map(f => ({ id: f.id, title: f.title, mediaCount: f.media_count })) };
      }
      const mediaId = positiveInt(args.mediaId, 'mediaId');
      const data = dataOf(await FavoriteAPI.getFolderList(client,mediaId, 20, 1), '收藏夹内容');
      return { folderTitle: data.info?.title ?? null, medias: arrayOf(data.medias, '收藏夹内容', true).map(m => ({ bvid: m.bvid, title: m.title, upper: m.upper?.name })) };
    },
  }));
}
