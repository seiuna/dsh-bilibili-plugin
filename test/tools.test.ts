import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerBilibiliTools } from '../src/tools.js';
import { BilibiliClientManager } from '../src/client-manager.js';
import {
  SearchAPI,
  RankingAPI,
  VideoAPI,
  CommentAPI,
  UserAPI,
  HistoryAPI,
  FavoriteAPI,
} from '@seiuna/bilibili-api';

describe('DSH 原生 Bilibili Tools (工具注册与执行测试)', () => {
  let registeredTools: Map<string, any>;
  let manager: BilibiliClientManager;

  beforeEach(() => {
    registeredTools = new Map();
    manager = BilibiliClientManager.getInstance();
    manager.isUnlocked = false;
    manager.cachedUser = null;

    const mockRegistry = {
      register: (tool: any) => {
        registeredTools.set(tool.name, tool);
      },
    };

    registerBilibiliTools(mockRegistry, manager);
  });

  it('必须成功注册所有 15 个高内聚 Agent 原生工具', () => {
    expect(registeredTools.size).toBe(15);

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
    ];

    for (const name of expectedToolNames) {
      expect(registeredTools.has(name), `工具 ${name} 必须已注册`).toBe(true);
      const tool = registeredTools.get(name);
      expect(tool.description).toBeDefined();
      expect(typeof tool.execute).toBe('function');
      expect(tool.output?.render).toBeDefined();
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

      // 验证 render 渲染
      const rendered = tool.output.render({ keyword: 'DeepSeek' }, result);
      expect(rendered[0].type).toBe('text');
      expect(rendered[0].text).toContain('搜索【DeepSeek】共找到 100 条结果');
      expect(rendered[0].text).toContain('DeepSeek 极速入门 (BV1testSearch01)');
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
      expect(rendered[0].text).toContain('榜单【hot】');
      expect(rendered[0].text).toContain('DeepSeek 新突破');
    });

    it('bilibili_get_video_info: 获取视频详细信息', async () => {
      const tool = registeredTools.get('bilibili_get_video_info')!;

      vi.spyOn(VideoAPI, 'getInfo').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: {
          bvid: 'BV1testVideo',
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

      const res = await tool.execute({ bvid: 'BV1testVideo' });
      expect(res.bvid).toBe('BV1testVideo');
      expect(res.title).toBe('DSH 插件开发全景指南');
      expect(res.owner.name).toBe('seiuna');
      expect(res.tags).toEqual(['DeepSeek', '人工智能']);

      const rendered = tool.output.render({}, res);
      expect(rendered[0].text).toContain('《DSH 插件开发全景指南》 (BV1testVideo)');
      expect(rendered[0].text).toContain('UP 主: seiuna');
      expect(rendered[0].text).toContain('点赞: 1200 | 投币: 600');
    });

    it('bilibili_get_video_ai_summary: 官方 AI 视频摘要提取', async () => {
      const tool = registeredTools.get('bilibili_get_video_ai_summary')!;

      vi.spyOn(VideoAPI, 'getInfo').mockResolvedValueOnce({
        code: 0,
        message: '0',
        ttl: 1,
        data: {
          bvid: 'BV1aiSummary',
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

      const res = await tool.execute({ bvid: 'BV1aiSummary' });
      expect(res.bvid).toBe('BV1aiSummary');
      expect(res.summary).toContain('Transformer 到推理模型');
      expect(res.outline[0].title).toBe('引言与架构初探');
      expect(res.outline[0].timeStr).toBe('1:05');

      const rendered = tool.output.render({}, res);
      expect(rendered[0].text).toContain('[bilibili AI 摘要]');
      expect(rendered[0].text).toContain('总结: 本视频详细梳理了');
      expect(rendered[0].text).toContain('[1:05] 引言与架构初探');
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
      expect(rendered[0].text).toContain('seiuna (UID: 390794259) Lv.6');
      expect(rendered[0].text).toContain('粉丝: 25000 | 关注: 120 | 获赞: 88888');
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
  });
});
