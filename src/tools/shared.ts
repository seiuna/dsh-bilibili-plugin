import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { bv2av } from '@seiuna/bilibili-api';
import type { BilibiliClientManager } from '../client-manager.js';

export type ToolManager = Pick<BilibiliClientManager, 'getClient' | 'requireAuthedClient'>;
export interface ToolRegistry {
  register<A, R>(tool: ToolDefinition<A, R>): void | (() => void);
}
export type RegisterTool = <A, R>(tool: ToolDefinition<A, R>) => void;
type Parameter = { type: string; required?: boolean; description: string };

/** Infer output from execute, rather than weakening every render callback to any. */
export function tool<A, R>(definition: {
  name: string;
  description: string;
  parameters: Record<string, Parameter>;
  execute: (args: A) => Promise<R>;
}): ToolDefinition<A, R> {
  return defineTool<A, R>({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    execute: definition.execute,
    output: {
      schema: { type: 'object', additionalProperties: true },
      // Standard JSON only: no icons, prose templates or locale-dependent formatting.
      // Missing values stay absent or null so "unknown" is never rendered as 0.
      render: (_args, result) => [{ type: 'text', text: JSON.stringify(result ?? null, null, 2) }],
    },
  });
}

export interface ApiResponse<T> { code: number; message?: string; data?: T | null }
export function checkCode<T>(response: ApiResponse<T>, label: string): ApiResponse<T> {
  if (!response || response.code !== 0) {
    // Do not echo arbitrary upstream messages (which can contain URLs or credentials).
    throw new Error(`${label}失败 (code=${response?.code ?? 'missing'})`);
  }
  return response;
}
export function dataOf<T>(response: ApiResponse<T>, label: string): NonNullable<T> {
  checkCode(response, label);
  if (response.data == null) throw new Error(`${label}响应缺失 data，不能判定为无数据`);
  return response.data;
}
export async function optionalData<T>(request: Promise<ApiResponse<T>>, label: string, warnings: string[]): Promise<NonNullable<T> | undefined> {
  try { return dataOf(await request, label); }
  catch { warnings.push(`${label}不可用，未将缺失值视为 0 或不存在`); return undefined; }
}
export function arrayOf<T>(value: T[] | null | undefined, label: string, nullable = false): T[] {
  if (value === null && nullable) return [];
  if (!Array.isArray(value)) throw new Error(`${label}列表缺失或格式异常`);
  return value;
}
export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
export function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
export function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
export function positiveInt(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`${label} 必须为 1-${max} 的正安全整数`);
  }
  return value;
}
export function nonempty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 不能为空`);
  return value.trim();
}
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`${label} 必须为 ${allowed.join(' / ')}`);
  return value as T;
}
export function idString(value: unknown, label: string, allowZero = false): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error(`${label} 必须为安全整数，长 ID 请使用字符串`);
  const id = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  if (!(allowZero ? /^(?:0|[1-9]\d*)$/ : /^[1-9]\d*$/).test(id)) throw new Error(`${label} 必须为数字 ID`);
  return id;
}
export function bvidOf(value: unknown): string {
  const bvid = nonempty(value, 'bvid');
  if (!/^BV[1-9A-HJ-NP-Za-km-z]{10}$/.test(bvid)) throw new Error('bvid 格式无效');
  return bvid;
}
export function aidOf(args: { bvid?: string; aid?: number }): number {
  const aid = args.aid == null ? undefined : positiveInt(args.aid, 'aid');
  const bvid = args.bvid == null ? undefined : bvidOf(args.bvid);
  if (!bvid && !aid) throw new Error('必须提供 bvid 或 aid');
  const converted = bvid ? positiveInt(bv2av(bvid), 'BV对应aid') : undefined;
  if (aid && converted && aid !== converted) throw new Error('bvid 与 aid 指向不同视频');
  return aid ?? converted!;
}
export function dynamicIdOf(value: unknown): string {
  const input = nonempty(value, 'dynamicId');
  if (/^[1-9]\d*$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error();
    const path = url.hostname === 't.bilibili.com' ? /^\/([1-9]\d*)\/?$/
      : url.hostname === 'www.bilibili.com' ? /^\/(?:opus|dynamic)\/([1-9]\d*)\/?$/ : undefined;
    const match = path?.exec(url.pathname);
    if (match) return match[1];
  } catch { /* return a local validation error, never follow supplied URLs */ }
  throw new Error('dynamicId 必须为数字 ID 或有效的 B站动态链接');
}
export function confirmed(value: unknown): boolean {
  if (value !== undefined && typeof value !== 'boolean') throw new Error('confirm 必须为 boolean');
  return value === true;
}
export function dateTime(seconds: number | undefined): string | undefined {
  return typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : undefined;
}
export function clock(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
export function decodeEntities(value: string): string {
  return value.replace(/&(?:quot|apos|amp|lt|gt|nbsp|#\d+|#x[\da-f]+);/gi, entity => {
    const named: Record<string, string> = { '&quot;': '"', '&apos;': "'", '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const hex = entity[2].toLowerCase() === 'x';
    const code = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}
export function stripHtml(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, '')).trim();
}
