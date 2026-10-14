interface Task {
  key: string;
  controller: AbortController;
  run: (signal: AbortSignal) => Promise<void>;
  timer: ReturnType<typeof setTimeout>;
  started: boolean;
}

/** Bounded per-content lanes. A slow model never holds the global feed poll open. */
export class DispatchQueue {
  private readonly tasks = new Set<Task>();
  private readonly activeKeys = new Set<string>();
  private readonly idleWaiters = new Set<() => void>();

  constructor(private readonly onError: (error: unknown) => void,
    private readonly limit = 100, private readonly timeoutMs = 10 * 60_000) {}

  get hasCapacity(): boolean { return this.tasks.size < this.limit; }

  enqueue(key: string, run: Task['run']): boolean {
    if (!this.hasCapacity) return false;
    const task: Task = { key, run, controller: new AbortController(), started: false,
      timer: setTimeout(() => this.cancel(task, new Error('B站消息处理超时')), this.timeoutMs) };
    task.timer.unref?.();
    this.tasks.add(task);
    this.startNext(key);
    return true;
  }

  private startNext(key: string): void {
    if (this.activeKeys.has(key)) return;
    const task = [...this.tasks].find(task => task.key === key && !task.started);
    if (!task) return;
    task.started = true;
    this.activeKeys.add(key);
    // Keep the lane reserved until the underlying call settles, even after timeout:
    // aborting a Promise does not prove that its model round actually completed.
    void Promise.resolve().then(() => {
      task.controller.signal.throwIfAborted();
      return task.run(task.controller.signal);
    }).catch(error => {
      if (!task.controller.signal.aborted) this.onError(error);
    }).finally(() => {
      clearTimeout(task.timer);
      this.tasks.delete(task);
      this.activeKeys.delete(key);
      this.startNext(key);
      this.notifyIdle();
    });
  }

  private cancel(task: Task, reason: Error): void {
    clearTimeout(task.timer);
    if (!task.controller.signal.aborted) task.controller.abort(reason);
    if (!task.started) this.tasks.delete(task);
    this.notifyIdle();
  }

  stop(): void {
    for (const task of this.tasks) this.cancel(task, new Error('B站消息轮询已停止'));
  }

  /** Wait for live tasks only; cancelled non-cooperative calls retain lane/capacity guards. */
  whenIdle(): Promise<void> {
    if (![...this.tasks].some(task => !task.controller.signal.aborted)) return Promise.resolve();
    return new Promise(resolve => this.idleWaiters.add(resolve));
  }

  private notifyIdle(): void {
    if ([...this.tasks].some(task => !task.controller.signal.aborted)) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}
