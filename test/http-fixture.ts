import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { vi } from 'vitest';
import type { BiliPollerConfig } from '../src/types.js';
import type { HttpDependencies, HttpHandler, HttpServer } from '../src/http/contracts.js';

export const defaultConfig: BiliPollerConfig = {
  enableReply: true, enableAt: true, autoLikeOnReply: false, enableWhitelist: false,
  pollIntervalSeconds: 10, imageDownloadTimeoutMs: 10_000, imageDownloadMaxBytes: 8 * 1024 * 1024,
  imageDownloadMaxCount: 5, whitelist: [], modelSelection: null,
};
export function fixture() {
  const handlers = new Map<string, HttpHandler>();
  const unregister = vi.fn();
  const webServer: HttpServer = {
    register: vi.fn(route => {
      if (handlers.has(route.path)) throw new Error('Duplicate exact path');
      handlers.set(route.path, route.handler);
      return () => { unregister(route.path); handlers.delete(route.path); };
    }),
  };
  const manager = {
    getStatus: vi.fn(async () => ({ hasVault: false, isUnlocked: false, user: null })),
    generateQrcode: vi.fn(async () => ({ qrcodeKey: 'key', url: 'mock:qr', qrcodeDataUrl: 'data:image/png,mock' })),
    pollQrcode: vi.fn(async () => ({ code: 86101, status: 'waiting' as const, message: 'waiting' })),
    setupPassword: vi.fn(async () => ({ mid: 1, uname: 'user', face: '', level: 3, coins: 0, vipType: 0 })),
    unlock: vi.fn(async () => ({ mid: 1, uname: 'user', face: '', level: 3, coins: 0, vipType: 0 })),
    logout: vi.fn(async () => {}),
  };
  const poller = {
    getConfig: vi.fn(() => ({ ...defaultConfig })),
    getSystemPrompt: vi.fn(async () => 'persona'),
    getPromptFilePath: vi.fn(() => 'mock/persona.md'),
    saveConfig: vi.fn(async (config: Partial<BiliPollerConfig>) => ({ ...defaultConfig, ...config })),
    getRecentMessages: vi.fn(() => []), clearRecentMessages: vi.fn(),
    getFollowings: vi.fn(async () => ({ total: 0, list: [] })),
    listWorkspaces: vi.fn(async () => []),
    searchUser: vi.fn(async () => ({ mid: 1, uname: 'user', face: '' })),
    addWhitelistUser: vi.fn(async () => ({ ...defaultConfig })),
    removeWhitelistUser: vi.fn(async () => ({ ...defaultConfig })),
  };
  const llm = {
    listProviders: vi.fn(async () => [{ id: 'p', name: 'Provider', secret: 'not-exposed' }]),
    listModels: vi.fn(async () => [{ id: 'm', name: 'Model', secret: 'not-exposed' }]),
    resolveModelInfo: vi.fn(async () => ({ reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } })),
  };
  const start = vi.fn();
  const deps: HttpDependencies = {
    webServer, manager, poller, getLlm: () => llm,
    beginLogin: vi.fn(() => start), stopPolling: vi.fn(),
  };
  return { deps, handlers, webServer, manager, poller, llm, start, unregister };
}

export function request(method: string, url: string, body?: unknown, origin?: string, chunks?: Buffer[]): IncomingMessage {
  const buffers = chunks ?? (body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  const req = Readable.from(buffers) as unknown as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = { host: '127.0.0.1:43120', ...(origin === undefined ? {} : { origin }) };
  return req;
}
export function response() {
  const headers: Record<string, string> = {};
  let body = Buffer.alloc(0);
  const res = {
    statusCode: 200, writableEnded: false,
    setHeader: (key: string, value: string) => { headers[key] = value; },
    end: (value?: string | Uint8Array) => {
      body = value === undefined ? Buffer.alloc(0) : Buffer.from(value);
      res.writableEnded = true;
    },
  };
  return { res: res as unknown as ServerResponse, headers, raw: () => body, json: () => JSON.parse(body.toString('utf8')) };
}
export async function invoke(handlers: Map<string, HttpHandler>, method: string, path: string, body?: unknown, origin?: string) {
  const output = response();
  const handler = handlers.get(`/api/bilibili${path.split('?')[0]}`);
  if (!handler) throw new Error(`Missing handler: ${path}`);
  await handler(request(method, `/api/bilibili${path}`, body, origin), output.res);
  return { ...output, status: output.res.statusCode };
}
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
