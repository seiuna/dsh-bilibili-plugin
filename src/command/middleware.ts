import { commandRegistry, CommandRegistry } from './dispatcher.js';
import type { CmdResult, CommandSessionContext } from './types.js';
import { getLogger } from './logger.js';

const logger = getLogger('CommandDispatcherMiddleware');

function isCmdResult(v: unknown): v is CmdResult {
  return typeof v === 'object' && v !== null && 'ok' in v && 'message' in v;
}

export type NextMiddleware = () => Promise<void>;

/**
 * Command Dispatcher Middleware factory
 * Handles command messages before they reach the rest of the pipeline.
 */
export function createCommandDispatcherMiddleware(
  registry: CommandRegistry = commandRegistry,
) {
  return async (
    ctx: CommandSessionContext,
    next: NextMiddleware,
  ): Promise<void> => {
    // If sessionType is specified and not "command", pass through
    if (ctx.sessionType && ctx.sessionType !== 'command') {
      await next();
      return;
    }

    try {
      const event = ctx.event;
      const cmdName = event?.command;
      const rawArgs = event?.args || [];

      if (!cmdName) {
        if (ctx.message) {
          await ctx.message('请输入有效命令。输入 /help 查看可用命令。');
        }
        return;
      }

      if (cmdName.toLowerCase() === 'help') {
        const userId = event?.userId ?? ctx.userId;
        if (ctx.message) {
          await ctx.message(await registry.generateHelpMenu(userId));
        }
        return;
      }

      const inputString = [cmdName, ...rawArgs].join(' ');
      const result = await registry.execute(inputString, ctx);
      if (typeof result === 'string') {
        if (ctx.message) await ctx.message(result);
      } else if (isCmdResult(result)) {
        if (ctx.message) await ctx.message(result.message);
      }
    } catch (error: any) {
      logger.error(`Command dispatcher error: ${error?.message || error}`);
      if (ctx.message) {
        await ctx.message('系统执行命令时遇到错误，请稍后再试。');
      }
    }
  };
}

export const CommandDispatcherMiddleware = createCommandDispatcherMiddleware();
