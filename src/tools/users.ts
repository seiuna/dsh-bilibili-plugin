import { MessageAPI, UserAPI } from '@seiuna/bilibili-api';
import { arrayOf, checkCode, dataOf, dateTime, oneOf, optionalData, positiveInt, tool, type ApiResponse, type RegisterTool, type ToolManager } from './shared.js';

interface SpaceVideo {
  bvid: string; aid: number; title: string; play: number; created: number; length: string; pic: string;
}
interface SpaceVideosData { list: { vlist: SpaceVideo[] }; page: { count: number } }

export function registerUserTools(register: RegisterTool, manager: ToolManager): void {
  register(tool({
    name: 'bilibili_get_user_info', description: '查询UP主资料、粉丝/关注与累计获赞；可选统计失败时返回未知而非0。',
    parameters: { mid: { type: 'integer', required: true, description: 'UP主UID（正安全整数）' } },
    async execute(args: { mid: number }) {
      const mid = positiveInt(args.mid, 'mid');
      const client = manager.getClient();
      const warnings: string[] = [];
      const [infoRes, stat, upStat] = await Promise.all([
        UserAPI.getInfo(client,mid),
        optionalData(UserAPI.getRelationStat(client,mid), '粉丝关注统计', warnings),
        optionalData(UserAPI.getUpStat(client,mid), 'UP获赞统计', warnings),
      ]);
      const info = dataOf(infoRes, 'UP主资料');
      return { mid: info.mid, name: info.name, face: info.face, sign: info.sign, level: info.level,
        following: stat?.following ?? null, fans: stat?.follower ?? null, likes: upStat?.likes ?? null, warnings };
    },
  }));
  register(tool({
    name: 'bilibili_get_user_videos', description: '查询UP主的一页投稿视频；SDK1.1.3无专用方法，经 client.request 的 WBI 投稿接口获取。',
    parameters: { mid: { type: 'integer', required: true, description: 'UP主UID' }, page: { type: 'integer', description: '页码，默认1' }, pageSize: { type: 'integer', description: '每页条数1-50，默认10' } },
    async execute(args: { mid: number; page?: number; pageSize?: number }) {
      const mid = positiveInt(args.mid, 'mid');
      const page = positiveInt(args.page ?? 1, 'page');
      const pageSize = positiveInt(args.pageSize ?? 10, 'pageSize', 50);
      const client = manager.getClient();
      // SDK 1.1.3 提供的 UserAPI 没有投稿列表方法；这是全工具层唯一经 client.request
      // （client 自带 Cookie/WBI/凭证刷新的统一请求通道）的 typed 扩展，不使用全局 fetch。
      const params = new URLSearchParams({ mid: String(mid), pn: String(page), ps: String(pageSize) });
      const response = await client.request<ApiResponse<SpaceVideosData>>(`https://api.bilibili.com/x/space/wbi/arc/search?${params}`, { wbi: true });
      const data = dataOf(response, 'UP主投稿');
      const videos = arrayOf(data.list?.vlist, 'UP主投稿').map(v => ({ bvid: v.bvid, aid: v.aid, title: v.title, play: v.play,
        created: dateTime(v.created), duration: v.length, pic: v.pic }));
      return { mid, page, pageSize, total: data.page?.count, videos };
    },
  }));
  register(tool({
    name: 'bilibili_get_my_info', description: '【需登录】查询本人UID/昵称/硬币/会员状态与未读消息；未读查询失败不会伪装成0。', parameters: {},
    async execute() {
      const client = manager.requireAuthedClient();
      const warnings: string[] = [];
      const [response, unread] = await Promise.all([UserAPI.getMyInfo(client), optionalData(MessageAPI.unreadCount(client), '未读通知', warnings)]);
      const info = dataOf(response, '个人中心');
      return { mid: info.mid, name: info.name, face: info.face, level: info.level, coins: info.coins, following: info.following, follower: info.follower,
        vipStatus: info.vip?.status === 1, unread: unread ? { reply: unread.reply, at: unread.at, like: unread.like } : null, warnings };
    },
  }));
  register(tool({
    name: 'bilibili_user_relation', description: '【需登录】关注、取关或拉黑UP主。此兼容工具立即写入，调用前必须有用户明确授权。',
    parameters: { mid: { type: 'integer', required: true, description: 'UP主UID' }, action: { type: 'string', required: true, description: 'follow / unfollow / block' } },
    async execute(args: { mid: number; action: string }) {
      const client = manager.requireAuthedClient();
      const mid = positiveInt(args.mid, 'mid');
      const action = oneOf(args.action, ['follow', 'unfollow', 'block'], 'action');
      const codes = { follow: 1, unfollow: 2, block: 5 } as const;
      const names = { follow: '关注', unfollow: '取消关注', block: '拉黑' };
      checkCode(await UserAPI.modifyRelation(client,mid, codes[action]), '用户关系操作');
      return { message: `已成功${names[action]} UP 主 (UID: ${mid})` };
    },
  }));
}
