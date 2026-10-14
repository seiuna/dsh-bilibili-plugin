import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getLogger, setLoggerContext, getLoggerContext } from '../src/command/logger.js';

describe('Logger (对接 DSH / Cordis 日志输出)', () => {
  beforeEach(() => {
    setLoggerContext(null);
  });

  afterEach(() => {
    setLoggerContext(null);
    vi.restoreAllMocks();
  });

  it('未注入 DSH Context 时，平滑回退到控制台输出', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const logger = getLogger('FallbackTest');
    logger.info('这是一条普通日志', 123);
    logger.warn('这是一条警告');
    logger.error('这是一条错误', new Error('test'));
    logger.debug?.('这是一条调试日志');

    expect(logSpy).toHaveBeenCalledWith('[FallbackTest]', '这是一条普通日志', 123);
    expect(warnSpy).toHaveBeenCalledWith('[FallbackTest]', '这是一条警告');
    expect(errorSpy).toHaveBeenCalledWith('[FallbackTest]', '这是一条错误', expect.any(Error));
    expect(debugSpy).toHaveBeenCalledWith('[FallbackTest]', '这是一条调试日志');
  });

  it('注入 DSH Context 后，所有级别日志直接由 DSH 的 ctx.logger(name) 接管', () => {
    const exportedMessages: any[] = [];
    const mockLoggerInstance = {
      info: (...args: any[]) => exportedMessages.push({ type: 'info', args }),
      warn: (...args: any[]) => exportedMessages.push({ type: 'warn', args }),
      error: (...args: any[]) => exportedMessages.push({ type: 'error', args }),
      debug: (...args: any[]) => exportedMessages.push({ type: 'debug', args }),
    };

    const mockCtx: any = {
      logger: vi.fn((_name: string) => mockLoggerInstance),
    };

    setLoggerContext(mockCtx);
    expect(getLoggerContext()).toBe(mockCtx);

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = getLogger('BiliPollerService');
    logger.info('收到来自 B站的通知: %s', 'BV1xx411c7mD');
    logger.error('网络请求失败', 'code 500');

    // 验证由 DSH 结构化日志 exporter 接收，而不是由裸 console 处理
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(mockCtx.logger).toHaveBeenCalledWith('BiliPollerService');

    expect(exportedMessages.length).toBe(2);
    expect(exportedMessages[0]).toEqual({
      type: 'info',
      args: ['收到来自 B站的通知: %s', 'BV1xx411c7mD'],
    });
    expect(exportedMessages[1]).toEqual({
      type: 'error',
      args: ['网络请求失败', 'code 500'],
    });
  });

  it('销毁注销 Context 后，恢复为回退状态', () => {
    const mockCtx: any = {
      logger: vi.fn(() => ({
        info: vi.fn(),
      })),
    };
    setLoggerContext(mockCtx);
    setLoggerContext(null);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = getLogger('ResetTest');
    logger.info('恢复后的日志');

    expect(logSpy).toHaveBeenCalledWith('[ResetTest]', '恢复后的日志');
  });

  it('旧实例释放不会清除新实例的日志上下文', () => {
    const first: any = { logger: vi.fn() };
    const second: any = { logger: vi.fn() };
    const releaseFirst = setLoggerContext(first);
    setLoggerContext(second);
    releaseFirst();
    expect(getLoggerContext()).toBe(second);
  });

  it('DSH logger 执行异常时安全兜底，不阻断业务逻辑', () => {
    const brokenCtx: any = {
      logger: () => {
        throw new Error('logger service crashed');
      },
    };
    setLoggerContext(brokenCtx);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = getLogger('CrashTest');
    expect(() => logger.info('尝试输出')).not.toThrow();
    expect(logSpy).toHaveBeenCalledWith('[CrashTest]', '尝试输出');
  });
});
