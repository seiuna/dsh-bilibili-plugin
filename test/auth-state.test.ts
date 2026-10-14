import { afterEach, describe, expect, it, vi } from 'vitest';
import { TempAuthStore } from '../src/auth/temp-auth-store.js';
import { SerialTaskQueue } from '../src/storage/serial-task-queue.js';

const record = {
  credentials: { cookie: 'SESSDATA=synthetic', refreshToken: 'synthetic' },
  account: { mid: 42, uname: 'offline', face: '' },
  user: { mid: 42, uname: 'offline', face: '', level: 1, coins: 0, vipType: 0 },
};

afterEach(() => vi.useRealTimers());

describe('临时认证生命周期与有界串行操作', () => {
  it('token 随机、达到上限淘汰最老记录，显式 clear 释放全部', () => {
    const store = new TempAuthStore(2);
    const first = store.add(record);
    const second = store.add(record);
    const third = store.add(record);
    expect(second).not.toBe(third);
    expect(store.get(first)).toBeUndefined();
    expect(store.get(second)).toBe(record);
    store.clear();
    expect(store.get(second)).toBeUndefined();
    expect(store.get(third)).toBeUndefined();
  });

  it('闲置 token 到期主动清理且边界时刻拒绝访问', async () => {
    vi.useFakeTimers();
    const store = new TempAuthStore(2, 100);
    const token = store.add(record);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(store.get(token)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('删除 token 后释放计时器且不能再消费', () => {
    vi.useFakeTimers();
    const store = new TempAuthStore();
    const token = store.add(record);
    store.delete(token);
    expect(store.get(token)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('队列按提交顺序执行，失败不污染后续项，超过容量明确拒绝', async () => {
    const queue = new SerialTaskQueue(2);
    const events: number[] = [];
    const first = queue.run(async () => { events.push(1); throw new Error('first-failed'); });
    const second = queue.run(async () => { events.push(2); return 'second'; });
    const overflow = queue.run(async () => 'overflow');
    const settled = await Promise.allSettled([first, second, overflow]);
    expect(settled.map(result => result.status)).toEqual(['rejected', 'fulfilled', 'rejected']);
    expect(events).toEqual([1, 2]);
    expect(await queue.run(async () => 'recovered')).toBe('recovered');
  });
});
