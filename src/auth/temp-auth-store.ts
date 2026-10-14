import crypto from 'node:crypto';
import type { BiliUserInfo, DecryptedBiliCredentials, VaultAccountSummary } from '../types.js';

export interface TempAuthRecord {
  credentials: DecryptedBiliCredentials;
  account: VaultAccountSummary;
  user: BiliUserInfo;
}

/** 有界、短期且只消费一次的扫码结果；过期时主动释放敏感对象。 */
export class TempAuthStore {
  private readonly records = new Map<string, { record: TempAuthRecord; expiresAt: number }>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly capacity = 16, private readonly ttlMs = 5 * 60_000) {}

  add(record: TempAuthRecord): string {
    this.prune();
    if (this.records.size >= this.capacity) {
      this.records.delete(this.records.keys().next().value!);
    }
    const token = crypto.randomBytes(24).toString('hex');
    this.records.set(token, { record, expiresAt: Date.now() + this.ttlMs });
    this.schedule();
    return token;
  }

  get(token: string): TempAuthRecord | undefined {
    this.prune();
    return this.records.get(token)?.record;
  }

  delete(token: string): void {
    this.records.delete(token);
    this.schedule();
  }

  clear(): void {
    this.records.clear();
    this.schedule();
  }

  private prune(): void {
    for (const [token, entry] of this.records) {
      if (entry.expiresAt <= Date.now()) this.records.delete(token);
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const first = this.records.values().next().value;
    if (!first) return;
    this.timer = setTimeout(() => this.prune(), Math.max(1, first.expiresAt - Date.now()));
    this.timer.unref?.();
  }
}
