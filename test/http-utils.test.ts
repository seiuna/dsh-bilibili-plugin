import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { assertSameOrigin, readBodyJson, sendJson } from '../src/http/utils.js';
import { request, response } from './http-fixture.js';

describe('HTTP JSON and origin utilities', () => {
  it('preserves a UTF-8 character split across byte chunks', async () => {
    const input = Buffer.from('{"text":"中文😀"}');
    const chunks = Array.from(input, byte => Buffer.from([byte]));
    expect(await readBodyJson(request('POST', '/', undefined, undefined, chunks))).toEqual({ text: '中文😀' });
  });
  it.each(['null', '1', 'true', '[]', '"text"', '{broken'])('rejects non-object or malformed JSON: %s', async raw => {
    await expect(readBodyJson(request('POST', '/', undefined, undefined, [Buffer.from(raw)]))).rejects.toThrow();
  });
  it('limits bytes, not UTF-16 character length', async () => {
    const raw = Buffer.from(JSON.stringify({ text: '中'.repeat(400_000) }));
    expect(raw.length).toBeGreaterThan(1024 * 1024);
    await expect(readBodyJson(request('POST', '/', undefined, undefined, [raw]))).rejects.toMatchObject({ status: 413 });
  });
  it('rejects an aborted stream and accepts an empty object body', async () => {
    const broken = Readable.from((async function* () {
      yield Buffer.from('{"a":');
      throw new Error('aborted');
    })()) as unknown as IncomingMessage;
    await expect(readBodyJson(broken)).rejects.toThrow('aborted');
    expect(await readBodyJson(request('POST', '/'))).toEqual({});
  });
  it.each(['https://evil.example', 'http://127.0.0.1:43121', 'null', '', 'http://user@127.0.0.1:43120', 'http://127.0.0.1:43120/path'])('rejects foreign or malformed Origin %s', origin => {
    expect(() => assertSameOrigin(request('GET', '/', undefined, origin))).toThrow();
  });
  it('allows same-host Origin or no Origin, without claiming authentication', () => {
    expect(() => assertSameOrigin(request('GET', '/', undefined, 'http://127.0.0.1:43120'))).not.toThrow();
    expect(() => assertSameOrigin(request('GET', '/'))).not.toThrow();
  });
  it('writes JSON once with no-store and nosniff', () => {
    const output = response();
    sendJson(output.res, 400, { error: '失败' });
    sendJson(output.res, 200, {});
    expect(output.res.statusCode).toBe(400);
    expect(output.json()).toEqual({ error: '失败' });
    expect(output.headers).toMatchObject({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  });
});
