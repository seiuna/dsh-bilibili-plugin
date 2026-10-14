import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(value));
}

export function parseQuery(url = ''): URLSearchParams {
  return new URL(url, 'http://localhost').searchParams;
}

/** Byte-bounded UTF-8 parsing; reject primitives, arrays, aborted and invalid JSON bodies. */
export async function readBodyJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 1024 * 1024) throw new HttpError(413, '请求体过大');
    chunks.push(buffer);
  }
  let body: unknown;
  try { body = bytes ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
  catch { throw new HttpError(400, '请求体不是有效 JSON'); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, '请求体必须是 JSON 对象');
  return body as Record<string, unknown>;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** This is an origin check, not a replacement for host authentication. */
export function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin === undefined) return; // non-browser local clients do not carry Origin
  const host = req.headers.host;
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new HttpError(403, '不允许跨站访问插件接口'); }
  if (!host || parsed.host.toLowerCase() !== host.toLowerCase() ||
      !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new HttpError(403, '不允许跨站访问插件接口');
  }
}

export function requireText(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${name} 必须是非空字符串`);
  return value;
}

export function requireInteger(value: unknown, name: string, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new HttpError(400, `${name} 必须是 ${min} 到 ${max} 之间的整数`);
  }
  return value;
}
