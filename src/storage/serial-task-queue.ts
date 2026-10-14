/** 小型有界串行队列：失败不阻塞下一项，也不留下无人处理的拒绝。 */
export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(private readonly capacity = 32) {}

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.pending >= this.capacity) return Promise.reject(new Error('凭据操作过多，请稍后重试'));
    this.pending++;
    const result = this.tail.then(operation);
    this.tail = result.then(() => { this.pending--; }, () => { this.pending--; });
    return result;
  }
}
