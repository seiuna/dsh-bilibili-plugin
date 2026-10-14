import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { apply, type PluginServices } from '../src/index.js';
import { deferred, fixture, invoke } from './http-fixture.js';

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); });
function lifecycle() {
  const f = fixture();
  const releaseTools = vi.fn();
  const releaseWorkspace = vi.fn();
  const releaseHandler = vi.fn();
  const bridge = { handleInbound: vi.fn(async () => {}), dispose: vi.fn() };
  const manager = { ...f.manager, isUnlocked: true, initOnStartup: vi.fn(async () => {}) };
  const poller = {
    ...f.poller,
    claimRuntime: vi.fn(() => Symbol('runtime')),
    start: vi.fn(), stop: vi.fn(), loadConfig: vi.fn(async () => f.poller.getConfig()),
    setWorkspaceRegistry: vi.fn(() => releaseWorkspace), setDshHandler: vi.fn(() => releaseHandler),
  };
  const services = {
    manager, poller, createBridge: vi.fn(() => bridge), registerTools: vi.fn(() => releaseTools),
  } satisfies PluginServices;
  let cleanup!: () => void;
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const ctx = {
    webServer: f.webServer,
    get: vi.fn((name: string) => name === 'llm' ? f.llm : {}),
    effect: vi.fn((fn: () => () => void) => { cleanup = fn(); }),
    inject: vi.fn(), logger: () => logger,
  };
  const factory = vi.fn(() => {
    expect(ctx.effect).toHaveBeenCalledOnce(); // Register lifecycle ownership before creating any service.
    return services;
  });
  const start = () => {
    apply(ctx as unknown as Context, { enabled: true }, factory);
    cleanups.push(() => cleanup());
  };
  return { ...f, ctx, manager, poller, bridge, factory, services, releaseTools, releaseWorkspace, releaseHandler, logger, start, cleanup: () => cleanup() };
}

describe('injected plugin lifecycle (no real services or production apply)', () => {
  it('keeps disabled apply inert', () => {
    const f = lifecycle();
    apply(f.ctx as unknown as Context, { enabled: false }, f.factory);
    expect(f.factory).not.toHaveBeenCalled();
    expect(f.ctx.effect).not.toHaveBeenCalled();
    expect(f.webServer.register).not.toHaveBeenCalled();
  });
  it('registers, starts after async config readiness and releases every resource once', async () => {
    const f = lifecycle(); f.start();
    expect(f.handlers.size).toBe(16);
    expect(f.manager.initOnStartup).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(f.poller.start).toHaveBeenCalledOnce());
    const owner = f.poller.claimRuntime.mock.results[0].value;
    expect(f.poller.start).toHaveBeenCalledWith(owner);
    f.cleanup(); f.cleanup();
    expect(f.poller.stop).toHaveBeenCalledExactlyOnceWith(owner);
    expect(f.handlers.size).toBe(0);
    expect(f.releaseHandler).toHaveBeenCalledOnce();
    expect(f.releaseWorkspace).toHaveBeenCalledOnce();
    expect(f.releaseTools).toHaveBeenCalledOnce();
    expect(f.bridge.dispose).toHaveBeenCalledOnce();
  });
  it('does not auto-start a locked manager', async () => {
    const f = lifecycle(); f.manager.isUnlocked = false; f.start();
    await vi.waitFor(() => expect(f.poller.loadConfig).toHaveBeenCalledOnce());
    expect(f.poller.start).not.toHaveBeenCalled();
  });
  it('does not even begin deferred initialization after immediate disposal', async () => {
    const f = lifecycle(); f.start(); f.cleanup();
    await Promise.resolve();
    expect(f.manager.initOnStartup).not.toHaveBeenCalled();
    expect(f.poller.loadConfig).not.toHaveBeenCalled();
  });
  it('does not load config or start after disposal during manager initialization', async () => {
    const f = lifecycle(); const pending = deferred();
    f.manager.initOnStartup.mockReturnValue(pending.promise);
    f.start(); await Promise.resolve(); f.cleanup();
    pending.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(f.poller.loadConfig).not.toHaveBeenCalled();
    expect(f.poller.start).not.toHaveBeenCalled();
  });
  it('does not start after disposal during config loading', async () => {
    const f = lifecycle(); const pending = deferred<ReturnType<typeof f.poller.getConfig>>();
    f.poller.loadConfig.mockReturnValue(pending.promise);
    f.start(); await vi.waitFor(() => expect(f.poller.loadConfig).toHaveBeenCalledOnce());
    f.cleanup(); pending.resolve(f.poller.getConfig()); await Promise.resolve(); await Promise.resolve();
    expect(f.poller.start).not.toHaveBeenCalled();
  });
  it.each(['init', 'config'] as const)('cleans registered resources after async %s failure', async stage => {
    const f = lifecycle();
    if (stage === 'init') f.manager.initOnStartup.mockRejectedValueOnce(new Error('mock init failed'));
    else f.poller.loadConfig.mockRejectedValueOnce(new Error('mock config failed'));
    f.start();
    await vi.waitFor(() => expect(f.logger.error).toHaveBeenCalledOnce());
    expect(f.handlers.size).toBe(0);
    expect(f.poller.start).not.toHaveBeenCalled();
    expect(f.bridge.dispose).toHaveBeenCalledOnce();
    expect(f.releaseTools).toHaveBeenCalledOnce();
    f.cleanup(); expect(f.bridge.dispose).toHaveBeenCalledOnce();
  });
  it('releases the already-created bridge and runtime if tools registration fails', async () => {
    const f = lifecycle(); f.services.registerTools.mockImplementation(() => { throw new Error('tool failure'); });
    expect(f.start).toThrow('tool failure');
    expect(f.poller.stop).toHaveBeenCalledOnce();
    expect(f.releaseHandler).toHaveBeenCalledOnce();
    expect(f.releaseWorkspace).toHaveBeenCalledOnce();
    expect(f.bridge.dispose).toHaveBeenCalledOnce();
    await Promise.resolve(); expect(f.manager.initOnStartup).not.toHaveBeenCalled();
    f.cleanup(); expect(f.poller.stop).toHaveBeenCalledOnce();
  });
  it('cleans all owned resources when registration fails half-way', async () => {
    const f = lifecycle();
    const register = f.webServer.register;
    vi.mocked(f.webServer.register).mockImplementationOnce(route => {
      f.handlers.set(route.path, route.handler);
      return () => { f.handlers.delete(route.path); f.unregister(); };
    }).mockImplementationOnce(() => { throw new Error('exact collision'); });
    expect(f.start).toThrow('exact collision');
    expect(f.handlers.size).toBe(0);
    expect(f.unregister).toHaveBeenCalledOnce();
    expect(f.releaseTools).toHaveBeenCalledOnce();
    expect(f.bridge.dispose).toHaveBeenCalledOnce();
    await Promise.resolve(); expect(f.manager.initOnStartup).not.toHaveBeenCalled();
    expect(register).toHaveBeenCalledTimes(2);
  });
  it('continues teardown after an individual disposer throws', async () => {
    const f = lifecycle(); f.releaseHandler.mockImplementation(() => { throw new Error('cleanup'); });
    f.start(); f.cleanup();
    expect(f.releaseWorkspace).toHaveBeenCalledOnce();
    expect(f.poller.stop).toHaveBeenCalledOnce();
    expect(f.bridge.dispose).toHaveBeenCalledOnce();
  });
  it('claims a new runtime after logout and prevents the old startup from restarting', async () => {
    const f = lifecycle(); const config = deferred<ReturnType<typeof f.poller.getConfig>>();
    f.poller.loadConfig.mockReturnValueOnce(config.promise);
    f.start(); await vi.waitFor(() => expect(f.poller.loadConfig).toHaveBeenCalledOnce());
    await invoke(f.handlers, 'POST', '/vault/logout');
    config.resolve(f.poller.getConfig()); await Promise.resolve(); await Promise.resolve();
    expect(f.poller.start).not.toHaveBeenCalled();
    await invoke(f.handlers, 'POST', '/vault/unlock', { password: 'pass' });
    expect(f.poller.claimRuntime).toHaveBeenCalledTimes(2);
    expect(f.poller.start).toHaveBeenCalledExactlyOnceWith(f.poller.claimRuntime.mock.results[1].value);
    f.cleanup();
    expect(f.poller.stop).toHaveBeenLastCalledWith(f.poller.claimRuntime.mock.results[1].value);
  });
  it('does not start a pending login completed after logout or disposal', async () => {
    const f = lifecycle(); f.start();
    await vi.waitFor(() => expect(f.poller.start).toHaveBeenCalledOnce());
    f.poller.start.mockClear();
    const login = deferred<Awaited<ReturnType<typeof f.manager.unlock>>>();
    f.manager.unlock.mockReturnValueOnce(login.promise);
    const pending = invoke(f.handlers, 'POST', '/vault/unlock', { password: 'pass' });
    await vi.waitFor(() => expect(f.manager.unlock).toHaveBeenCalledOnce());
    await invoke(f.handlers, 'POST', '/vault/logout');
    login.resolve({ mid: 1, uname: 'x', face: '', level: 1, coins: 0, vipType: 0 });
    await pending; expect(f.poller.start).not.toHaveBeenCalled();
    const secondLogin = deferred<Awaited<ReturnType<typeof f.manager.unlock>>>();
    f.manager.unlock.mockReturnValueOnce(secondLogin.promise);
    const second = invoke(f.handlers, 'POST', '/vault/unlock', { password: 'pass' });
    await vi.waitFor(() => expect(f.manager.unlock).toHaveBeenCalledTimes(2));
    f.cleanup(); secondLogin.resolve({ mid: 1, uname: 'x', face: '', level: 1, coins: 0, vipType: 0 });
    await second; expect(f.poller.start).not.toHaveBeenCalled();
  });
  it('waits for initial configuration if manual login completes before startup readiness', async () => {
    const f = lifecycle(); const pending = deferred<ReturnType<typeof f.poller.getConfig>>();
    f.poller.loadConfig.mockReturnValueOnce(pending.promise);
    f.start(); await vi.waitFor(() => expect(f.poller.loadConfig).toHaveBeenCalledOnce());
    await invoke(f.handlers, 'POST', '/vault/unlock', { password: 'pass' });
    expect(f.poller.start).not.toHaveBeenCalled();
    pending.resolve(f.poller.getConfig());
    await vi.waitFor(() => expect(f.poller.start).toHaveBeenCalledOnce());
  });
  it('owns an optional skill disposer and ignores injection after plugin disposal', () => {
    const f = lifecycle(); f.start();
    const callback = f.ctx.inject.mock.calls[0][1] as (ctx: unknown) => void;
    const release = vi.fn(); let releaseScope!: () => void;
    const skillCtx = { skills: { register: vi.fn(() => release) }, effect: vi.fn((fn: () => () => void) => { releaseScope = fn(); }) };
    callback(skillCtx);
    expect(skillCtx.skills.register).toHaveBeenCalledOnce();
    releaseScope(); f.cleanup(); expect(release).toHaveBeenCalledOnce();
    callback(skillCtx); expect(skillCtx.skills.register).toHaveBeenCalledOnce();
  });
});
