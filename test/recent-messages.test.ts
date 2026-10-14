import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PollerService } from '../src/poller-service.js';
import { BilibiliClientManager } from '../src/client-manager.js';
import { commandRegistry, Command } from '../src/command/index.js';

describe('Recent Messages Tracking (最近处理消息跟踪与存储)', () => {
  const tempDir = path.join(os.tmpdir(), `dsh-bili-recent-test-${Date.now()}`);
  const testConfigFile = path.join(tempDir, 'poller-config.json');

  let poller: PollerService;
  let manager: BilibiliClientManager;

  beforeEach(async () => {
    process.env.BILIBILI_POLLER_CONFIG_PATH = testConfigFile;
    process.env.BILIBILI_PROMPT_PATH = path.join(tempDir, 'test-prompt.md');
    await fs.mkdir(tempDir, { recursive: true });

    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('offline tests prohibit network'); }));
    manager = { getClient: () => ({}), isUnlocked: true } as any;
    (PollerService as any).instance = null;
    poller = PollerService.getInstance(manager);
    await poller.loadConfig();
    poller.clearRecentMessages();
    poller.stop();

    vi.spyOn(poller, 'hydrateCommentImages').mockResolvedValue();
    vi.spyOn(poller, 'hydrateSourceContext').mockResolvedValue();
  });

  afterEach(async () => {
    poller.stop();
    await poller.waitForDispatches();
    await poller.flushRecentMessages();
    vi.unstubAllGlobals();
    delete process.env.BILIBILI_POLLER_CONFIG_PATH;
    delete process.env.BILIBILI_PROMPT_PATH;
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    vi.restoreAllMocks();
  });

  it('初始状态下最近消息列表为空', () => {
    expect(poller.getRecentMessages()).toEqual([]);
  });

  it('正常 dispatch 触发后记录为 processing，并在 reply 执行后更新为 replied', async () => {
    let capturedReplyText = '';
    const fakeContext: any = {
      sourceType: 'video',
      sourceId: '1001',
      subjectId: '2001',
      businessId: 1,
      actualVideoTitle: '测试猫咪视频',
      title: '测试猫咪视频',
      uri: 'https://www.bilibili.com/video/BV1test',
      userId: '12345',
      userName: 'bili_user_1',
      userAvatar: 'https://example.com/avatar.jpg',
      message: '请总结视频核心内容',
      reply: vi.fn(async (text: string) => {
        capturedReplyText = text;
      }),
    };

    poller.setDshHandler(async (ctx) => {
      await ctx.reply('这是 AI 生成的总结');
    });

    await poller.dispatch(fakeContext);

    const list = poller.getRecentMessages();
    expect(list.length).toBe(1);
    const item = list[0];
    expect(item.id).toBe('1_2001_1001');
    expect(item.message).toBe('请总结视频核心内容');
    expect(item.sourceTitle).toBe('测试猫咪视频');
    expect(item.user.uname).toBe('bili_user_1');
    expect(item.status).toBe('replied');
    expect(item.replyText).toBe('这是 AI 生成的总结');
    expect(capturedReplyText).toBe('这是 AI 生成的总结');
  });

  it('指令触发并回复后，状态记录为 command_replied', async () => {
    const pingCmd = commandRegistry.register('testping');
    pingCmd.action(async () => 'pong 响应成功');

    const replySpy = vi.fn(async () => {});
    const fakeContext: any = {
      sourceType: 'video',
      sourceId: '1002',
      subjectId: '2002',
      businessId: 1,
      userId: '12346',
      userName: '指令用户',
      message: '/testping',
      reply: replySpy,
    };

    await poller.dispatch(fakeContext);

    const list = poller.getRecentMessages();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('1_2002_1002');
    expect(list[0].status).toBe('replied');
    expect(list[0].replyText).toBe('pong 响应成功');
    expect(replySpy).toHaveBeenCalledWith('pong 响应成功');
  });

  it('支持清空记录', () => {
    poller.addRecentMessage({
      id: 'test_1',
      time: Date.now(),
      sourceType: 'video',
      user: { mid: '1', uname: 'u1' },
      message: 'm1',
      status: 'replied',
    });
    expect(poller.getRecentMessages().length).toBe(1);

    poller.clearRecentMessages();
    expect(poller.getRecentMessages().length).toBe(0);
  });

  it('具有容量上限 (30条) 自动淘汰最旧的消息', () => {
    for (let i = 1; i <= 35; i++) {
      poller.addRecentMessage({
        id: `msg_${i}`,
        time: Date.now() + i,
        sourceType: 'video',
        user: { mid: String(i), uname: `user${i}` },
        message: `hello ${i}`,
        status: 'replied',
      });
    }

    const list = poller.getRecentMessages();
    expect(list.length).toBe(30);
    // 最新加入的 msg_35 在最前面
    expect(list[0].id).toBe('msg_35');
    // 最旧的 msg_1 ~ msg_5 已被移出
    expect(list.find((m) => m.id === 'msg_1')).toBeUndefined();
    expect(list.find((m) => m.id === 'msg_5')).toBeUndefined();
    expect(list.find((m) => m.id === 'msg_6')).toBeDefined();
  });

  it('实例重启后可以持久化恢复最近处理消息', async () => {
    poller.clearRecentMessages();
    poller.addRecentMessage({
      id: 'durable_1',
      time: 1700000000000,
      sourceType: 'dynamic',
      sourceTitle: '持久化动态',
      user: { mid: '999', uname: 'durable_user' },
      message: '持久化测试文本',
      status: 'replied',
      replyText: '已回复持久化',
    });

    // Deterministic serial persistence; no arbitrary sleeps or cross-test writes.
    await poller.flushRecentMessages();

    // 重新实例化 PollerService
    (PollerService as any).instance = null;
    const restoredPoller = PollerService.getInstance(manager);
    // 模拟 poll 启动或者恢复加载
    await (restoredPoller as any).loadProcessed();

    const list = restoredPoller.getRecentMessages();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('durable_1');
    expect(list[0].message).toBe('持久化测试文本');
    expect(list[0].replyText).toBe('已回复持久化');
  });

  it('串行持久化并发更新与清空，不产生共享tmp覆盖或旧数据复活', async () => {
    for (let i = 0; i < 35; i++) poller.addRecentMessage({ id: String(i), time: i,
      sourceType: 'video', user: { mid: '7', uname: '测试昵称也是真实用户' }, message: 'm', status: 'processing' });
    poller.updateRecentMessage('34', { status: 'replied', replyText: 'done' });
    await poller.flushRecentMessages();
    const disk = JSON.parse(await fs.readFile(testConfigFile + '.recent.json', 'utf8'));
    expect(disk).toHaveLength(30); expect(disk[0].status).toBe('replied');
    expect(poller.getRecentMessages()).toHaveLength(30);
    poller.clearRecentMessages(); await poller.flushRecentMessages();
    expect(JSON.parse(await fs.readFile(testConfigFile + '.recent.json', 'utf8'))).toEqual([]);
  });

  it('最近消息保存失败不会产生未处理拒绝，下一次写入可以恢复', async () => {
    await poller.flushRecentMessages();
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk offline'));
    poller.addRecentMessage({ id: 'recover', time: 1, sourceType: 'video', user: { mid: '1', uname: 'u' }, message: 'm', status: 'processing' });
    await poller.flushRecentMessages();
    expect(poller.getRecentMessages()).toHaveLength(1);
    poller.updateRecentMessage('recover', { status: 'replied' }); await poller.flushRecentMessages();
    expect(rename).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await fs.readFile(testConfigFile + '.recent.json', 'utf8'))[0].status).toBe('replied');
  });

  it.each(['broken JSON', 'invalid rows'] as const)('恢复%s不污染最近消息类型', async mode => {
    await poller.flushRecentMessages();
    await fs.writeFile(testConfigFile + '.recent.json', mode === 'broken JSON' ? '{broken' : JSON.stringify([null, 3, { id: 'invalid', user: null }]));
    (PollerService as any).instance = null; poller = PollerService.getInstance(manager);
    await (poller as any).loadProcessed();
    expect(poller.getRecentMessages()).toEqual([]);
  });

  it('返回历史深拷贝，调用方不能修改内部状态', () => {
    poller.addRecentMessage({ id: 'copy', time: 1, sourceType: 'video', user: { mid: '1', uname: 'u' }, message: 'm', status: 'processing' });
    const list = poller.getRecentMessages(); list[0].user.uname = 'mutated'; list[0].status = 'replied';
    expect(poller.getRecentMessages()[0].user.uname).toBe('u');
    expect(poller.getRecentMessages()[0].status).toBe('processing');
  });
});
