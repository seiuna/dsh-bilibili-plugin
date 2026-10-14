import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerBilibiliTools } from '../src/tools.js';
import { BilibiliClientManager } from '../src/client-manager.js';
import {
  ArticleAPI,
  CommentAPI,
  DanmakuAPI,
  DynamicAPI,
  FavoriteAPI,
  HistoryAPI,
  LiveAPI,
  RankingAPI,
  SearchAPI,
  UserAPI,
  VideoAPI,
} from '@seiuna/bilibili-api';

describe('DSH 原生 Bilibili Tools (工具注册与执行测试)', () => {
  let registeredTools: Map<string, any>;
  let unregisterTools: () => void;
  let manager: BilibiliClientManager;

  beforeEach(() => {
    registeredTools = new Map();
    manager = BilibiliClientManager.getInstance();
    manager.isUnlocked = false;
    manager.cachedUser = null;
    // Fail closed: an unmocked SDK transport must never reach a real account or network.
    vi.spyOn(manager.client, 'request').mockRejectedValue(new Error('Unmocked SDK request in offline tool test'));
    vi.spyOn(manager.client, 'rawRequest').mockRejectedValue(new Error('Unmocked raw SDK request in offline tool test'));
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network disabled in offline tool test'); }));

    const mockRegistry = {
      register: (tool: any) => {
        registeredTools.set(tool.name, tool);
        return () => registeredTools.delete(tool.name);
      },
    };

    unregisterTools = registerBilibiliTools(mockRegistry, manager);
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('卸载时释放所有已注册工具以支持 DSH 热重载', () => {
    expect(registeredTools.size).toBe(24);
    unregisterTools();
    expect(registeredTools.size).toBe(0);
  });

  it('必须成功注册所有 24 个高内聚 Agent 原生工具', () => {
    expect(registeredTools.size).toBe(24);

    const expectedToolNames = [
      'bilibili_search',
      'bilibili_get_trends',
      'bilibili_get_video_info',
      'bilibili_get_video_ai_summary',
      'bilibili_get_video_play_url',
      'bilibili_get_comments',
      'bilibili_get_user_info',
      'bilibili_get_user_videos',
      'bilibili_get_my_info',
      'bilibili_view_history',
      'bilibili_manage_toview',
      'bilibili_manage_favorite',
      'bilibili_video_interact',
      'bilibili_send_comment',
      'bilibili_user_relation',
      'bilibili_get_dynamic_detail',
      'bilibili_get_user_dynamics',
      'bilibili_get_comment_detail',
      'bilibili_get_sub_comments',
      'bilibili_get_article_info',
      'bilibili_get_live_info',
      'bilibili_get_danmaku',
      'bilibili_get_video_recommend',
      'bilibili_dynamic_interact',
    ];

    for (const name of expectedToolNames) {
      expect(registeredTools.has(name), `工具 ${name} 必须已注册`).toBe(true);
      const tool = registeredTools.get(name);
      expect(tool.description).toBeDefined();
      expect(typeof tool.execute).toBe('function');
      expect(tool.output?.render).toBeDefined();
    }
  });

  it('所有工具输出为标准 JSON 且不含图标或散文模板', () => {
    const sample = { title: '标题', like: 3, nested: { list: [1, 2] }, missing: undefined, unknown: null };
    for (const name of registeredTools.keys()) {
      const rendered = registeredTools.get(name).output.render({}, sample);
      expect(rendered[0].type).toBe('text', `工具 ${name} 输出必须是 text block`);
      expect(JSON.parse(rendered[0].text), `工具 ${name} 输出必须是可解析 JSON`).toMatchObject({
        title: '标题', like: 3, unknown: null,
      });
      expect(rendered[0].text, `工具 ${name} 输出不得含图标/装饰符号`).not
        .toMatch(/[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}]/u);
    }
  });

  describe('公开只读工具 (无需登录)', () => {
    it('bilibili_search: 综合搜索与结果渲染', async () => {
      const tool = registeredTools.get('bilibili_search')!;

      vi.spyOn(SearchAPI, 'searchAll').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: {
          seid: '123',
          page: 1,
          page_size: 20,
          numResults: 100,
          numPages: 5,
          pageinfo: {},
          top_tlist: {},
          show_module_list: [],
          result: [
            {
              result_type: 'video',
              data: [
                {
                  title: '<em class="keyword">DeepSeek</em> 极速入门',
                  bvid: 'BV1testSearch01',
                  author: '科技UP',
                  mid: 999,
                  play: 10000,
                  pic: 'http://example.com/pic.jpg',
                },
              ],
            },
          ],
        },
      });

      const result = await tool.execute({ keyword: 'DeepSeek' });
      expect(result.success).toBe(true);
      expect(result.results.length).toBe(1);
      expect(result.results[0].title).toBe('DeepSeek 极速入门'); // HTML 标签被过滤
      expect(result.results[0].bvid).toBe('BV1testSearch01');

      // 验证标准 JSON 输出（无图标、无散文模板）
      const rendered = tool.output.render({ keyword: 'DeepSeek' }, result);
      expect(rendered[0].type).toBe('text');
      const json = JSON.parse(rendered[0].text);
      expect(json.total).toBe(100);
      expect(json.results[0].title).toBe('DeepSeek 极速入门');
      expect(json.results[0].bvid).toBe('BV1testSearch01');
      expect(rendered[0].text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}]/u);
    });

    it('bilibili_get_trends: 获取热搜与热门榜单', async () => {
      const tool = registeredTools.get('bilibili_get_trends')!;

      vi.spyOn(SearchAPI, 'getHotSearch').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: {
          title: '热搜',
          trackid: 't1',
          list: [{ keyword: 'DeepSeek 发布新模型', show_name: 'DeepSeek 新突破', icon: '', uri: '', goto: '' }],
        },
      });

      const hotResult = await tool.execute({ category: 'hot' });
      expect(hotResult.category).toBe('hot');
      expect(hotResult.list[0].keyword).toBe('DeepSeek 新突破');

      const rendered = tool.output.render({ category: 'hot' }, hotResult);
      const json = JSON.parse(rendered[0].text);
      expect(json.category).toBe('hot');
      expect(json.list[0].keyword).toBe('DeepSeek 新突破');
    });

    it('bilibili_get_video_info: 获取视频详细信息', async () => {
      const tool = registeredTools.get('bilibili_get_video_info')!;

      vi.spyOn(VideoAPI, 'getInfo').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: {
          bvid: 'BV1GJ411x7h7',
          aid: 1234567,
          videos: 1,
          tid: 1,
          tname: '科技',
          copyright: 1,
          pic: 'http://pic.jpg',
          title: 'DSH 插件开发全景指南',
          pubdate: 1741340000,
          ctime: 1741340000,
          desc: '视频详细测试介绍文本',
          state: 0,
          duration: 360,
          cid: 10001,
          owner: { mid: 390794259, name: 'seiuna', face: 'http://face.jpg' },
          stat: {
            view: 5000,
            danmaku: 100,
            reply: 50,
            favorite: 800,
            coin: 600,
            share: 30,
            like: 1200,
          },
          dynamic: '',
          dimension: { width: 1920, height: 1080, rotate: 0 },
          pages: [{ cid: 10001, page: 1, part: 'P1 正片', duration: 360 }],
          subtitle: { allow_submit: false, list: [] },
          rights: {},
        },
      });

      vi.spyOn(VideoAPI, 'getTags').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: [{ tag_id: 1, tag_name: 'DeepSeek' }, { tag_id: 2, tag_name: '人工智能' }],
      });

      const res = await tool.execute({ bvid: 'BV1GJ411x7h7' });
      expect(res.bvid).toBe('BV1GJ411x7h7');
      expect(res.title).toBe('DSH 插件开发全景指南');
      expect(res.owner.name).toBe('seiuna');
      expect(res.tags).toEqual(['DeepSeek', '人工智能']);

      const rendered = tool.output.render({}, res);
      const json = JSON.parse(rendered[0].text);
      expect(json.owner.name).toBe('seiuna');
      expect(json.stat.like).toBe(1200);
      expect(json.stat.coin).toBe(600);
    });

    it('bilibili_get_video_ai_summary: 官方 AI 视频摘要提取', async () => {
      const tool = registeredTools.get('bilibili_get_video_ai_summary')!;

      vi.spyOn(VideoAPI, 'getInfo').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: {
          bvid: 'BV1GJ411x7h7',
          aid: 998877,
          cid: 556677,
          title: 'AI 大模型演进史',
          owner: { mid: 1001, name: '科普君', face: '' },
        } as any,
      });

      vi.spyOn(VideoAPI, 'getAiSummary').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: {
          code: 0,
          stid: 's1',
          like_num: 10,
          dislike_num: 0,
          model_result: {
            result_type: 1,
            summary: '本视频详细梳理了大语言模型从 Transformer 到推理模型的技术跨越。',
            outline: [
              {
                title: '引言与架构初探',
                timestamp: 65,
                part_outline: [
                  { timestamp: 70, content: 'Transformer 的自注意力机制' },
                ],
              },
            ],
            subtitle: [],
          },
        },
      });

      const res = await tool.execute({ bvid: 'BV1GJ411x7h7' });
      expect(res.bvid).toBe('BV1GJ411x7h7');
      expect(res.summary).toContain('Transformer 到推理模型');
      expect(res.outline[0].title).toBe('引言与架构初探');
      expect(res.outline[0].timeStr).toBe('1:05');

      const rendered = tool.output.render({}, res);
      const json = JSON.parse(rendered[0].text);
      expect(json.summary).toContain('Transformer 到推理模型');
      expect(json.outline[0].title).toBe('引言与架构初探');
      expect(json.outline[0].timeStr).toBe('1:05');
    });

    it('bilibili_get_user_info: 查询 UP 主资料', async () => {
      const tool = registeredTools.get('bilibili_get_user_info')!;

      vi.spyOn(UserAPI, 'getInfo').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: {
          mid: 390794259,
          name: 'seiuna',
          face: 'http://face.jpg',
          sign: 'Coding with passion',
          rank: 1,
          level: 6,
        } as any,
      });

      vi.spyOn(UserAPI, 'getRelationStat').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: {
          mid: 390794259,
          following: 120,
          whisper: 0,
          black: 0,
          follower: 25000,
        },
      });

      vi.spyOn(UserAPI, 'getUpStat').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: {
          likes: 88888,
        } as any,
      });

      const res = await tool.execute({ mid: 390794259 });
      expect(res.mid).toBe(390794259);
      expect(res.name).toBe('seiuna');
      expect(res.fans).toBe(25000);
      expect(res.likes).toBe(88888);

      const rendered = tool.output.render({}, res);
      const json = JSON.parse(rendered[0].text);
      expect(json.name).toBe('seiuna');
      expect(json.fans).toBe(25000);
      expect(json.following).toBe(120);
      expect(json.likes).toBe(88888);
    });

    it('bilibili_get_dynamic_detail: 获取动态详情与解析', async () => {
      const tool = registeredTools.get('bilibili_get_dynamic_detail')!;

      vi.spyOn(DynamicAPI, 'getDetail').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: {
          item: {
            id_str: '103681491234567890',
            type: 'DYNAMIC_TYPE_DRAW',
            basic: {
              comment_id_str: '888899',
              comment_type: 11,
              rid_str: '103681491234567890',
              uid: 12345,
            },
            modules: [
              {
                module_author: {
                  mid: 12345,
                  name: '画师UP',
                  pub_time_text: '10分钟前',
                },
              },
              {
                module_dynamic: {
                  desc: { text: '这是今天的新插画分享~' },
                  major: {
                    draw: {
                      items: [{ src: 'https://i0.hdslb.com/pic1.jpg' }],
                    },
                  },
                },
              },
              {
                module_stat: {
                  repost: { count: 5 },
                  comment: { count: 12 },
                  like: { count: 108 },
                },
              },
            ],
          },
        } as any,
      });

      const res = await tool.execute({ dynamicId: 'https://t.bilibili.com/103681491234567890' });
      expect(res.id).toBe('103681491234567890');
      expect(res.author.name).toBe('画师UP');
      expect(res.text).toBe('这是今天的新插画分享~');
      expect(res.pictures).toEqual(['https://i0.hdslb.com/pic1.jpg']);
      expect(res.stats.like).toBe(108);
      expect(res.commentOid).toBe('888899');
      expect(res.commentType).toBe(11);

      const rendered = tool.output.render({}, res);
      const json = JSON.parse(rendered[0].text);
      expect(json.author.name).toBe('画师UP');
      expect(json.pictures).toEqual(['https://i0.hdslb.com/pic1.jpg']);
      expect(json.stats.like).toBe(108);
    });

    it('bilibili_get_user_dynamics: 获取 UP 主动态列表', async () => {
      const tool = registeredTools.get('bilibili_get_user_dynamics')!;

      vi.spyOn(DynamicAPI, 'getSpace').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: {
          has_more: true,
          offset: 'cursor_123',
          items: [
            {
              id_str: 'dyn_1',
              modules: {
                module_author: { pub_time_text: '昨天' },
                module_dynamic: { desc: { text: '动态第1条' } },
                module_stat: { like: { count: 20 }, comment: { count: 3 }, repost: { count: 1 } },
              },
            },
          ] as any,
        },
      });

      const res = await tool.execute({ mid: 12345 });
      expect(res.mid).toBe(12345);
      expect(res.hasMore).toBe(true);
      expect(res.nextOffset).toBe('cursor_123');
      expect(res.items.length).toBe(1);
      expect(res.items[0].text).toBe('动态第1条');

      const rendered = tool.output.render({}, res);
      const json = JSON.parse(rendered[0].text);
      expect(json.items[0].text).toBe('动态第1条');
      expect(json.nextOffset).toBe('cursor_123');
    });

    it('bilibili_get_comment_detail: 精确查询单条评论', async () => {
      const tool = registeredTools.get('bilibili_get_comment_detail')!;

      vi.spyOn(CommentAPI, 'getReply').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: {
          rpid: 99887766,
          oid: 123456,
          type: 1,
          root: 0,
          parent: 0,
          count: 5,
          like: 66,
          ctime: 1700000000,
          member: { uname: '评论观众', mid: 112233 },
          content: { message: '这个视频讲得很透彻！' },
        } as any,
      });

      const res = await tool.execute({ oid: 123456, rpid: '99887766', replyType: 1 });
      expect(res.rpid).toBe('99887766');
      expect(res.user).toBe('评论观众');
      expect(res.mid).toBe('112233');
      expect(res.like).toBe(66);
      expect(res.message).toBe('这个视频讲得很透彻！');

      const rendered = tool.output.render({}, res);
      const json = JSON.parse(rendered[0].text);
      expect(json.rpid).toBe('99887766');
      expect(json.root).toBe('0');
      expect(json.parent).toBe('0');
    });

    it('bilibili_get_sub_comments: 查询二级楼中楼回复', async () => {
      const tool = registeredTools.get('bilibili_get_sub_comments')!;

      vi.spyOn(CommentAPI, 'getReplyDialog').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: {
          root: { rpid: 100 },
          page: { count: 1, size: 20 },
          replies: [
            {
              rpid: 101,
              parent: 100,
              like: 12,
              member: { uname: '楼中楼回复者', mid: 555 },
              content: { message: '同意楼上的看法！' },
            },
          ] as any,
        } as any,
      });

      const res = await tool.execute({ oid: 123456, rootRpid: 100 });
      expect(res.rootRpid).toBe(100);
      expect(res.total).toBe(1);
      expect(res.comments[0].user).toBe('楼中楼回复者');
      expect(res.comments[0].message).toBe('同意楼上的看法！');

      const rendered = tool.output.render({}, res);
      const json = JSON.parse(rendered[0].text);
      expect(json.rootRpid).toBe(100);
      expect(json.comments[0].message).toBe('同意楼上的看法！');
      expect(json.comments[0].parent).toBe('100');
    });

    it('bilibili_get_article_info: 获取专栏文章详情', async () => {
      const tool = registeredTools.get('bilibili_get_article_info')!;

      vi.spyOn(ArticleAPI, 'getView').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: {
          id: 12345,
          title: '深度学习模型训练精讲',
          summary: '本文从基础讲起...',
          content: '<p>深度学习的<b>核心</b>是反向传播算法。</p>',
          author: { name: '技术专栏UP', mid: 9999, face: '' },
        } as any,
      });

      vi.spyOn(ArticleAPI, 'getInfo').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: {
          stats: { view: 50000, like: 1200, coin: 300, favorite: 800, reply: 90, share: 40 },
        } as any,
      });

      const res = await tool.execute({ id: 12345 });
      expect(res.title).toBe('深度学习模型训练精讲');
      expect(res.author.name).toBe('技术专栏UP');
      expect(res.content).toBe('深度学习的核心是反向传播算法。');
      expect(res.stats.view).toBe(50000);
      expect(res.stats.like).toBe(1200);

      const rendered = tool.output.render({}, res);
      const json = JSON.parse(rendered[0].text);
      expect(json.title).toBe('深度学习模型训练精讲');
      expect(json.content).toBe('深度学习的核心是反向传播算法。');
      expect(json.contentAvailable).toBe(true);
    });

    it('bilibili_get_live_info: 获取直播间信息', async () => {
      const tool = registeredTools.get('bilibili_get_live_info')!;

      vi.spyOn(LiveAPI, 'getRoomInfo').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: {
          room_id: 10001,
          short_id: 1,
          uid: 88888,
          title: '原神新版本开荒探索！',
          live_status: 1,
          parent_area_name: '网游',
          area_name: '原神',
          online: 156000,
          live_time: '2025-01-01 19:00:00',
        } as any,
      });

      vi.spyOn(UserAPI, 'getInfo').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: { name: '知名主播' } as any,
      });

      const res = await tool.execute({ roomId: 10001 });
      expect(res.roomId).toBe(10001);
      expect(res.shortId).toBe(1);
      expect(res.isLiving).toBe(true);
      expect(res.uname).toBe('知名主播');
      expect(res.online).toBe(156000);

      const rendered = tool.output.render({}, res);
      const json = JSON.parse(rendered[0].text);
      expect(json.title).toBe('原神新版本开荒探索！');
      expect(json.isLiving).toBe(true);
      expect(json.liveStatus).toBe(1);
      expect(json.uname).toBe('知名主播');
      expect(json.parentAreaName).toBe('网游');
      expect(json.areaName).toBe('原神');
    });

    it('bilibili_get_danmaku: 获取弹幕并解析', async () => {
      const tool = registeredTools.get('bilibili_get_danmaku')!;

      vi.spyOn(DanmakuAPI, 'getXmlDanmaku').mockResolvedValueOnce(
        '<?xml version="1.0" encoding="UTF-8"?><i><d p="12.5,1,25,16777215,1700000000,0,abcd,1">前方高能！</d><d p="45.0,1,25,16777215,1700000000,0,abcd,2">名场面打卡</d></i>'
      );

      const res = await tool.execute({ cid: 99999, limit: 10 });
      expect(res.cid).toBe(99999);
      expect(res.total).toBe(2);
      expect(res.danmaku[0].text).toBe('前方高能！');
      expect(res.danmaku[0].timeFormatted).toBe('00:12');
      expect(res.danmaku[1].text).toBe('名场面打卡');
      expect(res.danmaku[1].timeFormatted).toBe('00:45');

      const rendered = tool.output.render({}, res);
      const json = JSON.parse(rendered[0].text);
      expect(json.danmaku.map((d: any) => d.text)).toEqual(['前方高能！', '名场面打卡']);
      expect(json.danmaku.map((d: any) => d.timeFormatted)).toEqual(['00:12', '00:45']);
    });

    it('bilibili_get_video_recommend: 获取相关推荐视频', async () => {
      const tool = registeredTools.get('bilibili_get_video_recommend')!;

      vi.spyOn(VideoAPI, 'getRecommend').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: [
          {
            aid: 1122,
            bvid: 'BV1rec01',
            title: '相关推荐视频1',
            duration: 180,
            owner: { name: 'UP主A', mid: 10 },
            stat: { view: 99999 },
          },
        ] as any,
      });

      const res = await tool.execute({ bvid: 'BV1GJ411x7h7' });
      expect(res.list.length).toBe(1);
      expect(res.list[0].bvid).toBe('BV1rec01');
      expect(res.list[0].author).toBe('UP主A');
      expect(res.list[0].play).toBe(99999);

      const rendered = tool.output.render({}, res);
      const json = JSON.parse(rendered[0].text);
      expect(json.list[0].title).toBe('相关推荐视频1');
      expect(json.list[0].author).toBe('UP主A');
    });
  });

  describe('需登录工具鉴权拦截 (未解锁防护)', () => {
    it('当处于未登录或加锁状态时，调用 bilibili_get_my_info 必须拒绝并提示解锁', async () => {
      const tool = registeredTools.get('bilibili_get_my_info')!;
      await expect(tool.execute({})).rejects.toThrow(/Bilibili 凭据尚未解锁/);
    });

    it('当处于未登录或加锁状态时，调用 bilibili_view_history 必须拒绝并提示解锁', async () => {
      const tool = registeredTools.get('bilibili_view_history')!;
      await expect(tool.execute({})).rejects.toThrow(/Bilibili 凭据尚未解锁/);
    });

    it('当处于未登录或加锁状态时，调用 bilibili_manage_toview 必须拒绝并提示解锁', async () => {
      const tool = registeredTools.get('bilibili_manage_toview')!;
      await expect(tool.execute({ action: 'list' })).rejects.toThrow(/Bilibili 凭据尚未解锁/);
    });

    it('当处于未登录或加锁状态时，调用 bilibili_manage_favorite 必须拒绝并提示解锁', async () => {
      const tool = registeredTools.get('bilibili_manage_favorite')!;
      await expect(tool.execute({ action: 'list_folders' })).rejects.toThrow(/Bilibili 凭据尚未解锁/);
    });

    it('当处于未登录或加锁状态时，调用 bilibili_user_relation 必须拒绝并提示解锁', async () => {
      const tool = registeredTools.get('bilibili_user_relation')!;
      await expect(tool.execute({ mid: 123, action: 'follow' })).rejects.toThrow(/Bilibili 凭据尚未解锁/);
    });

    it('当处于未登录或加锁状态时，调用 bilibili_dynamic_interact 必须拒绝并提示解锁', async () => {
      const tool = registeredTools.get('bilibili_dynamic_interact')!;
      await expect(tool.execute({ dynamicId: '12345', action: 'like', confirm: true })).rejects.toThrow(/Bilibili 凭据尚未解锁/);
    });
  });

  describe('写操作安全拦截机制 (confirm=false / confirm=true)', () => {
    beforeEach(() => {
      // 模拟已登录解锁状态
      manager.isUnlocked = true;
      manager.cachedUser = {
        mid: 390794259,
        uname: '测试管理员',
        face: '',
        level: 6,
        coins: 100,
        vipType: 2,
      };
      manager.client.config.data.cookie = 'DedeUserID=390794259; SESSDATA=test; bili_jct=csrf';
    });

    it('bilibili_video_interact: confirm=false 时必须进行安全拦截，不触发真实请求', async () => {
      const tool = registeredTools.get('bilibili_video_interact')!;
      const likeSpy = vi.spyOn(VideoAPI, 'like');

      const res = await tool.execute({
        bvid: 'BV1GJ411x7h7',
        action: 'coin',
        multiply: 2,
        confirm: false,
      });

      expect(res.confirmed).toBe(false);
      expect(res.message).toContain('[安全拦截提示]');
      expect(res.message).toContain('投 2 枚硬币');
      expect(likeSpy).not.toHaveBeenCalled();
    });

    it('bilibili_video_interact: confirm=true 时执行点赞/投币真实调用', async () => {
      const tool = registeredTools.get('bilibili_video_interact')!;
      vi.spyOn(VideoAPI, 'like').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: null,
      });

      const res = await tool.execute({
        bvid: 'BV1GJ411x7h7',
        action: 'like',
        confirm: true,
      });

      expect(res.confirmed).toBe(true);
      expect(res.message).toContain('已成功为视频 BV1GJ411x7h7 点赞');
    });

    it('bilibili_send_comment: confirm=false 时必须安全拦截并展示拟发表的评论预览', async () => {
      const tool = registeredTools.get('bilibili_send_comment')!;

      const res = await tool.execute({
        bvid: 'BV1GJ411x7h7',
        message: '这是一条由 DSH Agent 发出的自动测试留言',
        confirm: false,
      });

      expect(res.confirmed).toBe(false);
      expect(res.message).toContain('[安全拦截提示]');
      expect(res.message).toContain('这是一条由 DSH Agent 发出的自动测试留言');
    });

    it('bilibili_send_comment: dynamicId 预览零请求并展示动态目标', async () => {
      const tool = registeredTools.get('bilibili_send_comment')!;
      const detailSpy = vi.spyOn(DynamicAPI, 'getDetail');

      const res = await tool.execute({ dynamicId: '103681491234567890', message: '动态测试留言', confirm: false });

      expect(res.confirmed).toBe(false);
      expect(res.message).toContain('[安全拦截提示]');
      expect(res.message).toContain('动态 103681491234567890');
      expect(detailSpy).not.toHaveBeenCalled();
    });

    it('bilibili_send_comment: 拒绝视频与动态混用或缺失目标', async () => {
      const tool = registeredTools.get('bilibili_send_comment')!;
      await expect(tool.execute({ bvid: 'BV1GJ411x7h7', dynamicId: '103681491234567890', message: 'x', confirm: true })).rejects.toThrow('不可混用');
      await expect(tool.execute({ message: 'x', confirm: true })).rejects.toThrow('必须提供');
    });

    it('bilibili_send_comment: confirm=true 时解析动态真实评论区后发表', async () => {
      const tool = registeredTools.get('bilibili_send_comment')!;
      vi.spyOn(DynamicAPI, 'getDetail').mockResolvedValueOnce({
        code: 0, message: '0', ttl: 1,
        data: { item: { id_str: '103681491234567890', basic: { comment_id_str: '888899', comment_type: 11 } } },
      } as any);
      const addSpy = vi.spyOn(CommentAPI, 'add').mockResolvedValueOnce({
        code: 0, message: '0', ttl: 1, data: { rpid_str: '99887766', need_captcha: false },
      } as any);

      const res = await tool.execute({ dynamicId: '103681491234567890', message: '动态测试留言', confirm: true });

      expect(res.confirmed).toBe(true);
      expect(addSpy).toHaveBeenCalledWith(expect.anything(), '888899', '动态测试留言', 11, 0, 0);
      expect(res.message).toContain('动态 103681491234567890');
    });

    it('bilibili_send_comment: 动态评论区解析失败时不发表', async () => {
      const tool = registeredTools.get('bilibili_send_comment')!;
      vi.spyOn(DynamicAPI, 'getDetail').mockResolvedValueOnce({
        code: 0, message: '0', ttl: 1,
        data: { item: { id_str: '103681491234567890', basic: { comment_type: 11 } } },
      } as any);
      const addSpy = vi.spyOn(CommentAPI, 'add');

      await expect(tool.execute({ dynamicId: '103681491234567890', message: '动态测试留言', confirm: true })).rejects.toThrow('动态评论区 oid');
      expect(addSpy).not.toHaveBeenCalled();
    });

    it('bilibili_dynamic_interact: confirm=false 时必须进行安全拦截，不触发真实请求', async () => {
      const tool = registeredTools.get('bilibili_dynamic_interact')!;
      const likeSpy = vi.spyOn(DynamicAPI, 'like');

      const res = await tool.execute({
        dynamicId: '103681491234567890',
        action: 'like',
        confirm: false,
      });

      expect(res.confirmed).toBe(false);
      expect(res.message).toContain('[安全拦截提示]');
      expect(res.message).toContain('点赞动态');
      expect(likeSpy).not.toHaveBeenCalled();
    });

    it('bilibili_dynamic_interact: confirm=true 时执行真实点赞调用', async () => {
      const tool = registeredTools.get('bilibili_dynamic_interact')!;
      vi.spyOn(DynamicAPI, 'like').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: null,
      });

      const res = await tool.execute({
        dynamicId: '103681491234567890',
        action: 'like',
        confirm: true,
      });

      expect(res.confirmed).toBe(true);
      expect(res.message).toContain('已成功对动态 103681491234567890 执行【点赞】操作');
    });
  });
});
