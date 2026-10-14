import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PollerService } from '../src/poller-service.js';
import { BilibiliClientManager } from '../src/client-manager.js';
import { commandRegistry } from '../src/command/index.js';
import { MessageAPI, CommentArea, CommentAPI } from '@seiuna/bilibili-api';
import { DispatchQueue } from '../src/poller/dispatch-queue.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('PollerService (消息轮询、去重、白名单与两阶段分发测试)', () => {
  const tempDir = path.join(os.tmpdir(), `dsh-bili-poller-test-${Date.now()}`);
  const testConfigFile = path.join(tempDir, 'poller-config.json');

  let poller: PollerService;
  let manager: BilibiliClientManager;

  beforeEach(async () => {
    process.env.BILIBILI_POLLER_CONFIG_PATH = testConfigFile;
    process.env.BILIBILI_PROMPT_PATH = path.join(tempDir, 'test-prompt.md');
    await fs.mkdir(tempDir, { recursive: true });

    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('offline: network forbidden'); }));
    (PollerService as any).instance = null;
    manager = { getClient: () => ({}), isUnlocked: true } as any;
    vi.spyOn(MessageAPI, 'getReplyFeed').mockResolvedValue({ code: 0, data: { items: [] } } as any);
    vi.spyOn(MessageAPI, 'getAtFeed').mockResolvedValue({ code: 0, data: { items: [] } } as any);
    manager.isUnlocked = true;
    poller = PollerService.getInstance(manager);
    await poller.loadConfig();
    poller.stop();
    vi.spyOn(poller, 'hydrateSourceContext').mockResolvedValue();
    vi.spyOn(poller, 'hydrateCommentImages').mockResolvedValue();
    vi.spyOn(CommentArea.prototype, 'like').mockResolvedValue({ code: 0, message: '0', ttl: 1, data: null });
  });

  afterEach(async () => {
    poller.stop();
    await poller.waitForDispatches();
    await poller.flushRecentMessages();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    (PollerService as any).instance = null;
    delete process.env.BILIBILI_POLLER_CONFIG_PATH;
    delete process.env.BILIBILI_PROMPT_PATH;
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('正确加载与保存轮询配置', async () => {
    await poller.saveConfig({
      enableReply: false,
      enableAt: true,
      enableWhitelist: true,
    });

    const cfg = poller.getConfig();
    expect(cfg.enableReply).toBe(false);
    expect(cfg.enableAt).toBe(true);
    expect(cfg.enableWhitelist).toBe(true);

    // 重新从文件加载
    const reloaded = await poller.loadConfig();
    expect(reloaded.enableReply).toBe(false);
    expect(reloaded.enableWhitelist).toBe(true);
  });


  it('DSH 失败最多重试三次并只返回安全错误文案', async () => {
    const context = poller.buildSessionContext('reply', {
      id: 1001,
      user: { mid: 7, nickname: 'offline' },
      item: { business_id: 1, business: 'video', subject_id: 20, source_id: 1001, root_id: 0, source_content: 'hello' },
    });
    const reply = vi.fn().mockResolvedValue({ code: 0 });
    context.reply = reply;
    poller.setDshHandler(vi.fn().mockRejectedValue(new Error('private stack and credential detail')));

    await poller.dispatch(context);

    expect((poller as any).dshHandler).toHaveBeenCalledTimes(3);
    expect(reply).toHaveBeenCalledWith('执行过程中出现错误');
    expect(reply.mock.calls.flat().join(' ')).not.toContain('private stack');
  });

  it('模型不可用重试三次后返回专用安全文案', async () => {
    const context = poller.buildSessionContext('reply', {
      id: 1002,
      user: { mid: 7, nickname: 'offline' },
      item: { business_id: 1, business: 'video', subject_id: 20, source_id: 1002, root_id: 0, source_content: 'hello' },
    });
    const reply = vi.fn().mockResolvedValue({ code: 0 });
    context.reply = reply;
    const unavailable = Object.assign(new Error('provider internal detail'), { name: 'BiliModelUnavailableError' });
    poller.setDshHandler(vi.fn().mockRejectedValue(unavailable));

    await poller.dispatch(context);

    expect((poller as any).dshHandler).toHaveBeenCalledTimes(3);
    expect(reply).toHaveBeenCalledWith('执行过程中出现错误：模型不可用');
    expect(reply.mock.calls.flat().join(' ')).not.toContain('provider internal detail');
  });

  it('配置落盘失败时抛错并回滚内存配置', async () => {
    const before = poller.getConfig();
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk offline'));
    await expect(poller.saveConfig({ enableReply: !before.enableReply })).rejects.toThrow('保存轮询配置失败');
    expect(poller.getConfig().enableReply).toBe(before.enableReply);
  });

  it('白名单添加与移除操作', async () => {
    const user = {
      mid: 390794259,
      uname: 'iroha_daisuki',
      face: 'https://example.com/face.jpg',
    };

    await poller.addWhitelistUser(user);
    expect(poller.getConfig().whitelist.length).toBe(1);
    expect(poller.getConfig().whitelist[0].mid).toBe(390794259);

    // 重复添加同一个用户应该幂等
    await poller.addWhitelistUser(user);
    expect(poller.getConfig().whitelist.length).toBe(1);

    // 移除
    await poller.removeWhitelistUser(390794259);
    expect(poller.getConfig().whitelist.length).toBe(0);
  });

  it('自动初始化人设文件 bilibili-prompt.md，支持独立文件读写与热生效', async () => {
    // 首次获取自动创建文件并写入默认人设
    const prompt = await poller.getSystemPrompt();
    expect(prompt).toContain('你是一个活跃在哔哩哔哩（B站）');

    // 写入新的人设
    const customPrompt = '【自定义人设】我是超可爱的二次元管家！';
    await poller.saveSystemPrompt(customPrompt);

    const reloaded = await poller.getSystemPrompt();
    expect(reloaded).toBe(customPrompt);
  });

  it('buildSessionContext 正确构造上下文参数', () => {
    const mockRaw = {
      user: {
        mid: 1001,
        nickname: '测试观众',
        avatar: 'https://example.com/avatar.jpg',
      },
      item: {
        business_id: 1,
        business: 'archive',
        subject_id: 123456,
        source_id: 78901,
        root_id: 78900,
        source_content: '/echo 你好世界',
        target_reply_content: '这是原评论',
        title: '测试视频',
        image: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
        pictures: [{ img_src: 'https://i0.hdslb.com/bfs/comment/pic1.jpg' }],
      },
    };

    const ctx = poller.buildSessionContext('reply', mockRaw);

    expect(ctx.sourceType).toBe('video');
    expect(ctx.userId).toBe('1001');
    expect(ctx.userName).toBe('测试观众');
    expect(ctx.message).toBe('/echo 你好世界');
    expect(ctx.originMessage).toBe('这是原评论');
    expect(ctx.root).toBe(78900);
    expect(ctx.sourceId).toBe(78901);
    expect(ctx.images).toEqual([]); // 通知的封面和 pictures 均不是评论详情附件
    expect(ctx.event.command).toBe('echo');
    expect(ctx.event.args).toEqual(['你好世界']);
    expect(typeof ctx.reply).toBe('function');
  });

  it('针对动态业务消息识别为 dynamic', () => {
    const mockRaw = {
      user: { mid: 1002, nickname: '动态观众', avatar: '' },
      item: {
        business_id: 11,
        business: 'dynamic',
        subject_id: 8888,
        source_id: 9999,
        root_id: 0,
        source_content: '好耶',
      },
    };

    const ctx = poller.buildSessionContext('at', mockRaw);
    expect(ctx.sourceType).toBe('dynamic');
    expect(ctx.root).toBe(9999); // root_id === 0 时自动 fallback 到 source_id
    expect(typeof ctx.like).toBe('function');
  });

  it('autoLikeOnReply 开启时，收到通知自动调用 like() 点赞', async () => {
    await poller.saveConfig({
      enableReply: true,
      enableAt: false,
      autoLikeOnReply: true,
      enableWhitelist: false,
    });

    vi.spyOn(MessageAPI, 'unreadCount').mockImplementation(() => { throw new Error('unreadCount must not be used'); });

    const mockItem = {
      user: { mid: 8888, nickname: '粉丝小伙伴', avatar: '' },
      item: {
        business_id: 1,
        subject_id: 666,
        source_id: 777,
        root_id: 0,
        source_content: 'UP主好棒！',
      },
    };

    vi.mocked(MessageAPI.getReplyFeed).mockResolvedValue({ code: 0, data: { items: [mockItem] } } as any);

    const likeSpy = vi.spyOn(CommentArea.prototype, 'like').mockResolvedValue({ code: 0 } as any);
    const dispatchSpy = vi.spyOn(poller, 'dispatch').mockResolvedValue();

    await poller.poll();

    expect(likeSpy).toHaveBeenCalledWith(777, false);
    dispatchSpy.mockRestore();
    likeSpy.mockRestore();
  });

  it('两阶段分发：第一阶段匹配 command 并自动调用 reply', async () => {
    // 注册测试 command
    commandRegistry.register('testcmd').action(async (_c, args) => {
      return `测试命令执行成功: ${args.text || '无参数'}`;
    });

    const replySpy = vi.fn().mockResolvedValue({ code: 0 });
    const mockSessionCtx: any = {
      sessionType: 'command',
      message: 'testcmd',
      userName: '小明',
      userId: '2001',
      sourceType: 'video',
      reply: replySpy,
    };

    await poller.dispatch(mockSessionCtx);

    expect(replySpy).toHaveBeenCalledWith('测试命令执行成功: 无参数');
  });

  it('两阶段分发：第一阶段未匹配时，第二阶段分发到 DSH 处理', async () => {
    const dshSpy = vi.fn().mockResolvedValue('由 DSH 生成的智能回复');
    poller.setDshHandler(dshSpy);

    const replySpy = vi.fn().mockResolvedValue({ code: 0 });
    const mockSessionCtx: any = {
      sessionType: 'command',
      message: '你好呀，今天天气真好！', // 显然不是已注册的 command
      userName: '普通用户',
      userId: '3001',
      sourceType: 'video',
      reply: replySpy,
    };

    await poller.dispatch(mockSessionCtx);

    expect(dshSpy).toHaveBeenCalledWith(mockSessionCtx);
    expect(replySpy).toHaveBeenCalledWith('由 DSH 生成的智能回复');
  });

  it('轮询去重：相同业务与评论 ID 在多次轮询中只处理一次', async () => {
    await poller.saveConfig({ enableReply: true, enableAt: false, enableWhitelist: false });

    // Mock unreadCount
    vi.spyOn(MessageAPI, 'unreadCount').mockImplementation(() => { throw new Error('unreadCount must not be used'); });

    const mockItem = {
      user: { mid: 5001, nickname: '张三', avatar: '' },
      item: {
        business_id: 1,
        subject_id: 111,
        source_id: 222,
        root_id: 0,
        source_content: '第一次发送',
      },
    };

    // Mock replyFeed 迭代器
    vi.mocked(MessageAPI.getReplyFeed).mockResolvedValue({ code: 0, data: { items: [mockItem] } } as any);

    const dispatchSpy = vi.spyOn(poller, 'dispatch').mockResolvedValue();

    // 第一次轮询
    const res1 = await poller.poll();
    expect(res1.processedCount).toBe(1);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    // 第二次轮询推送相同 item -> 必须被去重忽略
    const res2 = await poller.poll();
    expect(res2.processedCount).toBe(0);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it('白名单过滤：开启白名单时拒绝非白名单用户，仅处理白名单用户', async () => {
    await poller.saveConfig({
      enableReply: true,
      enableAt: false,
      enableWhitelist: true,
      whitelist: [{ mid: 6001, uname: '白名单VIP', face: '' }],
    });

    vi.spyOn(MessageAPI, 'unreadCount').mockImplementation(() => { throw new Error('unreadCount must not be used'); });

    const nonVip = {
      user: { mid: 9999, nickname: '陌生人', avatar: '' },
      item: { business_id: 1, subject_id: 10, source_id: 20, root_id: 0, source_content: 'hi' },
    };
    const vip = {
      user: { mid: 6001, nickname: '白名单VIP', avatar: '' },
      item: { business_id: 1, subject_id: 10, source_id: 21, root_id: 0, source_content: 'hello' },
    };

    vi.mocked(MessageAPI.getReplyFeed).mockResolvedValue({ code: 0, data: { items: [nonVip, vip] } } as any);

    const dispatchSpy = vi.spyOn(poller, 'dispatch').mockResolvedValue();

    const res = await poller.poll();
    expect(res.processedCount).toBe(1); // 只有 VIP 被分发
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  const notification = (id: number, source = id) => ({ id, user: { mid: 7, nickname: 'offline' }, item: { business_id: 1, subject_id: 20, source_id: source, root_id: 0, source_content: 'hello' } });
  it('single page counts all rows without unread gating or cursor pagination; repeated polls deduplicate', async () => {
    await poller.saveConfig({ enableReply: true, enableAt: true, autoLikeOnReply: false, enableWhitelist: false });
    const unread = vi.spyOn(MessageAPI, 'unreadCount').mockImplementation(() => { throw new Error('forbidden'); });
    const generator = vi.spyOn(MessageAPI, 'replyFeed');
    const atGenerator = vi.spyOn(MessageAPI, 'atFeed');
    const replies = Array.from({ length: 23 }, (_, i) => notification(i + 100));
    vi.mocked(MessageAPI.getReplyFeed).mockResolvedValue({ code: 0, data: { items: replies, cursor: { is_end: false, id: 999, time: 123 } } } as any);
    vi.mocked(MessageAPI.getAtFeed).mockResolvedValue({ code: 0, data: { items: [notification(500, 100), notification(100, 900)], cursor: { is_end: false } } } as any);
    const dispatch = vi.spyOn(poller, 'dispatch').mockResolvedValue();
    expect(await poller.poll()).toEqual({ processedCount: 24 });
    expect(await poller.poll()).toEqual({ processedCount: 0 });
    expect(dispatch).toHaveBeenCalledTimes(24);
    for (const feed of [MessageAPI.getReplyFeed, MessageAPI.getAtFeed]) {
      expect(feed).toHaveBeenCalledTimes(2);
      expect(vi.mocked(feed).mock.calls.every(call => call.length === 1)).toBe(true);
    }
    expect(unread).not.toHaveBeenCalled(); expect(generator).not.toHaveBeenCalled(); expect(atGenerator).not.toHaveBeenCalled();
  });
  it.each(['reply', 'at'] as const)('%s failure leaves the other feed operational', async kind => {
    await poller.saveConfig({ enableReply: true, enableAt: true, autoLikeOnReply: false, enableWhitelist: false });
    const failed = kind === 'reply' ? MessageAPI.getReplyFeed : MessageAPI.getAtFeed;
    const other = kind === 'reply' ? MessageAPI.getAtFeed : MessageAPI.getReplyFeed;
    vi.mocked(failed).mockRejectedValue(new Error('offline'));
    vi.mocked(other).mockResolvedValue({ code: 0, data: { items: [notification(700)] } } as any);
    vi.spyOn(poller, 'dispatch').mockResolvedValue();
    expect(await poller.poll()).toEqual({ processedCount: 1 });
  });
  it('non-comment notifications without valid source are skipped', async () => {
    await poller.saveConfig({ enableReply: true, enableAt: true, autoLikeOnReply: false, enableWhitelist: false });
    vi.mocked(MessageAPI.getAtFeed).mockResolvedValue({ code: 0, data: { items: [notification(800, 0), { ...notification(801), item: { subject_id: 20 } }] } } as any);
    const dispatch = vi.spyOn(poller, 'dispatch').mockResolvedValue();
    expect(await poller.poll()).toEqual({ processedCount: 0 }); expect(dispatch).not.toHaveBeenCalled();
  });

  it('persists keys before side effects and skips the same feed after rebuilding the poller', async () => {
    await poller.saveConfig({ enableReply: true, enableAt: false, autoLikeOnReply: true, enableWhitelist: false });
    vi.mocked(MessageAPI.getReplyFeed).mockResolvedValue({ code: 0, data: { items: [notification(910)] } } as any);
    const file = testConfigFile + '.processed.json';
    const rename = vi.spyOn(fs, 'rename');
    const dispatch = vi.spyOn(poller, 'dispatch').mockImplementation(async () => {
      expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(['notification:reply:910', '1_20_910']);
    });
    expect(await poller.poll()).toEqual({ processedCount: 1 });
    expect(rename).toHaveBeenCalledWith(file + '.tmp', file);
    expect(rename.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(CommentArea.prototype.like).mock.invocationCallOrder[0]);
    expect(rename.mock.invocationCallOrder[0]).toBeLessThan(dispatch.mock.invocationCallOrder[0]);
    expect(dispatch).toHaveBeenCalledTimes(1);
    vi.mocked(CommentArea.prototype.like).mockClear();
    poller.stop(); (PollerService as any).instance = null;
    poller = PollerService.getInstance(manager);
    await poller.loadConfig();
    const restartedDispatch = vi.spyOn(poller, 'dispatch').mockResolvedValue();
    expect(await poller.poll()).toEqual({ processedCount: 0 });
    expect(restartedDispatch).not.toHaveBeenCalled(); expect(CommentArea.prototype.like).not.toHaveBeenCalled();
    // A different notification ID for the same comment also stays deduplicated from disk.
    vi.mocked(MessageAPI.getReplyFeed).mockResolvedValue({ code: 0, data: { items: [notification(911, 910)] } } as any);
    expect(await poller.poll()).toEqual({ processedCount: 0 });
    expect(restartedDispatch).not.toHaveBeenCalled();
  });
  it.each(['write', 'rename'] as const)('persistent %s failure prevents both like and dispatch', async failure => {
    await poller.saveConfig({ enableReply: true, enableAt: false, autoLikeOnReply: true, enableWhitelist: false });
    vi.mocked(MessageAPI.getReplyFeed).mockResolvedValue({ code: 0, data: { items: [notification(920)] } } as any);
    const file = testConfigFile + '.processed.json';
    if (failure === 'write') {
      const original = fs.writeFile.bind(fs);
      vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
        if (args[0] === file + '.tmp') throw new Error('offline simulated disk write failure');
        return original(...args);
      });
    } else vi.spyOn(fs, 'rename').mockRejectedValue(new Error('offline simulated rename failure'));
    const dispatch = vi.spyOn(poller, 'dispatch').mockResolvedValue();
    expect(await poller.poll()).toEqual({ processedCount: 0 });
    expect(dispatch).not.toHaveBeenCalled(); expect(CommentArea.prototype.like).not.toHaveBeenCalled();
    await expect(fs.access(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('slow model does not block another content or future polls, while one content remains ordered', async () => {
    await poller.saveConfig({ autoLikeOnReply: false });
    const first = deferred<string>(), started = deferred(), otherStarted = deferred();
    const order: string[] = [];
    vi.spyOn(CommentArea.prototype, 'add').mockResolvedValue({ code: 0 } as any);
    poller.setDshHandler(async ctx => {
      order.push(String(ctx.sourceId));
      if (ctx.sourceId === 1000) { started.resolve(); return first.promise; }
      if (ctx.sourceId === 1002) otherStarted.resolve();
      return 'done';
    });
    const other = notification(1002); other.item.subject_id = 21;
    vi.mocked(MessageAPI.getReplyFeed).mockResolvedValue({ code: 0, data: { items: [notification(1000), notification(1001), other] } } as any);
    expect(await poller.poll()).toEqual({ processedCount: 3 });
    await Promise.all([started.promise, otherStarted.promise]);
    expect(order).toEqual(['1000', '1002']);
    expect(await poller.poll()).toEqual({ processedCount: 0 });
    first.resolve('first done');
    await poller.waitForDispatches();
    expect(order).toEqual(['1000', '1002', '1001']);
    expect(CommentArea.prototype.add).toHaveBeenCalledWith('first done', 1000, 1000);
    expect(CommentArea.prototype.add).toHaveBeenCalledWith('done', 1001, 1001);
  });

  it('stop cancels waiting tasks and rejects late model output without retry or public reply', async () => {
    await poller.saveConfig({ autoLikeOnReply: false });
    const result = deferred<string>(), started = deferred();
    const add = vi.spyOn(CommentArea.prototype, 'add').mockResolvedValue({ code: 0 } as any);
    const handler = vi.fn(async () => { started.resolve(); return result.promise; });
    poller.setDshHandler(handler);
    vi.mocked(MessageAPI.getReplyFeed).mockResolvedValue({ code: 0, data: { items: [notification(1010), notification(1011)] } } as any);
    expect(await poller.poll()).toEqual({ processedCount: 2 }); await started.promise;
    poller.stop(); await poller.waitForDispatches();
    result.resolve('late output'); await result.promise;
    await Promise.resolve(); await Promise.resolve();
    expect(add).not.toHaveBeenCalled(); expect(handler).toHaveBeenCalledTimes(1);
    expect(poller.getRecentMessages()[0].status).toBe('failed');
  });

  it('stop fences notifications from an in-flight feed response', async () => {
    const feed = deferred<any>();
    vi.mocked(MessageAPI.getReplyFeed).mockReturnValue(feed.promise);
    const dispatch = vi.spyOn(poller, 'dispatch').mockResolvedValue();
    const run = poller.poll();
    poller.stop();
    feed.resolve({ code: 0, data: { items: [notification(1020)] } });
    expect(await run).toEqual({ processedCount: 0 });
    expect(dispatch).not.toHaveBeenCalled(); expect(CommentArea.prototype.like).not.toHaveBeenCalled();
  });

  it('malformed rows do not discard later valid notifications', async () => {
    await poller.saveConfig({ autoLikeOnReply: false });
    vi.mocked(MessageAPI.getReplyFeed).mockResolvedValue({ code: 0, data: { items: [null, {}, notification(1021)] } } as any);
    const dispatch = vi.spyOn(poller, 'dispatch').mockResolvedValue();
    expect(await poller.poll()).toEqual({ processedCount: 1 });
    await poller.waitForDispatches(); expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('handler explicit reply plus return text produces only one outbound write', async () => {
    const c = poller.buildSessionContext('reply', notification(1030));
    const reply = vi.fn().mockResolvedValue({ code: 0 }); c.reply = reply;
    poller.setDshHandler(async ctx => { await ctx.messageFunc('explicit'); return 'returned'; });
    await poller.dispatch(c);
    expect(reply).toHaveBeenCalledExactlyOnceWith('explicit');
  });

  it('ambiguous outbound failure does not rerun the model or send a safe-message duplicate', async () => {
    const c = poller.buildSessionContext('reply', notification(1040));
    const reply = vi.fn().mockRejectedValue(new Error('transport failed after request')); c.reply = reply;
    const handler = vi.fn().mockResolvedValue('reply'); poller.setDshHandler(handler);
    await expect(poller.dispatch(c)).rejects.toThrow('transport failed');
    expect(handler).toHaveBeenCalledTimes(1); expect(reply).toHaveBeenCalledTimes(1);
    expect(poller.getRecentMessages()[0].status).toBe('failed');
  });

  it('missing handler records a failed recent message', async () => {
    const c = poller.buildSessionContext('reply', notification(1041));
    await expect(poller.dispatch(c)).rejects.toThrow('DSH Agent 服务不可用');
    expect(poller.getRecentMessages()[0].status).toBe('failed');
  });

  it('corrupt dedup journal fails closed before reading feeds or side effects', async () => {
    await fs.writeFile(testConfigFile + '.processed.json', '{broken');
    const dispatch = vi.spyOn(poller, 'dispatch').mockResolvedValue();
    expect(await poller.poll()).toEqual({ processedCount: 0 });
    expect(MessageAPI.getReplyFeed).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
  });

  it('journal capacity remains 2000 keys after restart and commit', async () => {
    const old = Array.from({ length: 2000 }, (_, index) => 'old:' + index);
    await fs.writeFile(testConfigFile + '.processed.json', JSON.stringify(old));
    vi.mocked(MessageAPI.getReplyFeed).mockResolvedValue({ code: 0, data: { items: [notification(1050)] } } as any);
    vi.spyOn(poller, 'dispatch').mockResolvedValue();
    await poller.poll();
    const saved = JSON.parse(await fs.readFile(testConfigFile + '.processed.json', 'utf8'));
    expect(saved).toHaveLength(2000); expect(saved[0]).toBe('old:2');
    expect(saved.slice(-2)).toEqual(['notification:reply:1050', '1_20_1050']);
  });

  it('工作区发现与解析：支持配置指定工作区或回退到默认目录', async () => {
    // 1. 无指定配置时
    const defaultCwd = await poller.resolveTargetWorkspaceCwd();
    expect(typeof defaultCwd).toBe('string');
    expect(defaultCwd.length).toBeGreaterThan(0);

    // 2. 指定有效工作区路径
    await poller.saveConfig({ targetWorkspacePath: tempDir });
    const targetCwd = await poller.resolveTargetWorkspaceCwd();
    expect(path.resolve(targetCwd).toLowerCase()).toBe(path.resolve(tempDir).toLowerCase());
  });
});

describe('bounded background dispatch queue', () => {
  afterEach(() => vi.useRealTimers());
  it('rejects overflow, handles rejection, and drains without an unhandled promise', async () => {
    const error = vi.fn(), queue = new DispatchQueue(error, 2);
    const first = deferred();
    expect(queue.enqueue('one', () => first.promise)).toBe(true);
    expect(queue.enqueue('two', async () => { throw new Error('offline'); })).toBe(true);
    expect(queue.enqueue('three', async () => {})).toBe(false);
    first.resolve(); await queue.whenIdle();
    expect(error).toHaveBeenCalledTimes(1); expect(queue.hasCapacity).toBe(true);
  });
  it('timeout cancels pending and active work but retains the active lane until it really settles', async () => {
    vi.useFakeTimers();
    const queue = new DispatchQueue(vi.fn(), 3, 1000), result = deferred();
    const signals: AbortSignal[] = [], next = vi.fn(async () => {});
    queue.enqueue('one', async signal => { signals.push(signal); await result.promise; });
    queue.enqueue('one', next);
    await vi.advanceTimersByTimeAsync(1000);
    await queue.whenIdle();
    expect(signals[0].aborted).toBe(true); expect(next).not.toHaveBeenCalled();
    queue.enqueue('one', next);
    await Promise.resolve(); expect(next).not.toHaveBeenCalled();
    result.resolve(); await queue.whenIdle();
    expect(next).toHaveBeenCalledTimes(1);
    queue.stop();
  });
});