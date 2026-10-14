import type { BiliPollerConfig, BiliWhitelistUser } from '../types.js';
import type { HttpLlmService } from './contracts.js';
import { ModelSelectionError, validateModelSelection } from '../model-selection.js';
import { HttpError, requireInteger, requireText } from './utils.js';

function object(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${name} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

export function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new HttpError(400, `${name} 必须是布尔值`);
  return value;
}

export function text(value: unknown, name: string, max: number, allowEmpty = false): string {
  const result = allowEmpty && typeof value === 'string' ? value : requireText(value, name);
  if (result.length > max || result.includes('\0')) throw new HttpError(400, `${name} 过长或包含非法字符`);
  return result;
}

export function whitelistUser(value: unknown): BiliWhitelistUser {
  const user = object(value, '白名单用户');
  return {
    mid: requireInteger(user.mid, 'mid'),
    uname: text(user.uname, 'uname', 256),
    face: user.face === undefined ? '' : text(user.face, 'face', 4096, true),
    sign: user.sign === undefined ? '' : text(user.sign, 'sign', 4096, true),
  };
}

/** Copy only explicitly validated fields. Unknown/UI-only properties never reach persistence. */
export async function parsePollerConfig(
  body: Record<string, unknown>, getLlm: () => HttpLlmService | undefined,
): Promise<Partial<BiliPollerConfig>> {
  const config: Partial<BiliPollerConfig> = {};
  for (const key of ['enableReply', 'enableAt', 'autoLikeOnReply', 'enableWhitelist'] as const) {
    if (Object.hasOwn(body, key)) config[key] = boolean(body[key], key);
  }
  const ranges = {
    pollIntervalSeconds: [3, 86_400],
    imageDownloadTimeoutMs: [1000, 60_000],
    imageDownloadMaxBytes: [64 * 1024, 32 * 1024 * 1024],
    imageDownloadMaxCount: [0, 10],
  } as const;
  for (const key of Object.keys(ranges) as Array<keyof typeof ranges>) {
    if (Object.hasOwn(body, key)) config[key] = requireInteger(body[key], key, ...ranges[key]);
  }
  if (Object.hasOwn(body, 'whitelist')) {
    if (!Array.isArray(body.whitelist) || body.whitelist.length > 5000) {
      throw new HttpError(400, 'whitelist 必须是不超过 5000 项的数组');
    }
    config.whitelist = body.whitelist.map(whitelistUser);
  }
  if (Object.hasOwn(body, 'systemPrompt')) config.systemPrompt = text(body.systemPrompt, 'systemPrompt', 256 * 1024, true);
  if (Object.hasOwn(body, 'targetWorkspacePath')) {
    config.targetWorkspacePath = text(body.targetWorkspacePath, 'targetWorkspacePath', 32_768, true);
  }
  if (Object.hasOwn(body, 'modelSelection')) {
    try { config.modelSelection = await validateModelSelection(getLlm(), body.modelSelection); }
    catch (error) {
      if (error instanceof ModelSelectionError) throw new HttpError(error.kind === 'unavailable' ? 503 : 400, error.message);
      throw error;
    }
  }
  return config;
}
