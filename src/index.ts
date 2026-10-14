import { readFileSync } from 'node:fs';
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { BilibiliClientManager } from './client-manager.js';
import { registerBilibiliTools } from './tools.js';
import { PollerService } from './poller-service.js';
import { BilibiliAgentBridge } from './agent-bridge.js';
import { getLogger, setLoggerContext } from './command/logger.js';
import { registerBilibiliRoutes } from './http/routes.js';
import type { HttpManager, HttpPoller, HttpLlmService } from './http/contracts.js';

export * from './types.js';
export * from './vault-service.js';
export * from './client-manager.js';
export * from './poller-service.js';
export * from './agent-bridge.js';
export * from './command/index.js';

export const name = 'dsh-bilibili-plugin';
export const inject = ['tools', 'webServer', 'agents', 'systemPrompt', 'workspaceRegistry'];

export interface Config { enabled?: boolean }
export const Config = z.object({
  enabled: z.boolean().default(true).description('是否启用 Bilibili 插件功能'),
});

/** Explicit service seam for offline lifecycle tests; production still uses the same singletons. */
export interface PluginServices {
  manager: HttpManager & Pick<BilibiliClientManager, 'initOnStartup' | 'isUnlocked'>;
  poller: HttpPoller & Pick<PollerService, 'claimRuntime' | 'start' | 'stop' | 'loadConfig' | 'setWorkspaceRegistry' | 'setDshHandler'>;
  createBridge(): Pick<BilibiliAgentBridge, 'handleInbound' | 'dispose'>;
  registerTools(): () => void;
}
function createServices(ctx: Context): PluginServices {
  const manager = BilibiliClientManager.getInstance();
  return {
    manager,
    poller: PollerService.getInstance(manager),
    createBridge: () => new BilibiliAgentBridge(ctx),
    registerTools: () => registerBilibiliTools(ctx.tools, manager),
  };
}

interface SkillsContext {
  skills: { register(skill: {
    name: string; description: string; content: string; source: 'runtime';
    invocation: { modelInvocable: boolean; userInvocable: boolean };
  }): unknown };
  effect(callback: () => (() => void), label?: string): unknown;
}

export function apply(
  ctx: Context,
  config: Config = { enabled: true },
  servicesFactory: (ctx: Context) => PluginServices = createServices,
): void {
  if (config.enabled === false) return;
  const releases: Array<() => void> = [];
  let disposed = false;
  let generation = 0;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    generation++;
    for (const release of releases.splice(0).reverse()) {
      try { release(); } catch { /* A failing disposer must not leak the remaining resources. */ }
    }
  };
  // Own teardown before creating services or registering anything that can throw.
  ctx.effect(() => cleanup, 'bilibili: lifecycle');
  try {
    releases.push(setLoggerContext(ctx));
    const logger = getLogger('dsh-bilibili-plugin');
    const { manager, poller, createBridge, registerTools } = servicesFactory(ctx);
    let runtime: symbol | undefined = poller.claimRuntime();
    releases.push(() => { if (runtime) poller.stop(runtime); });
    releases.push(poller.setWorkspaceRegistry(ctx.get('workspaceRegistry')));
    const bridge = createBridge();
    releases.push(() => bridge.dispose());
    releases.push(poller.setDshHandler(async sessionCtx => {
      if (!disposed) await bridge.handleInbound(sessionCtx);
    }));
    releases.push(registerTools());

    let configReady = false;
    let loginReady: number | undefined;
    const startPolling = () => {
      if (disposed || !manager.isUnlocked || !configReady) return;
      runtime ??= poller.claimRuntime();
      poller.start(runtime);
    };
    releases.push(registerBilibiliRoutes({
      webServer: ctx.webServer, manager, poller,
      getLlm: () => ctx.get('llm') as HttpLlmService | undefined,
      beginLogin: () => {
        const loginGeneration = ++generation;
        return () => {
          if (disposed || generation !== loginGeneration) return;
          loginReady = loginGeneration;
          startPolling();
        };
      },
      stopPolling: () => {
        generation++;
        loginReady = undefined;
        if (runtime) poller.stop(runtime);
        runtime = undefined;
      },
    }));

    // The optional skill belongs to its injection scope; a returned disposer is retained explicitly.
    ctx.inject(['skills'], (skillCtx: SkillsContext) => {
      if (disposed) return;
      const markdown = readFileSync(new URL('../skills/bilibili-comment-context/SKILL.md', import.meta.url), 'utf8');
      const release = skillCtx.skills.register({
        name: 'bilibili-comment-context',
        description: '解析 B站结构化评论：视频/动态来源、评论区ID、根/父评论、发送者与当前评论图片。来源字段仅首次出现，后续 B站评论消息也适用。',
        content: markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim(),
        source: 'runtime', invocation: { modelInvocable: true, userInvocable: true },
      });
      if (typeof release === 'function') {
        let released = false;
        const once = () => { if (!released) { released = true; release(); } };
        releases.push(once);
        skillCtx.effect(() => once, 'bilibili: skill');
      }
    });

    // Do not launch initialization until synchronous registration has completely succeeded.
    const startupGeneration = generation;
    void Promise.resolve().then(async () => {
      if (disposed) return;
      await manager.initOnStartup();
      if (disposed) return;
      await poller.loadConfig();
      if (disposed) return;
      configReady = true;
      if (generation === startupGeneration || loginReady === generation) startPolling();
    }).catch(error => {
      if (!disposed) {
        logger.error('启动初始化失败:', error);
        cleanup();
      }
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}
