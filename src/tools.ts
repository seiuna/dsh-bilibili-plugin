import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  CommentAPI,
  FavoriteAPI,
  HistoryAPI,
  MessageAPI,
  RankingAPI,
  SearchAPI,
  UserAPI,
  VideoAPI,
  bv2av,
} from '@seiuna/bilibili-api';
import { BilibiliClientManager } from './client-manager.js';

export function registerBilibiliTools(
  toolsRegistry: { register: (tool: any) => void },
  manager: BilibiliClientManager,
): void {
  // ==========================================
  // 1. bilibili_search: 全能搜索
  // ==========================================
  toolsRegistry.register(
    defineTool({
      name: 'bilibili_search',
      description:
        '在 Bilibili 全站搜索视频、UP 主、专栏文章或直播。支持分类过滤。',
      parameters: {
        keyword: { type: 'string', required: true, description: '搜索关键词' },
        searchType: {
          type: 'string',
          description:
            '搜索类型，可选: all (综合), video (视频), bili_user (UP主), live (直播), article (专栏)。默认为 all',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            success: { type: 'boolean' },
            results: { type: 'array' },
            total: { type: 'integer' },
          },
        },
        render: (args, result: any) => [
          {
            type: 'text',
            text: `[bilibili] 搜索【${args.keyword}】共找到 ${result.total ?? 0} 条结果:\n` +
              (result.results ?? [])
                .slice(0, 10)
                .map(
                  (item: any, i: number) =>
                    `${i + 1}. [${item.type ?? 'item'}] ${item.title ?? item.uname ?? '未知'} ` +
                    (item.bvid ? `(${item.bvid})` : '') +
                    (item.author ? ` by ${item.author}` : ''),
                )
                .join('\n'),
          },
        ],
      },
      async execute(args: { keyword: string; searchType?: string }) {
        const client = manager.getClient();
        const res = await SearchAPI.searchAll(client, args.keyword);
        const data = res.data;
        const targetType = args.searchType || 'all';

        const items: any[] = [];
        for (const group of data?.result || []) {
          if (targetType !== 'all' && group.result_type !== targetType) {
            continue;
          }
          for (const item of (group.data as any[]) || []) {
            items.push({
              type: group.result_type,
              title: String(item.title || item.uname || '').replace(/<[^>]+>/g, ''),
              bvid: item.bvid,
              author: item.author,
              mid: item.mid,
              play: item.play,
              pic: item.pic,
            });
          }
        }

        return {
          success: true,
          total: data?.numResults ?? items.length,
          results: items,
        };
      },
    }),
  );

  // ==========================================
  // 2. bilibili_get_trends: 热搜与全站榜单
  // ==========================================
  toolsRegistry.register(
    defineTool({
      name: 'bilibili_get_trends',
      description:
        '获取 B 站当前热搜词榜单、热门综合视频、全站排行榜或入站必刷视频。',
      parameters: {
        category: {
          type: 'string',
          description:
            '榜单类别，可选: hot (热搜词), popular (热门综合视频), ranking (全站排行榜), precious (入站必刷视频)。默认为 hot',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            category: { type: 'string' },
            list: { type: 'array' },
          },
        },
        render: (args, result: any) => [
          {
            type: 'text',
            text: `[bilibili] 榜单【${result.category}】:\n` +
              (result.list ?? [])
                .slice(0, 10)
                .map((item: any, i: number) => `${i + 1}. ${item.title ?? item.keyword} ${item.bvid ? `(${item.bvid})` : ''} ${item.author ? `by ${item.author}` : ''}`)
                .join('\n'),
          },
        ],
      },
      async execute(args: { category?: string }) {
        const client = manager.getClient();
        const cat = args.category || 'hot';
        if (cat === 'hot') {
          const res = await SearchAPI.getHotSearch(client, 20);
          const list = (res.data?.list || []).map((it) => ({
            keyword: it.show_name || it.keyword,
            icon: it.icon,
          }));
          return { category: 'hot', list };
        } else if (cat === 'ranking') {
          const res = await RankingAPI.getRanking(client);
          const list = (res.data?.list || []).map((it) => ({
            title: it.title,
            bvid: it.bvid,
            author: it.owner?.name,
            play: it.stat?.view,
            score: it.score,
          }));
          return { category: 'ranking', list };
        } else if (cat === 'precious') {
          const res = await RankingAPI.getPreciousVideos(client);
          const list = (res.data?.list || []).map((it) => ({
            title: it.title,
            bvid: it.bvid,
            author: it.owner?.name,
            achievement: it.achievement,
          }));
          return { category: 'precious', list };
        } else {
          const res = await RankingAPI.getPopular(client, 1, 20);
          const list = (res.data?.list || []).map((it) => ({
            title: it.title,
            bvid: it.bvid,
            author: it.owner?.name,
            play: it.stat?.view,
          }));
          return { category: 'popular', list };
        }
      },
    }),
  );

  // ==========================================
  // 3. bilibili_get_video_info: 视频详细信息
  // ==========================================
  toolsRegistry.register(
    defineTool({
      name: 'bilibili_get_video_info',
      description:
        '获取指定 B 站视频的详细信息（标题、UP主、简介、播放量、点赞/投币/收藏状态、分P列表与时长、视频标签）。',
      parameters: {
        bvid: { type: 'string', description: '视频 BV 号 (如 BV1xx411c7mD)' },
        aid: { type: 'integer', description: '视频 AV 号 (如 170001)' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, res: any) => [
          {
            type: 'text',
            text: `[bilibili] 《${res.title}》 (${res.bvid})\n` +
              `UP 主: ${res.owner?.name} (UID: ${res.owner?.mid})\n` +
              `播放: ${res.stat?.view} | 点赞: ${res.stat?.like} | 投币: ${res.stat?.coin} | 收藏: ${res.stat?.favorite}\n` +
              `简介: ${res.desc?.slice(0, 150)}...\n` +
              `分P数: ${res.pages?.length ?? 1} (总时长约: ${Math.round((res.duration ?? 0) / 60)} 分钟)`,
          },
        ],
      },
      async execute(args: { bvid?: string; aid?: number }) {
        if (!args.bvid && !args.aid) {
          throw new Error('必须提供 bvid 或 aid');
        }
        const client = manager.getClient();
        const infoRes = await VideoAPI.getInfo(client, args.bvid, args.aid);
        const data = infoRes.data;
        let tags: string[] = [];
        try {
          const tagRes = await VideoAPI.getTags(client, data.aid, data.bvid, data.cid);
          tags = (tagRes.data || []).map((t) => t.tag_name);
        } catch {
          // ignore
        }
        return {
          bvid: data.bvid,
          aid: data.aid,
          title: data.title,
          pic: data.pic,
          pubdate: new Date(data.pubdate * 1000).toLocaleString(),
          duration: data.duration,
          owner: data.owner,
          stat: data.stat,
          desc: data.desc,
          pages: (data.pages || []).map((p) => ({
            page: p.page,
            cid: p.cid,
            part: p.part,
            duration: p.duration,
          })),
          tags,
        };
      },
    }),
  );

  // ==========================================
  // 4. bilibili_get_video_ai_summary: 官方 AI 视频大纲总结
  // ==========================================
  toolsRegistry.register(
    defineTool({
      name: 'bilibili_get_video_ai_summary',
      description:
        '获取 Bilibili 官方生成的视频 AI 摘要大纲与关键分段重点时间戳。长视频内容可直接通过大纲理解。',
      parameters: {
        bvid: { type: 'string', required: true, description: '视频 BV 号' },
        cid: { type: 'integer', description: '视频分P的 CID（可选，默认第一P）' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, res: any) => [
          {
            type: 'text',
            text: `[bilibili AI 摘要] 《${res.title ?? res.bvid}》:\n` +
              `总结: ${res.summary}\n\n` +
              `大纲分段:\n` +
              (res.outline ?? [])
                .map(
                  (part: any) =>
                    `• [${part.timeStr}] ${part.title}:\n` +
                    (part.partOutline ?? []).map((sub: any) => `    - [${sub.timeStr}] ${sub.content}`).join('\n'),
                )
                .join('\n'),
          },
        ],
      },
      async execute(args: { bvid: string; cid?: number }) {
        const client = manager.getClient();
        let cid = args.cid;
        let title = '';
        let aid = 0;
        let upMid = 0;

        const info = await VideoAPI.getInfo(client, args.bvid);
        title = info.data.title;
        aid = info.data.aid;
        upMid = info.data.owner?.mid;
        cid = cid || info.data.cid;

        const summaryRes = await VideoAPI.getAiSummary(client, cid, aid, args.bvid, upMid);
        const data = summaryRes.data;
        const modelResult = data?.model_result;

        const formatTime = (seconds: number) => {
          const m = Math.floor(seconds / 60);
          const s = seconds % 60;
          return `${m}:${s < 10 ? '0' : ''}${s}`;
        };

        const outline = (modelResult?.outline || []).map((o) => ({
          title: o.title,
          timeStr: formatTime(o.timestamp),
          partOutline: (o.part_outline || []).map((p) => ({
            content: p.content,
            timeStr: formatTime(p.timestamp),
          })),
        }));

        return {
          bvid: args.bvid,
          title,
          summary: modelResult?.summary || '无官方 AI 摘要',
          outline,
        };
      },
    }),
  );

  // ==========================================
  // 5. bilibili_get_video_play_url: 视频流播放与下载流
  // ==========================================
  toolsRegistry.register(
    defineTool({
      name: 'bilibili_get_video_play_url',
      description: '获取指定 B 站视频的分辨率规格与媒体流播放地址（MP4 / DASH）。',
      parameters: {
        bvid: { type: 'string', required: true, description: '视频 BV 号' },
        cid: { type: 'integer', description: '视频分P CID（可选，默认第一P）' },
        qn: {
          type: 'integer',
          description: '画质清晰度代码，如 80 (1080P), 64 (720P), 32 (480P), 16 (360P)',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, res: any) => [
          {
            type: 'text',
            text: `[bilibili] 视频流信息 (${res.bvid}):\n` +
              `时长: ${Math.round((res.timelength ?? 0) / 1000)} 秒\n` +
              `支持清晰度: ${(res.supportFormats ?? []).map((f: any) => f.new_description).join(', ')}\n` +
              `主播放流 URL: ${res.videoUrl ?? '见 DASH 流'}`,
          },
        ],
      },
      async execute(args: { bvid: string; cid?: number; qn?: number }) {
        const client = manager.getClient();
        let cid = args.cid;
        if (!cid) {
          const info = await VideoAPI.getInfo(client, args.bvid);
          cid = info.data.cid;
        }

        const res = await VideoAPI.getPlayUrl(client, cid, {
          bvid: args.bvid,
          qn: args.qn ?? 80,
          fnval: 16,
        });

        const d = res.data;
        const videoStream = d?.dash?.video?.[0]?.baseUrl || d?.durl?.[0]?.url;
        const audioStream = d?.dash?.audio?.[0]?.baseUrl;

        return {
          bvid: args.bvid,
          cid,
          quality: d.quality,
          timelength: d.timelength,
          videoUrl: videoStream,
          audioUrl: audioStream,
          supportFormats: d.support_formats,
        };
      },
    }),
  );

  // ==========================================
  // 6. bilibili_get_comments: 评论区检索
  // ==========================================
  toolsRegistry.register(
    defineTool({
      name: 'bilibili_get_comments',
      description:
        '获取视频、动态或专栏的评论区内容，支持热门精选或最新时间排序，包含点赞与二级回复。',
      parameters: {
        bvid: { type: 'string', description: '视频 BV 号' },
        aid: { type: 'integer', description: '视频或内容对应的 AID' },
        sort: {
          type: 'string',
          description: '排序方式，可选: hot (按热度排序), time (按时间排序)。默认 hot',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, res: any) => [
          {
            type: 'text',
            text: `[bilibili] 评论列表 (展示 ${res.comments?.length ?? 0} 条):\n` +
              (res.comments ?? [])
                .slice(0, 10)
                .map(
                  (c: any, i: number) =>
                    `${i + 1}. [${c.user}]: ${c.message}\n` +
                    `   👍 ${c.like} | 💬 子回复: ${c.subReplyCount}`,
                )
                .join('\n'),
          },
        ],
      },
      async execute(args: { bvid?: string; aid?: number; sort?: string }) {
        const client = manager.getClient();
        let aid = args.aid;
        if (!aid && args.bvid) {
          aid = bv2av(args.bvid);
        }
        if (!aid) {
          throw new Error('必须提供 bvid 或 aid');
        }

        const sortMode = args.sort === 'time' ? 0 : 1;
        const comments: any[] = [];

        for await (const page of CommentAPI.replies(client, aid, 1, sortMode as any, 0, 20)) {
          for (const r of page.comments || []) {
            comments.push({
              rpid: r.rpid,
              user: r.member?.uname,
              mid: r.member?.mid,
              like: r.like,
              message: r.content?.message,
              subReplyCount: r.count,
              ctime: new Date(r.ctime * 1000).toLocaleString(),
            });
          }
          break; // 只拉取首页
        }

        return {
          comments,
        };
      },
    }),
  );

  // ==========================================
  // 7. bilibili_get_user_info: UP 主个人资料
  // ==========================================
  toolsRegistry.register(
    defineTool({
      name: 'bilibili_get_user_info',
      description: '查询指定 Bilibili UP 主的用户资料、粉丝数、关注数与累计获赞总数。',
      parameters: {
        mid: { type: 'integer', required: true, description: 'UP 主数字 UID' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, res: any) => [
          {
            type: 'text',
            text: `[bilibili UP 主] ${res.name} (UID: ${res.mid}) Lv.${res.level}\n` +
              `粉丝: ${res.fans} | 关注: ${res.following} | 获赞: ${res.likes}\n` +
              `签名: ${res.sign || '无'}`,
          },
        ],
      },
      async execute(args: { mid: number }) {
        const client = manager.getClient();
        const [infoRes, statRes, upStatRes] = await Promise.all([
          UserAPI.getInfo(client, args.mid),
          UserAPI.getRelationStat(client, args.mid),
          UserAPI.getUpStat(client, args.mid).catch(() => ({ data: { likes: 0 } })),
        ]);

        const info = infoRes.data;
        const stat = statRes.data;
        const upStat = (upStatRes as any).data;

        return {
          mid: info.mid,
          name: info.name,
          face: info.face,
          sign: info.sign,
          level: info.level,
          following: stat?.following ?? 0,
          fans: stat?.follower ?? 0,
          likes: upStat?.likes ?? 0,
        };
      },
    }),
  );

  // ==========================================
  // 8. bilibili_get_user_videos: UP 主投稿列表
  // ==========================================
  toolsRegistry.register(
    defineTool({
      name: 'bilibili_get_user_videos',
      description: '获取指定 UP 主投稿发布的视频列表。',
      parameters: {
        mid: { type: 'integer', required: true, description: 'UP 主数字 UID' },
        page: { type: 'integer', description: '页码，默认 1' },
        pageSize: { type: 'integer', description: '每页数量，默认 10' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, res: any) => [
          {
            type: 'text',
            text: `[bilibili] UP主 (UID: ${res.mid}) 投稿视频列表:\n` +
              (res.videos ?? [])
                .map(
                  (v: any, i: number) =>
                    `${i + 1}. 《${v.title}》 (${v.bvid}) - 播放: ${v.play}`,
                )
                .join('\n'),
          },
        ],
      },
      async execute(args: { mid: number; page?: number; pageSize?: number }) {
        const client = manager.getClient();
        const pn = args.page ?? 1;
        const ps = args.pageSize ?? 10;
        const res = await client.request<any>(
          `https://api.bilibili.com/x/space/wbi/arc/search?mid=${args.mid}&pn=${pn}&ps=${ps}`,
          { wbi: true },
        );

        const vlist = res.data?.list?.vlist || [];
        const videos = vlist.map((v: any) => ({
          bvid: v.bvid,
          aid: v.aid,
          title: v.title,
          play: v.play,
          created: new Date(v.created * 1000).toLocaleDateString(),
          duration: v.length,
          pic: v.pic,
        }));

        return {
          mid: args.mid,
          total: res.data?.page?.count ?? videos.length,
          videos,
        };
      },
    }),
  );

  // ==========================================
  // 9. bilibili_get_my_info: 个人中心数据 (需登录)
  // ==========================================
  toolsRegistry.register(
    defineTool({
      name: 'bilibili_get_my_info',
      description:
        '【需登录】获取当前登录 B 站账号的个人信息（UID、昵称、硬币数、大会员状态、未读消息数）。',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, res: any) => [
          {
            type: 'text',
            text: `[bilibili 个人中心] ${res.name} (UID: ${res.mid}) Lv.${res.level}\n` +
              `硬币余额: ${res.coins} | 关注数: ${res.following} | 粉丝数: ${res.follower}\n` +
              `大会员: ${res.vipStatus ? '已开通' : '未开通'}\n` +
              `未读通知: 回复 ${res.unread?.reply ?? 0} 条 | @我 ${res.unread?.at ?? 0} 条 | 点赞 ${res.unread?.like ?? 0} 条`,
          },
        ],
      },
      async execute() {
        const client = manager.requireAuthedClient();
        const [myInfoRes, unreadRes] = await Promise.all([
          UserAPI.getMyInfo(client),
          MessageAPI.unreadCount(client).catch(() => ({ data: {} })),
        ]);

        const info = myInfoRes.data;
        const unread = (unreadRes as any).data;

        return {
          mid: info.mid,
          name: info.name,
          face: info.face,
          level: info.level,
          coins: info.coins,
          following: info.following,
          follower: info.follower,
          vipStatus: info.vip?.status === 1,
          unread: {
            reply: unread.reply ?? 0,
            at: unread.at ?? 0,
            like: unread.like ?? 0,
          },
        };
      },
    }),
  );

  // ==========================================
  // 10. bilibili_view_history: 观看历史 (需登录)
  // ==========================================
  toolsRegistry.register(
    defineTool({
      name: 'bilibili_view_history',
      description: '【需登录】查询当前登录账号的观看历史记录。',
      parameters: {
        limit: { type: 'integer', description: '返回条数，默认 15 条 (最大 30)' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, res: any) => [
          {
            type: 'text',
            text: `[bilibili 观看历史]:\n` +
              (res.history ?? [])
                .map(
                  (h: any, i: number) =>
                    `${i + 1}. 《${h.title}》 (${h.bvid}) - UP: ${h.author}, 进度: ${h.progressStr}`,
                )
                .join('\n'),
          },
        ],
      },
      async execute(args: { limit?: number }) {
        const client = manager.requireAuthedClient();
        const maxLimit = args.limit ?? 15;
        const history: any[] = [];

        const formatProgress = (item: any) => {
          if (item.progress === -1) return '已看完';
          if (item.progress === 0) return '刚开始看';
          const m = Math.floor(item.progress / 60);
          const s = item.progress % 60;
          return `看到 ${m}:${s < 10 ? '0' : ''}${s}`;
        };

        for await (const item of HistoryAPI.history(client, maxLimit)) {
          history.push({
            title: item.title,
            bvid: item.history?.bvid,
            author: item.author_name,
            viewAt: new Date(item.view_at * 1000).toLocaleString(),
            progressStr: formatProgress(item),
          });
          if (history.length >= maxLimit) break;
        }

        return { history };
      },
    }),
  );

  // ==========================================
  // 11. bilibili_manage_toview: 稍后再看 (需登录)
  // ==========================================
  toolsRegistry.register(
    defineTool({
      name: 'bilibili_manage_toview',
      description:
        '【需登录】管理稍后再看列表：查询列表 (list)、添加视频 (add)、移除视频 (delete)。',
      parameters: {
        action: {
          type: 'string',
          required: true,
          description: '操作类型: list (查询), add (添加), delete (移除)',
        },
        bvid: { type: 'string', description: '视频 BV 号 (添加或移除时必须)' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, res: any) => [
          {
            type: 'text',
            text: res.message ||
              `[bilibili 稍后再看] 共 ${res.count ?? 0} 个视频:\n` +
                (res.list ?? [])
                  .slice(0, 10)
                  .map((v: any, i: number) => `${i + 1}. 《${v.title}》 (${v.bvid}) by ${v.owner}`)
                  .join('\n'),
          },
        ],
      },
      async execute(args: { action: string; bvid?: string }) {
        const client = manager.requireAuthedClient();
        if (args.action === 'list') {
          const res = await HistoryAPI.getToViewList(client);
          const list = (res.data?.list || []).map((v) => ({
            bvid: v.bvid,
            title: v.title,
            owner: v.owner?.name,
          }));
          return { count: res.data?.count ?? list.length, list };
        } else if (args.action === 'add') {
          if (!args.bvid) throw new Error('添加稍后再看需要提供 bvid');
          const aid = bv2av(args.bvid);
          await HistoryAPI.addToView(client, aid);
          return { message: `已成功将视频 ${args.bvid} 添加至稍后再看` };
        } else if (args.action === 'delete') {
          if (!args.bvid) throw new Error('移除稍后再看需要提供 bvid');
          const aid = bv2av(args.bvid);
          await HistoryAPI.removeFromView(client, aid);
          return { message: `已成功将视频 ${args.bvid} 从稍后再看移除` };
        } else {
          throw new Error('未知的操作类型: ' + args.action);
        }
      },
    }),
  );

  // ==========================================
  // 12. bilibili_manage_favorite: 收藏夹管理 (需登录)
  // ==========================================
  toolsRegistry.register(
    defineTool({
      name: 'bilibili_manage_favorite',
      description: '【需登录】查询个人收藏夹列表或获取指定收藏夹内的视频内容。',
      parameters: {
        action: {
          type: 'string',
          required: true,
          description: '操作类型: list_folders (列出收藏夹), get_folder (获取指定收藏夹视频)',
        },
        mediaId: { type: 'integer', description: '收藏夹 ID (get_folder 时必填)' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, res: any) => [
          {
            type: 'text',
            text: res.folders
              ? `[bilibili 收藏夹列表]:\n` +
                res.folders
                  .map((f: any) => `• [${f.id}] ${f.title} (包含 ${f.mediaCount} 个内容)`)
                  .join('\n')
              : `[bilibili 收藏夹内容] ${res.folderTitle}:\n` +
                (res.medias ?? [])
                  .slice(0, 10)
                  .map((m: any, i: number) => `${i + 1}. 《${m.title}》 (${m.bvid}) by ${m.upper}`)
                  .join('\n'),
          },
        ],
      },
      async execute(args: { action: string; mediaId?: number }) {
        const client = manager.requireAuthedClient();
        const mid = Number(client.userId);
        if (args.action === 'list_folders') {
          const res = await FavoriteAPI.getCreatedFolders(client, mid);
          const folders = (res.data?.list || []).map((f) => ({
            id: f.id,
            title: f.title,
            mediaCount: f.media_count,
          }));
          return { folders };
        } else if (args.action === 'get_folder') {
          if (!args.mediaId) throw new Error('查看收藏夹内容需要提供 mediaId');
          const res = await FavoriteAPI.getFolderList(client, args.mediaId, 20, 1);
          const medias = (res.data?.medias || []).map((m) => ({
            bvid: m.bvid,
            title: m.title,
            upper: m.upper?.name,
          }));
          return {
            folderTitle: res.data?.info?.title || '未命名收藏夹',
            medias,
          };
        } else {
          throw new Error('未知操作类型: ' + args.action);
        }
      },
    }),
  );

  // ==========================================
  // 13. bilibili_video_interact: 视频点赞/投币/三连 (需登录 + 安全确认)
  // ==========================================
  toolsRegistry.register(
    defineTool({
      name: 'bilibili_video_interact',
      description:
        '【需登录】对视频进行点赞、投币、一键三连操作。投币会消耗账号资产，请在 confirm=false 时向用户明确确认，获准后再以 confirm=true 执行。',
      parameters: {
        bvid: { type: 'string', required: true, description: '目标视频 BV 号' },
        action: {
          type: 'string',
          required: true,
          description: '交互类型: like (点赞), coin (投币), triple (一键三连)',
        },
        multiply: {
          type: 'integer',
          description: '投币枚数，可选 1 或 2，默认为 1',
        },
        confirm: {
          type: 'boolean',
          description:
            '是否确认执行写操作。默认为 false。在 confirm=false 时仅返回安全预检提示，不发起实际请求。',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, res: any) => [{ type: 'text', text: res.message }],
      },
      async execute(args: {
        bvid: string;
        action: string;
        multiply?: number;
        confirm?: boolean;
      }) {
        const client = manager.requireAuthedClient();
        const aid = bv2av(args.bvid);

        if (!args.confirm) {
          const actionName =
            args.action === 'like'
              ? '点赞'
              : args.action === 'coin'
              ? `投 ${args.multiply ?? 1} 枚硬币`
              : args.action === 'triple'
              ? '一键三连 (点赞+投币+收藏)'
              : args.action;

          return {
            confirmed: false,
            message:
              `[安全拦截提示] 即将对视频 ${args.bvid} 执行【${actionName}】。\n` +
              `请向用户确认无误后，再次调用本工具并传入 confirm=true 执行。`,
          };
        }

        if (args.action === 'like') {
          await VideoAPI.like(client, aid, 1);
          return { confirmed: true, message: `已成功为视频 ${args.bvid} 点赞！` };
        } else if (args.action === 'coin') {
          const multiply = args.multiply ?? 1;
          await VideoAPI.coin(client, aid, multiply, 1);
          return {
            confirmed: true,
            message: `已成功为视频 ${args.bvid} 投掷 ${multiply} 枚硬币并点赞！`,
          };
        } else if (args.action === 'triple') {
          const res = await VideoAPI.triple(client, aid);
          return {
            confirmed: true,
            message: `已成功为视频 ${args.bvid} 一键三连！(点赞: ${res.data?.like}, 投币: ${res.data?.coin}, 收藏: ${res.data?.fav})`,
          };
        } else {
          throw new Error('未知的交互动作: ' + args.action);
        }
      },
    }),
  );

  // ==========================================
  // 14. bilibili_send_comment: 发表/回复评论 (需登录 + 安全确认)
  // ==========================================
  toolsRegistry.register(
    defineTool({
      name: 'bilibili_send_comment',
      description:
        '【需登录】在指定视频下发表评论或回复他人评论。涉及真实账号公开留言，请在 confirm=false 时与用户核对留言文本，得到许可后再以 confirm=true 发送。',
      parameters: {
        bvid: { type: 'string', required: true, description: '目标视频 BV 号' },
        message: { type: 'string', required: true, description: '拟发表的评论文字' },
        rootRpid: { type: 'integer', description: '拟回复的根评论 RPID（回复他人时填写）' },
        parentRpid: { type: 'integer', description: '拟回复的父级评论 RPID（回复他人时填写）' },
        confirm: {
          type: 'boolean',
          description: '是否确认发表。默认为 false，请先与用户核对。',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, res: any) => [{ type: 'text', text: res.message }],
      },
      async execute(args: {
        bvid: string;
        message: string;
        rootRpid?: number;
        parentRpid?: number;
        confirm?: boolean;
      }) {
        const client = manager.requireAuthedClient();

        if (!args.confirm) {
          return {
            confirmed: false,
            message:
              `[安全拦截提示] 即将以您的 B 站账号在视频 ${args.bvid} 下发表评论：\n` +
              `「${args.message}」\n` +
              `请向用户确认内容是否合适，核准后传入 confirm=true 发送。`,
          };
        }

        const area = (await client.getVideo(args.bvid)).commentArea();
        const res = await area.add(args.message, args.rootRpid ?? 0, args.parentRpid ?? 0);

        return {
          confirmed: true,
          rpid: res.data?.rpid,
          message: `评论已成功发表在视频 ${args.bvid} 下！(RPID: ${res.data?.rpid})`,
        };
      },
    }),
  );

  // ==========================================
  // 15. bilibili_user_relation: UP 主关注/取关 (需登录)
  // ==========================================
  toolsRegistry.register(
    defineTool({
      name: 'bilibili_user_relation',
      description: '【需登录】关注、取消关注或拉黑指定 Bilibili UP 主。',
      parameters: {
        mid: { type: 'integer', required: true, description: '目标 UP 主数字 UID' },
        action: {
          type: 'string',
          required: true,
          description: '操作类型: follow (关注), unfollow (取消关注), block (拉黑)',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, res: any) => [{ type: 'text', text: res.message }],
      },
      async execute(args: { mid: number; action: string }) {
        const client = manager.requireAuthedClient();
        if (args.action === 'follow') {
          await UserAPI.modifyRelation(client, args.mid, 1);
          return { message: `已成功关注 UP 主 (UID: ${args.mid})` };
        } else if (args.action === 'unfollow') {
          await UserAPI.modifyRelation(client, args.mid, 2);
          return { message: `已成功取消关注 UP 主 (UID: ${args.mid})` };
        } else if (args.action === 'block') {
          await UserAPI.modifyRelation(client, args.mid, 5);
          return { message: `已成功拉黑 UP 主 (UID: ${args.mid})` };
        } else {
          throw new Error('未知的关系操作类型: ' + args.action);
        }
      },
    }),
  );
}
