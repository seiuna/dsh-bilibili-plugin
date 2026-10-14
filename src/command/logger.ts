import type { Context } from '@deepseek-ai/cordis';

export interface Logger {
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
  debug?(...args: any[]): void;
}

type CordisLogger = {
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
  debug?(...args: any[]): void;
};

const contexts: Array<{ token: symbol; ctx: Context }> = [];

export function setLoggerContext(ctx: Context | null): () => void {
  if (ctx === null) {
    contexts.length = 0;
    return () => {};
  }
  const entry = { token: Symbol('bilibili-logger-context'), ctx };
  contexts.push(entry);
  return () => {
    const index = contexts.findIndex(item => item.token === entry.token);
    if (index >= 0) contexts.splice(index, 1);
  };
}

export function getLoggerContext(): Context | null {
  return contexts.at(-1)?.ctx ?? null;
}

function getDshLogger(name: string): CordisLogger | undefined {
  const activeContext = getLoggerContext();
  if (!activeContext) return undefined;
  try {
    const loggerService = activeContext.logger ?? (activeContext as any).get?.('logger');
    if (typeof loggerService === 'function') {
      return loggerService(name);
    }
  } catch {
    // fallback to console
  }
  return undefined;
}

export function getLogger(name: string): Logger {
  return {
    info: (...args: any[]) => {
      const dshLogger = getDshLogger(name);
      if (dshLogger) {
        dshLogger.info(...args);
      } else {
        console.log(`[${name}]`, ...args);
      }
    },
    warn: (...args: any[]) => {
      const dshLogger = getDshLogger(name);
      if (dshLogger) {
        dshLogger.warn(...args);
      } else {
        console.warn(`[${name}]`, ...args);
      }
    },
    error: (...args: any[]) => {
      const dshLogger = getDshLogger(name);
      if (dshLogger) {
        dshLogger.error(...args);
      } else {
        console.error(`[${name}]`, ...args);
      }
    },
    debug: (...args: any[]) => {
      const dshLogger = getDshLogger(name);
      if (dshLogger) {
        dshLogger.debug?.(...args);
      } else {
        console.debug?.(`[${name}]`, ...args);
      }
    },
  };
}
