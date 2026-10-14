import { expect, it, vi } from 'vitest';
import { BiliClient } from '@seiuna/bilibili-api';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PollerService } from '../src/poller-service.js';
import { BilibiliAgentBridge } from '../src/agent-bridge.js';

// Opt-in integration preview: real Bili reads + production poll/dispatch/bridge,
// mock only DSH services and platform writes. No real model or DSH session.
it.skipIf(process.env.BILI_STATIC_TEST !== '1')('static-test：轮询到模拟 DSH followup 全流程', async () => {
  const rounds = Number(process.env.BILI_TEST_ROUNDS || 6);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 60) throw new Error('BILI_TEST_ROUNDS 必须为 1–60');
  const trace = (stage: string, data?: unknown) => console.log(`[${new Date().toISOString()}] ${stage}`, data ?? '');
  const temp = await mkdtemp(path.join(os.tmpdir(), 'bili-poll-preview-'));
  vi.stubEnv('BILIBILI_PROMPT_PATH', path.join(temp, 'persona.md'));
  vi.stubEnv('BILIBILI_POLLER_CONFIG_PATH', path.join(temp, 'config.json'));
  let bridge: BilibiliAgentBridge | undefined;
  const listeners = new Map<string, Function>();
  const agents = new Map<string, any>();
  let captured = 0;
  const previews: any[] = [];
  try {
    trace('01 加载 Bilibili profile static-test（不打印凭据）');
    const client = await BiliClient.create('static-test');
    if (!client.userId) throw new Error('static-test 未登录；测试不会启动登录');
    (PollerService as any).instance = null;
    const poller = PollerService.getInstance({ getClient: () => client, isUnlocked: true } as any);
    await poller.saveConfig({ enableReply: true, enableAt: true, enableWhitelist: false, autoLikeOnReply: true, targetWorkspacePath: temp });
    await poller.initPromptFile();
    trace('02 测试配置', { workspace: temp, whitelist: false, intervalSeconds: 10, rounds, persona: '临时默认人设；不读取生产配置' });
    const registry = { archivedSessionIds: [] as string[], create: async (cwd: string) => ({ attachSession: async (id: string) => trace('08 模拟工作区关联', { cwd, sessionId: id }) }), list: () => [] };
    poller.setWorkspaceRegistry(registry);
    const service = {
      get: (id: string) => { trace('06 查找模拟 Agent', { sessionId: id, found: agents.has(id) }); return agents.get(id); },
      resume: async () => { trace('07 模拟恢复：无持久化历史'); throw new Error('preview: no stored session'); },
      create: async (options: any) => {
        trace('07 创建模拟 session', { sessionId: options.sessionId, cwd: options.meta.cwd, model: options.agentOptions });
        const sections: any[] = []; const variables: Record<string, Function> = {};
        const agent: any = { session: { header: { id: options.sessionId, cwd: options.meta.cwd } } };
        agent.ctx = { agent, systemPrompt: { section: (s: any) => sections.push(s), variable: (name: string, fn: Function) => { variables[name] = fn; } } };
        agent.followup = (message: any) => {
          captured++; previews.push(message);
          trace('10 DSH followup 截获：未调用模型', { sessionId: options.sessionId, messageId: message.id });
          trace('系统人设段（不代表完整宿主系统提示词）', sections.map(s => s.text.replace(/\{\{([^}]+)\}\}/g, (_: string, key: string) => variables[key]?.() ?? '')));
          console.log('========== DSH 用户 prompt ==========\n' + message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') + '\n========== END ==========');
          listeners.get('session/event')?.(agent.session, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
        };
        await options.setup(agent.ctx); agents.set(options.sessionId, agent);
        return { agent, dispose: async () => {} };
      },
    };
    bridge = new BilibiliAgentBridge({
      on: (name: string, fn: Function) => { listeners.set(name, fn); return () => listeners.delete(name); },
      get: (name: string) => name === 'agents' ? service : name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'preview', model: 'no-model-call' }) } : undefined,
    } as any);
    // Keep actual getOrCreate, identity, queues and processInbound. Do not download
    // or persist attachments; production fallback prints the exact image URLs.
    vi.spyOn(bridge as any, 'downloadAndCreateImageBlock').mockImplementation(async (...args: any[]) => { trace('09 评论图片 URL（跳过下载）', args[0]); return null; });
    const build = poller.buildSessionContext.bind(poller);
    vi.spyOn(poller, 'buildSessionContext').mockImplementation((kind, raw) => {
      const c = build(kind, raw);
      trace('04 通知转 SessionContext', { kind, userId: c.userId, subjectId: c.subjectId, sourceId: c.sourceId, message: c.message });
      c.like = async () => { trace('05 拦截自动点赞：未发送'); };
      c.reply = c.messageFunc = async text => { trace('拦截评论回复：未发送', text); };
      return c;
    });
    for (const method of ['hydrateCommentImages', 'hydrateSourceContext'] as const) {
      const original = poller[method].bind(poller);
      vi.spyOn(poller, method).mockImplementation(async c => { trace(`05 ${method} 开始`); await original(c); trace(`05 ${method} 完成`, { images: c.images, title: c.actualVideoTitle, dynamic: c.dynamicBodyExcerpt, root: c.rootComment, bot: c.botRepliedComment }); });
    }
    poller.setDshHandler(async c => { trace('06 Command 未处理，进入模拟 DSH'); await bridge!.handleInbound(c); });
    for (let round = 1; round <= rounds; round++) {
      trace('03 轮询开始', { round, note: '每类 feed 只取一页；无未读门控、不翻页，保留双层去重' });
      trace('03 轮询结束', await poller.poll());
      const tasks = [...((bridge as any).queues as Map<string, Promise<void>>).values()];
      await Promise.allSettled(tasks);
      if (round < rounds) await new Promise(resolve => setTimeout(resolve, 10000));
    }
    trace('11 测试结束', { capturedPrompts: captured, mockSessions: agents.size });
    if (!captured) throw new Error('轮询期间未截获 prompt：可能本页无新评论通知或输入在前置阶段被过滤；不视为全链路通过');
    for (const message of previews) { expect(message.role).toBe('user'); expect(message.id).toBeTruthy(); }
  } finally {
    bridge?.dispose(); vi.restoreAllMocks(); vi.unstubAllEnvs();
    (PollerService as any).instance = null;
    await rm(temp, { recursive: true, force: true });
  }
}, 900000);
