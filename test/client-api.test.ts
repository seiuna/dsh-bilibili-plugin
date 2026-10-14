import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addWhitelistUser, clearRecentMessages, fetchAuthStatus, fetchFollowings, fetchModels,
  fetchPollerConfig, fetchRecentMessages, fetchWorkspaces, generateQrcode, getSafeAvatarUrl,
  logoutVault, pollQrcode, removeWhitelistUser, searchBiliUser, setupVaultPassword,
  unlockVault, updatePollerConfig,
} from '../src/client/api.js';
import { BiliRequestError, errorMessage } from '../src/client/request.js';
import { createLatestRequest, startSerialPolling } from '../src/client/async.js';
import { createBiliStore } from '../src/client/auth-store.js';
import { startQrcodeSession } from '../src/client/qrcode-session.js';
import type { BiliPollerConfig, VaultStatusResponse } from '../src/types.js';

const user = { mid: 42, uname: '测试用户', face: 'https://i0.hdslb.com/avatar.jpg', level: 6, coins: 0, vipType: 0 };
const status: VaultStatusResponse = { hasVault: true, isUnlocked: true, user, accountSummary: user };
const locked: VaultStatusResponse = { hasVault: true, isUnlocked: false, user: null, accountSummary: user };
const config: BiliPollerConfig = {
  enableReply: true, enableAt: false, autoLikeOnReply: true, enableWhitelist: false, whitelist: [],
  pollIntervalSeconds: 10, imageDownloadTimeoutMs: 10000, imageDownloadMaxBytes: 8388608, imageDownloadMaxCount: 5,
};
const qr = { qrcodeKey: 'key /?', url: 'https://example.test/qr', qrcodeDataUrl: 'data:image/png;base64,test' };
const waiting = { code: 86101, status: 'waiting', message: '等待扫码' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('typed Bilibili requests (offline fetch)', () => {
  it('reads shared auth/config/user/workspace/model DTOs and encodes query values', async () => {
    fetchMock.mockResolvedValueOnce(json(status)).mockResolvedValueOnce(json(config))
      .mockResolvedValueOnce(json(user)).mockResolvedValueOnce(json([{ id: 'w', path: 'D:/mock', title: 'Mock' }]))
      .mockResolvedValueOnce(json([{ id: 'p', name: 'Provider', models: [{ id: 'm', name: 'Model', reasoning: { efforts: [{ id: 'high' }] } }] }]))
      .mockResolvedValueOnce(json({ list: [user], total: 1 }));
    await expect(fetchAuthStatus()).resolves.toEqual(status);
    await expect(fetchPollerConfig()).resolves.toEqual(config);
    await expect(searchBiliUser('昵称 &?')).resolves.toEqual(user);
    expect(fetchMock.mock.calls[2][0]).toBe('/api/bilibili/user/search?q=%E6%98%B5%E7%A7%B0%20%26%3F');
    await expect(fetchWorkspaces()).resolves.toHaveLength(1);
    await expect(fetchModels()).resolves.toHaveLength(1);
    await expect(fetchFollowings(2, 20)).resolves.toEqual({ list: [user], total: 1 });
    expect(fetchMock.mock.calls[5][0]).toBe('/api/bilibili/followings?page=2&pageSize=20');
  });

  it('posts typed config and whitelist mutations with JSON headers', async () => {
    fetchMock.mockImplementation(async () => json({ success: true, config }));
    await expect(updatePollerConfig({ enableAt: true })).resolves.toEqual(config);
    expect(fetchMock.mock.calls[0]).toEqual(['/api/bilibili/poller/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"enableAt":true}', signal: undefined,
    }]);
    await expect(addWhitelistUser(user)).resolves.toEqual(config);
    await expect(removeWhitelistUser(user.mid)).resolves.toEqual(config);
  });

  it('accepts successful vault, QR and recent responses', async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, user })).mockResolvedValueOnce(json({ success: true, user }))
      .mockResolvedValueOnce(json({ success: true })).mockResolvedValueOnce(json(qr)).mockResolvedValueOnce(json(waiting))
      .mockResolvedValueOnce(json({ success: true, list: [] })).mockResolvedValueOnce(json({ success: true }));
    await expect(setupVaultPassword('mock-token', 'mock-password')).resolves.toEqual({ success: true, user });
    await expect(unlockVault('mock-password', false)).resolves.toEqual({ success: true, user });
    await expect(logoutVault()).resolves.toEqual({ success: true });
    await expect(generateQrcode()).resolves.toEqual(qr);
    await expect(pollQrcode(qr.qrcodeKey)).resolves.toEqual(waiting);
    expect(fetchMock.mock.calls[4][0]).toBe('/api/bilibili/auth/qrcode/poll?key=key%20%2F%3F');
    await expect(fetchRecentMessages()).resolves.toEqual([]);
    await expect(clearRecentMessages()).resolves.toBe(true);
  });

  it('returns actual recent message items without manufacturing empty histories', async () => {
    const item = { id: 'r', time: 1, sourceType: 'video', user: { mid: '9007199254740993', uname: 'u' }, message: '', images: ['https://example.test/comment.png'], status: 'processing' };
    fetchMock.mockResolvedValue(json({ success: true, list: [item] }));
    await expect(fetchRecentMessages()).resolves.toEqual([item]);
  });

  it('preserves business not-found messages instead of diagnosing a restart', async () => {
    fetchMock.mockResolvedValue(json({ error: '未找到该用户' }, 404));
    await expect(searchBiliUser('absent')).rejects.toMatchObject({ message: '未找到该用户', kind: 'http', status: 404 });
  });

  it.each([
    ['config', () => fetchPollerConfig()], ['workspaces', () => fetchWorkspaces()],
    ['recent', () => fetchRecentMessages()], ['clear', () => clearRecentMessages()],
    ['followings', () => fetchFollowings()],
  ])('rejects missing %s routes without fabricated defaults or empty results', async (_name, call) => {
    fetchMock.mockResolvedValue(new Response('<html>Not found</html>', { status: 404 }));
    const error = await call().catch(value => value);
    expect(error).toBeInstanceOf(BiliRequestError);
    expect(error).toMatchObject({ kind: 'http', status: 404 });
    expect(error.message).not.toMatch(/重启/);
  });

  it.each([400, 401, 500, 503])('rejects HTTP %i even if the body misleadingly reports success', async code => {
    fetchMock.mockResolvedValue(json({ success: true }, code));
    await expect(clearRecentMessages()).rejects.toMatchObject({ kind: 'http', status: code });
  });

  it('rejects explicit business failure on HTTP 200', async () => {
    fetchMock.mockResolvedValue(json({ success: false, error: '记录写入失败' }));
    await expect(clearRecentMessages()).rejects.toMatchObject({ kind: 'business', message: '记录写入失败' });
  });

  it.each([
    ['config missing fields', () => fetchPollerConfig(), {}],
    ['config missing whitelist', () => updatePollerConfig({}), { success: true, config: { ...config, whitelist: undefined } }],
    ['auth missing user', () => fetchAuthStatus(), { hasVault: false, isUnlocked: false }],
    ['recent missing list', () => fetchRecentMessages(), { success: true }],
    ['clear missing success', () => clearRecentMessages(), {}],
    ['models wrong list', () => fetchModels(), [{ id: 'p', name: 'P', models: 'invalid' }]],
  ])('rejects malformed successful payload: %s', async (_name, call, body) => {
    fetchMock.mockResolvedValue(json(body));
    await expect(call()).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('handles invalid JSON and network failures without exposing arbitrary bodies', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<private error page>', { status: 200 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetchAuthStatus()).rejects.toMatchObject({ kind: 'invalid-response' });
    await expect(fetchAuthStatus()).rejects.toMatchObject({ kind: 'network' });
    expect(errorMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('forwards AbortSignal and rejects late responses even if fetch ignores cancellation', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    const controller = new AbortController();
    const result = fetchPollerConfig(controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
    controller.abort();
    pending.resolve(json(config));
    await rejected;
  });

  it('does not send a request for an already cancelled operation', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(generateQrcode(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks cancellation after delayed JSON decoding', async () => {
    const decoded = deferred<unknown>();
    const response = json(config);
    vi.spyOn(response, 'json').mockReturnValue(decoded.promise);
    fetchMock.mockResolvedValue(response);
    const controller = new AbortController();
    const result = fetchPollerConfig(controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    controller.abort(); decoded.resolve(config);
    await rejected;
  });

  it('preserves the existing avatar proxy behavior', () => {
    expect(getSafeAvatarUrl()).toBe('');
    expect(getSafeAvatarUrl('data:image/png;base64,x')).toBe('data:image/png;base64,x');
    expect(getSafeAvatarUrl('/api/bilibili/avatar/proxy?url=x')).toBe('/api/bilibili/avatar/proxy?url=x');
    expect(getSafeAvatarUrl(user.face)).toContain(encodeURIComponent(user.face));
  });
});

describe('auth store snapshots and refresh concurrency', () => {
  it('notifies subscribers and keeps a stable snapshot until updates, including unsubscribe', async () => {
    const store = createBiliStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const initial = store.getState();
    expect(store.getState()).toBe(initial);
    store.open();
    expect(store.getState()).not.toBe(initial);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe(); store.close();
    expect(listener).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(json(status));
    await expect(store.refresh()).resolves.toBe(true);
    expect(store.getState()).toMatchObject({ status, isLoading: false, error: null });
  });

  it('keeps the latest result when an older refresh resolves last', async () => {
    const old = deferred<Response>();
    const latest = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const store = createBiliStore();
    const first = store.refresh();
    const second = store.refresh();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    latest.resolve(json(status)); await expect(second).resolves.toBe(true);
    old.resolve(json(locked)); await expect(first).resolves.toBe(false);
    expect(store.getState()).toMatchObject({ status, isLoading: false, error: null });
  });

  it('does not end loading for the latest refresh when the superseded request fails', async () => {
    const old = deferred<Response>(); const latest = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const store = createBiliStore();
    const first = store.refresh(); const second = store.refresh();
    old.reject(new Error('old failure')); await first;
    expect(store.getState()).toMatchObject({ isLoading: true, error: null });
    latest.resolve(json(status)); await second;
    expect(store.getState().status).toEqual(status);
  });

  it('preserves known status and surfaces errors; a subsequent successful refresh clears them', async () => {
    const store = createBiliStore(); store.setStatus(status);
    fetchMock.mockResolvedValueOnce(json({ error: '凭据服务不可用' }, 503)).mockResolvedValueOnce(json(locked));
    await expect(store.refresh()).resolves.toBe(false);
    expect(store.getState()).toMatchObject({ status, error: '凭据服务不可用', isLoading: false });
    await expect(store.refresh()).resolves.toBe(true);
    expect(store.getState()).toMatchObject({ status: locked, error: null });
  });

  it('setStatus invalidates an old refresh so logout/unlock cannot be undone', async () => {
    const old = deferred<Response>(); fetchMock.mockReturnValue(old.promise);
    const store = createBiliStore();
    const pending = store.refresh(); store.setStatus(status);
    old.resolve(json(locked)); await pending;
    expect(store.getState()).toMatchObject({ status, isLoading: false });
  });
});

describe('cancelled and serial front-end lifetimes', () => {
  it('latest request tokens invalidate stale reads and support repeated cleanup', () => {
    const scope = createLatestRequest();
    const first = scope.begin(); const second = scope.begin();
    expect(first.isCurrent()).toBe(false); expect(first.signal.aborted).toBe(true);
    expect(second.isCurrent()).toBe(true);
    scope.cancel(); scope.cancel();
    expect(second.isCurrent()).toBe(false);
    expect(scope.begin().isCurrent()).toBe(true);
  });

  it('serial polling never reenters a slow request and cancellation stops rescheduling', async () => {
    vi.useFakeTimers();
    const pending = deferred<boolean>();
    const task = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(true);
    const error = vi.fn();
    const stop = startSerialPolling(task, error, 2000);
    await vi.advanceTimersByTimeAsync(10000);
    expect(task).toHaveBeenCalledTimes(1);
    pending.resolve(true); await vi.advanceTimersByTimeAsync(2000);
    expect(task).toHaveBeenCalledTimes(2);
    stop(); await vi.advanceTimersByTimeAsync(10000);
    expect(task).toHaveBeenCalledTimes(2); expect(error).not.toHaveBeenCalled();
  });

  it('stops on failure and reports it once', async () => {
    vi.useFakeTimers();
    const task = vi.fn().mockRejectedValue(new Error('poll failed')); const failed = vi.fn();
    startSerialPolling(task, failed, 2000);
    await vi.advanceTimersByTimeAsync(10000);
    expect(task).toHaveBeenCalledTimes(1); expect(failed).toHaveBeenCalledOnce();
  });

  it('ignores late rejection after stop without unhandled rejections', async () => {
    vi.useFakeTimers();
    const pending = deferred<boolean>(); const failed = vi.fn();
    const stop = startSerialPolling(() => pending.promise, failed, 2000);
    stop(); pending.reject(new Error('late')); await vi.advanceTimersByTimeAsync(10000);
    expect(failed).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('QR generation and polling lifecycle (offline fetch)', () => {
  beforeEach(() => vi.useFakeTimers());
  const handlers = () => ({ generated: vi.fn(), polled: vi.fn(), failed: vi.fn() });

  it('supports waiting/scanned/success then stops polling', async () => {
    fetchMock.mockResolvedValueOnce(json(qr)).mockResolvedValueOnce(json(waiting))
      .mockResolvedValueOnce(json({ code: 86090, status: 'scanned', message: '已扫码' }))
      .mockResolvedValueOnce(json({ code: 0, status: 'success', message: '成功', tempToken: 'mock-token', user }));
    const callbacks = handlers(); const stop = startQrcodeSession(callbacks);
    await vi.advanceTimersByTimeAsync(12000);
    expect(callbacks.generated).toHaveBeenCalledWith(qr);
    expect(callbacks.polled).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(callbacks.failed).not.toHaveBeenCalled(); stop();
  });

  it('does not start polling if generation returns after the overlay closes', async () => {
    const pending = deferred<Response>(); fetchMock.mockReturnValue(pending.promise);
    const callbacks = handlers(); const stop = startQrcodeSession(callbacks);
    stop(); pending.resolve(json(qr)); await vi.advanceTimersByTimeAsync(10000);
    expect(callbacks.generated).not.toHaveBeenCalled(); expect(callbacks.failed).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it('a replacement QR session is not overwritten by the previous late generation', async () => {
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(json({ ...qr, qrcodeKey: 'replacement' }));
    const first = handlers(); const stopFirst = startQrcodeSession(first);
    stopFirst();
    const second = handlers(); const stopSecond = startQrcodeSession(second);
    await vi.advanceTimersByTimeAsync(0);
    old.resolve(json(qr)); await vi.advanceTimersByTimeAsync(0);
    expect(first.generated).not.toHaveBeenCalled();
    expect(second.generated).toHaveBeenCalledOnce();
    expect(second.generated).toHaveBeenCalledWith(expect.objectContaining({ qrcodeKey: 'replacement' }));
    expect(vi.getTimerCount()).toBe(1);
    stopSecond();
  });

  it('slow polling cannot overlap and late success after close is discarded', async () => {
    const pending = deferred<Response>();
    fetchMock.mockResolvedValueOnce(json(qr)).mockReturnValueOnce(pending.promise);
    const callbacks = handlers(); const stop = startQrcodeSession(callbacks);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop(); pending.resolve(json({ code: 0, status: 'success', message: '', tempToken: 'mock-token' }));
    await vi.advanceTimersByTimeAsync(10000);
    expect(callbacks.polled).not.toHaveBeenCalled(); expect(callbacks.failed).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['expired', { code: 86038, status: 'expired', message: 'expired' }, false],
    ['missing token', { code: 0, status: 'success', message: '' }, true],
    ['unknown code', { code: -1, status: 'error', message: '上游异常' }, true],
  ])('handles terminal status %s without silently polling forever', async (_name, response, fails) => {
    fetchMock.mockResolvedValueOnce(json(qr)).mockResolvedValueOnce(json(response));
    const callbacks = handlers(); const stop = startQrcodeSession(callbacks);
    await vi.advanceTimersByTimeAsync(12000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(callbacks.failed).toHaveBeenCalledTimes(fails ? 1 : 0);
    expect(callbacks.polled).toHaveBeenCalledTimes(fails ? 0 : 1); stop();
  });

  it('reports poll HTTP errors and allows a fresh independent retry', async () => {
    fetchMock.mockResolvedValueOnce(json(qr)).mockResolvedValueOnce(json({ error: '暂时不可用' }, 503))
      .mockResolvedValueOnce(json({ ...qr, qrcodeKey: 'new' }));
    const first = handlers(); const stopFirst = startQrcodeSession(first);
    await vi.advanceTimersByTimeAsync(4000);
    expect(first.failed).toHaveBeenCalledWith(expect.objectContaining({ message: '暂时不可用' }));
    stopFirst();
    const second = handlers(); const stopSecond = startQrcodeSession(second);
    await vi.advanceTimersByTimeAsync(0);
    expect(second.generated).toHaveBeenCalledWith(expect.objectContaining({ qrcodeKey: 'new' })); stopSecond();
  });
});
