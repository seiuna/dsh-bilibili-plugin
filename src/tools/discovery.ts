import { RankingAPI, SearchAPI } from '@seiuna/bilibili-api';
import { arrayOf, dataOf, nonempty, oneOf, stripHtml, text, tool, type RegisterTool, type ToolManager } from './shared.js';

export function registerDiscoveryTools(register: RegisterTool, manager: ToolManager): void {
  register(tool({
    name: 'bilibili_search',
    description: '在 Bilibili 综合搜索结果中筛选视频、UP 主、专栏或直播；不是独立分类搜索或全量分页。',
    parameters: {
      keyword: { type: 'string', required: true, description: '搜索关键词' },
      searchType: { type: 'string', description: 'all / video / bili_user / live / article，默认 all' },
    },
    async execute(args: { keyword: string; searchType?: string }) {
      const keyword = nonempty(args.keyword, 'keyword');
      const target = oneOf(args.searchType ?? 'all', ['all', 'video', 'bili_user', 'live', 'article'], 'searchType');
      const data = dataOf(await SearchAPI.searchAll(manager.getClient(),keyword), '搜索');
      const groups = arrayOf(data.result, '搜索结果');
      const results = groups.filter(group => target === 'all' || group.result_type === target ||
        (target === 'live' && ['live_room', 'live_user'].includes(group.result_type)))
        .flatMap(group => arrayOf(group.data, '搜索分组').map(item => ({
          type: group.result_type,
          title: stripHtml(text(item.title) || text(item.uname)),
          bvid: item.bvid, author: item.author, mid: item.mid ?? item.uid,
          play: item.play, pic: item.pic ?? item.upic, roomId: item.roomid ?? item.room_id,
          articleId: group.result_type === 'article' ? item.id : undefined,
          url: item.arcurl ?? item.url,
        })));
      return { success: true, total: target === 'all' ? data.numResults ?? results.length : results.length,
        returnedCount: results.length, totalScope: target === 'all' ? 'upstream' : 'filtered_page', results };
    },
  }));

  register(tool({
    name: 'bilibili_get_trends', description: '获取 B站热搜词、热门综合视频、全站排行榜或入站必刷视频。',
    parameters: { category: { type: 'string', description: 'hot / popular / ranking / precious，默认 hot' } },
    async execute(args: { category?: string }) {
      const category = oneOf(args.category ?? 'hot', ['hot', 'popular', 'ranking', 'precious'], 'category');
      const client = manager.getClient();
      if (category === 'hot') {
        const data = dataOf(await SearchAPI.getHotSearch(client,20), '热搜');
        // Upstream display icons are dropped: tool output is plain JSON data only.
        return { category, list: arrayOf(data.list, '热搜').map(item => ({ title: item.show_name || item.keyword, keyword: item.show_name || item.keyword, bvid: undefined, author: undefined })) };
      }
      if (category === 'ranking') {
        const data = dataOf(await RankingAPI.getRanking(client), '排行榜');
        return { category, list: arrayOf(data.list, '排行榜').map(item => ({ title: item.title, bvid: item.bvid, author: item.owner?.name, play: item.stat?.view, score: item.score })) };
      }
      if (category === 'precious') {
        const data = dataOf(await RankingAPI.getPreciousVideos(client), '入站必刷');
        return { category, list: arrayOf(data.list, '入站必刷').map(item => ({ title: item.title, bvid: item.bvid, author: item.owner?.name, achievement: item.achievement })) };
      }
      const data = dataOf(await RankingAPI.getPopular(client,1, 20), '热门视频');
      return { category, list: arrayOf(data.list, '热门视频').map(item => ({ title: item.title, bvid: item.bvid, author: item.owner?.name, play: item.stat?.view })) };
    },
  }));
}
