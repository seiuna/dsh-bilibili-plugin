import fs from 'node:fs/promises';
import path from 'node:path';
import type { BiliProcessedMessageItem } from '../types.js';

function isRecentMessage(value: unknown): value is BiliProcessedMessageItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<BiliProcessedMessageItem>;
  return typeof item.id === 'string' && typeof item.time === 'number' && Number.isFinite(item.time)
    && typeof item.sourceType === 'string' && typeof item.message === 'string'
    && !!item.user && typeof item.user.mid === 'string' && typeof item.user.uname === 'string'
    && ['processing', 'replied', 'command_replied', 'failed', 'ignored'].includes(item.status ?? '')
    && (item.images === undefined || (Array.isArray(item.images) && item.images.every(image => typeof image === 'string')));
}

/** UI history is best effort, unlike the fail-closed delivery dedup journal. */
export class RecentMessageStore {
  private items: BiliProcessedMessageItem[] = [];
  private writes: Promise<void> = Promise.resolve();
  private revision = 0;
  private loadTask?: Promise<void>;
  constructor(private readonly file: () => string, private readonly warn: (message: string) => void,
    private readonly limit = 30) {}

  async load(): Promise<void> {
    if (!this.loadTask) this.loadTask = (async () => {
      const revision = this.revision;
      try {
        const data: unknown = JSON.parse(await fs.readFile(this.file(), 'utf8'));
        if (this.revision !== revision) return; // New in-memory actions win over stale disk.
        if (!Array.isArray(data)) throw new Error('最近记录格式错误');
        this.items = data.filter(isRecentMessage).slice(0, this.limit);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warn('最近消息记录读取失败，忽略损坏历史');
      }
    })();
    await this.loadTask;
  }

  private save(): void {
    this.revision++;
    const file = this.file(), contents = JSON.stringify(this.items);
    this.writes = this.writes.then(async () => {
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file + '.tmp', contents, 'utf8');
        await fs.rename(file + '.tmp', file);
      } catch {
        await fs.rm(file + '.tmp', { force: true }).catch(() => {});
        this.warn('最近消息记录保存失败，不影响可靠去重记录');
      }
    });
  }

  add(item: BiliProcessedMessageItem): void {
    const copy = structuredClone(item);
    const index = this.items.findIndex(existing => existing.id === item.id);
    if (index >= 0) this.items[index] = { ...this.items[index], ...copy };
    else this.items.unshift(copy);
    this.items = this.items.slice(0, this.limit);
    this.save();
  }

  update(id: string, patch: Partial<BiliProcessedMessageItem>): void {
    const item = this.items.find(item => item.id === id);
    if (item) { Object.assign(item, structuredClone(patch)); this.save(); }
  }

  list(): BiliProcessedMessageItem[] { return structuredClone(this.items); }
  clear(): void { this.items = []; this.save(); }
  async flush(): Promise<void> { await this.writes; }
}
