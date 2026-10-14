import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerBilibiliRoutes } from '../src/http/routes.js';
import { BiliUserNotFoundError } from '../src/poller/users.js';
import { defaultConfig, deferred, fixture, invoke, request, response } from './http-fixture.js';

const active: Array<() => void> = [];
function setup() {
  const f = fixture();
  const dispose = registerBilibiliRoutes(f.deps);
  active.push(dispose);
  return { ...f, dispose };
}
afterEach(() => { active.splice(0).forEach(dispose => dispose()); vi.unstubAllGlobals(); });

describe('typed HTTP routes', () => {
  it('registers exactly one handler for each retained URL and both config methods', async () => {
    const f = setup();
    expect(f.handlers.size).toBe(16);
    expect(new Set(vi.mocked(f.webServer.register).mock.calls.map(([route]) => route.path)).size).toBe(16);
    const read = await invoke(f.handlers, 'GET', '/poller/config');
    expect(read.json()).toMatchObject({ ...defaultConfig, systemPrompt: 'persona', promptFilePath: 'mock/persona.md' });
    expect((await invoke(f.handlers, 'POST', '/poller/config', { enableAt: false })).json()).toMatchObject({ success: true, config: { enableAt: false } });
    const other = await invoke(f.handlers, 'DELETE', '/poller/config');
    expect(other.status).toBe(405);
    expect(other.headers.allow).toBe('GET, POST');
    f.dispose(); f.dispose();
    expect(f.unregister).toHaveBeenCalledTimes(16);
  });
  it('rolls back registrations if a later exact path collides, even if one disposer throws', () => {
    const f = fixture();
    const releases = [vi.fn(), vi.fn(() => { throw new Error('dispose failed'); }), vi.fn()];
    vi.mocked(f.webServer.register).mockImplementation(() => {
      const index = vi.mocked(f.webServer.register).mock.calls.length - 1;
      if (index === 3) throw new Error('Duplicate exact path');
      return releases[index];
    });
    expect(() => registerBilibiliRoutes(f.deps)).toThrow('Duplicate exact path');
    releases.forEach(release => expect(release).toHaveBeenCalledOnce());
  });
  it('blocks every cross-site path before method dispatch or service access', async () => {
    const f = setup();
    for (const handler of f.handlers.values()) {
      for (const method of ['GET', 'POST']) {
        const output = response();
        await handler(request(method, '/', {}, 'https://evil.example'), output.res);
        expect(output.res.statusCode).toBe(403);
      }
    }
    expect(f.manager.getStatus).not.toHaveBeenCalled();
    expect(f.manager.logout).not.toHaveBeenCalled();
    expect(f.poller.getConfig).not.toHaveBeenCalled();
    expect(f.poller.saveConfig).not.toHaveBeenCalled();
  });
  it('preserves same-host and non-browser auth response protocols', async () => {
    const f = setup();
    expect((await invoke(f.handlers, 'GET', '/auth/status', undefined, 'http://127.0.0.1:43120')).json()).toMatchObject({ isUnlocked: false });
    expect((await invoke(f.handlers, 'POST', '/auth/qrcode/generate')).json()).toMatchObject({ qrcodeKey: 'key' });
    expect((await invoke(f.handlers, 'GET', '/auth/qrcode/poll?key=abc')).json()).toMatchObject({ status: 'waiting' });
    expect(f.manager.pollQrcode).toHaveBeenCalledWith('abc');
    expect((await invoke(f.handlers, 'POST', '/vault/setup-pwd', { tempToken: 'token', password: 'pass', remember: false })).json()).toMatchObject({ success: true, user: { mid: 1 } });
    expect(f.manager.setupPassword).toHaveBeenCalledWith('token', 'pass', false);
    expect(f.start).toHaveBeenCalledOnce();
    expect((await invoke(f.handlers, 'POST', '/vault/unlock', { password: 'pass' })).status).toBe(200);
    expect(f.manager.unlock).toHaveBeenCalledWith('pass', true);
    expect((await invoke(f.handlers, 'POST', '/vault/logout')).json()).toMatchObject({ success: true });
    expect(f.deps.stopPolling).toHaveBeenCalledOnce();
  });
  it.each([
    ['/vault/unlock', { password: 10 }], ['/vault/unlock', { password: 'pass', remember: 'false' }],
    ['/vault/setup-pwd', { password: 'pass' }], ['/vault/setup-pwd', { tempToken: {}, password: [] }],
  ])('rejects invalid vault input for %s', async (path, body) => {
    const f = setup();
    expect((await invoke(f.handlers, 'POST', path, body)).status).toBe(400);
    expect(f.manager.unlock).not.toHaveBeenCalled();
    expect(f.manager.setupPassword).not.toHaveBeenCalled();
  });
  it('returns manager failure without starting polling', async () => {
    const f = setup();
    f.manager.unlock.mockRejectedValueOnce(new Error('bad password'));
    const result = await invoke(f.handlers, 'POST', '/vault/unlock', { password: 'pass' });
    expect(result.status).toBe(401);
    expect(result.json()).toEqual({ error: 'bad password' });
    expect(f.start).not.toHaveBeenCalled();
  });
  it('validates and copies config fields, nested whitelist and model values without injecting unknowns', async () => {
    const f = setup();
    const result = await invoke(f.handlers, 'POST', '/poller/config', {
      enableReply: false, pollIntervalSeconds: 30, imageDownloadMaxCount: 0,
      systemPrompt: '', targetWorkspacePath: '', ignored: 'danger', promptFilePath: 'injected',
      whitelist: [{ mid: 123, uname: 'Name', extra: 'injected' }],
      modelSelection: { provider: 'p', model: 'm', reasoningEffort: 'high', apiKey: 'ignored' },
    });
    expect(result.status).toBe(200);
    expect(f.poller.saveConfig).toHaveBeenCalledWith({
      enableReply: false, pollIntervalSeconds: 30, imageDownloadMaxCount: 0, systemPrompt: '', targetWorkspacePath: '',
      whitelist: [{ mid: 123, uname: 'Name', face: '', sign: '' }],
      modelSelection: { provider: 'p', model: 'm', reasoningEffort: 'high' },
    });
    expect((await invoke(f.handlers, 'POST', '/poller/config', { modelSelection: null })).status).toBe(200);
  });
  it.each([
    { enableReply: 'true' }, { autoLikeOnReply: 1 }, { enableWhitelist: null },
    { pollIntervalSeconds: 0 }, { pollIntervalSeconds: 1.5 }, { imageDownloadTimeoutMs: 999 },
    { imageDownloadMaxBytes: 99_000_000 }, { imageDownloadMaxCount: -1 },
    { whitelist: {} }, { whitelist: [null] }, { whitelist: [{ mid: 0, uname: 'x' }] },
    { whitelist: [{ mid: '123', uname: 'x' }] }, { whitelist: [{ mid: Number.MAX_SAFE_INTEGER + 1, uname: 'x' }] },
    { whitelist: [{ mid: 1, uname: 'x', face: {} }] }, { whitelist: [{ mid: 1, uname: '' }] },
    { systemPrompt: [] }, { targetWorkspacePath: false }, { modelSelection: [] },
    { modelSelection: { provider: 'p', model: 'm', reasoningEffort: false } },
    { modelSelection: { provider: 'p', model: 'missing' } },
    { modelSelection: { provider: 'missing', model: 'm' } },
    { modelSelection: { provider: 'p', model: 'm', reasoningEffort: 'ultra' } },
  ])('rejects config value %j before saving', async body => {
    const f = setup();
    expect((await invoke(f.handlers, 'POST', '/poller/config', body)).status).toBe(400);
    expect(f.poller.saveConfig).not.toHaveBeenCalled();
  });
  it('awaits asynchronous provider catalogs for both listing and explicit model validation', async () => {
    const f = setup();
    const listing = deferred<Array<{ id: string }>>();
    f.llm.listProviders.mockReturnValueOnce(listing.promise);
    const catalog = invoke(f.handlers, 'GET', '/models');
    expect(f.llm.listModels).not.toHaveBeenCalled();
    listing.resolve([{ id: 'p' }]);
    expect((await catalog).json()[0]).toMatchObject({ id: 'p', models: [{ id: 'm' }] });
    const selecting = deferred<Array<{ id: string }>>();
    f.llm.listProviders.mockReturnValueOnce(selecting.promise);
    const save = invoke(f.handlers, 'POST', '/poller/config', { modelSelection: { provider: 'p', model: 'm' } });
    await vi.waitFor(() => expect(f.llm.listProviders).toHaveBeenCalledTimes(2));
    expect(f.poller.saveConfig).not.toHaveBeenCalled();
    selecting.resolve([{ id: 'p' }]);
    expect((await save).status).toBe(200);
    expect(f.poller.saveConfig).toHaveBeenCalledWith({ modelSelection: { provider: 'p', model: 'm' } });
  });
  it('retains successful providers and models when another directory or optional metadata fails', async () => {
    const f = setup();
    f.llm.listProviders.mockResolvedValueOnce([{ id: 'bad' }, { id: 'p' }]);
    f.llm.listModels.mockImplementation(async provider => {
      if (provider === 'bad') throw new Error('directory offline');
      return [{ id: 'm' }];
    });
    f.llm.resolveModelInfo.mockRejectedValueOnce(new Error('optional metadata offline'));
    const result = await invoke(f.handlers, 'GET', '/models');
    expect(result.json()).toEqual([
      { id: 'bad', name: 'bad', models: [], error: '获取模型失败' },
      { id: 'p', name: 'p', models: [{ id: 'm', name: 'm' }] },
    ]);
    f.deps.getLlm = () => undefined;
    expect((await invoke(f.handlers, 'GET', '/models')).status).toBe(503);
  });
  it('does not silently accept unverifiable explicit reasoning or a missing model service', async () => {
    const f = setup();
    f.llm.resolveModelInfo.mockRejectedValueOnce(new Error('metadata offline'));
    expect((await invoke(f.handlers, 'POST', '/poller/config', { modelSelection: { provider: 'p', model: 'm', reasoningEffort: 'high' } })).status).toBe(400);
    f.deps.getLlm = () => undefined;
    expect((await invoke(f.handlers, 'POST', '/poller/config', { modelSelection: { provider: 'p', model: 'm' } })).status).toBe(503);
    expect(f.poller.saveConfig).not.toHaveBeenCalled();
  });
  it('rejects invalid request JSON without service calls', async () => {
    const f = setup();
    const result = response();
    await f.handlers.get('/api/bilibili/poller/config')!(request('POST', '/', undefined, undefined, [Buffer.from('{broken')]), result.res);
    expect(result.res.statusCode).toBe(400);
    expect(f.poller.saveConfig).not.toHaveBeenCalled();
  });
  it('fences a config model lookup completed after route disposal', async () => {
    const f = setup();
    const models = deferred<Array<{ id: string }>>();
    f.llm.listModels.mockReturnValueOnce(models.promise);
    const pending = invoke(f.handlers, 'POST', '/poller/config', { modelSelection: { provider: 'p', model: 'm' } });
    await vi.waitFor(() => expect(f.llm.listModels).toHaveBeenCalled());
    f.dispose();
    models.resolve([{ id: 'm' }]);
    expect((await pending).status).toBe(503);
    expect(f.poller.saveConfig).not.toHaveBeenCalled();
  });
  it('retains models, workspaces, followings, search and recent-message protocols', async () => {
    const f = setup();
    const models = await invoke(f.handlers, 'GET', '/models');
    expect(models.json()[0]).toMatchObject({ id: 'p', models: [{ id: 'm', reasoning: { efforts: [{ id: 'high' }] } }] });
    expect(models.raw().toString()).not.toContain('not-exposed');
    expect((await invoke(f.handlers, 'GET', '/workspaces')).json()).toEqual([]);
    expect((await invoke(f.handlers, 'GET', '/followings?page=2&pageSize=20')).json()).toEqual({ total: 0, list: [] });
    expect(f.poller.getFollowings).toHaveBeenCalledWith(2, 20);
    expect((await invoke(f.handlers, 'GET', '/user/search?q=Name')).json()).toMatchObject({ mid: 1 });
    expect((await invoke(f.handlers, 'GET', '/poller/recent-messages')).json()).toEqual({ success: true, list: [] });
    expect((await invoke(f.handlers, 'POST', '/poller/recent-messages/clear')).json()).toEqual({ success: true });
  });
  it.each(['/followings?page=abc', '/followings?page=-1', '/followings?pageSize=100', '/user/search?q=', '/auth/qrcode/poll'])('rejects missing or invalid query %s', async path => {
    const f = setup();
    expect((await invoke(f.handlers, 'GET', path)).status).toBe(400);
  });
  it('distinguishes user not found from upstream and malformed-response failures', async () => {
    const f = setup();
    f.poller.searchUser.mockRejectedValueOnce(new BiliUserNotFoundError());
    expect((await invoke(f.handlers, 'GET', '/user/search?q=user')).status).toBe(404);
    for (const message of ['risk code -412', 'invalid response shape', 'network unavailable']) {
      f.poller.searchUser.mockRejectedValueOnce(new Error(message));
      const result = await invoke(f.handlers, 'GET', '/user/search?q=user');
      expect(result.status).toBe(502);
      expect(result.json()).toEqual({ error: message });
    }
  });
  it('checks whitelist numeric identifiers without coercing scalars', async () => {
    const f = setup();
    expect((await invoke(f.handlers, 'POST', '/whitelist/add', { mid: 2, uname: 'Name', secret: 'ignored' })).status).toBe(200);
    expect(f.poller.addWhitelistUser).toHaveBeenCalledWith({ mid: 2, uname: 'Name', face: '', sign: '' });
    expect((await invoke(f.handlers, 'POST', '/whitelist/remove', { mid: 2 })).status).toBe(200);
    expect((await invoke(f.handlers, 'POST', '/whitelist/remove', { mid: '2' })).status).toBe(400);
    expect((await invoke(f.handlers, 'POST', '/whitelist/add', { mid: -2, uname: 'Name' })).status).toBe(400);
  });
});

describe('avatar proxy bounded shared downloads', () => {
  it.each(['https://evilhdslb.com/a', 'https://hdslb.com.evil.example/a', 'http://127.0.0.1/a', 'https://user@i0.hdslb.com/a', 'https://i0.hdslb.com:8000/a'])('rejects %s before fetch', async url => {
    const f = setup();
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await invoke(f.handlers, 'GET', `/avatar/proxy?url=${encodeURIComponent(url)}`)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses HTTPS, rejected redirects, bounded signal and image-only response', async () => {
    const f = setup();
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await invoke(f.handlers, 'GET', '/avatar/proxy?url=http%3A%2F%2Fi0.hdslb.com%2Fa.png');
    expect(result.status).toBe(200);
    expect(result.raw()).toEqual(Buffer.from([1, 2, 3]));
    expect(result.headers['content-type']).toBe('image/png');
    expect(result.headers['access-control-allow-origin']).toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'https:' }), expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }));
  });
  it('bounds an image stream even without Content-Length and cancels it', async () => {
    const f = setup();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { headers: { 'content-type': 'image/png' } })));
    expect((await invoke(f.handlers, 'GET', '/avatar/proxy?url=https%3A%2F%2Fi0.hdslb.com%2Fa')).status).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('aborts an in-flight avatar fetch during disposal', async () => {
    const f = setup();
    let signal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn((_url: unknown, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = options.signal!;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })));
    const pending = invoke(f.handlers, 'GET', '/avatar/proxy?url=https%3A%2F%2Fi0.hdslb.com%2Fa');
    await vi.waitFor(() => expect(signal).toBeDefined());
    f.dispose();
    expect((await pending).status).toBe(502);
    expect(signal.aborted).toBe(true);
  });
  it.each([
    () => new Response('redirect', { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
    () => new Response('<script>bad</script>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('x', { headers: { 'content-type': 'image/png', 'content-length': '999999999' } }),
  ])('rejects redirects, content types and declared oversized bodies', async makeResponse => {
    const f = setup(); vi.stubGlobal('fetch', vi.fn(async () => makeResponse()));
    expect((await invoke(f.handlers, 'GET', '/avatar/proxy?url=https%3A%2F%2Fi0.hdslb.com%2Fa')).status).toBe(502);
  });
});
