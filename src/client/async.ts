/** Tracks latest-only reads, including transports that ignore AbortSignal. */
export function createLatestRequest() {
  let current: AbortController | undefined;
  return {
    begin() {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      return {
        signal: controller.signal,
        isCurrent: () => current === controller && !controller.signal.aborted,
      };
    },
    cancel() {
      current?.abort();
      current = undefined;
    },
  };
}

/** Fixed delay after completion, not setInterval: at most one request per loop. */
export function startSerialPolling(
  task: (signal: AbortSignal) => Promise<boolean>,
  onError: (error: unknown) => void,
  intervalMs: number,
): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    controller.abort();
    if (timer !== undefined) clearTimeout(timer);
  };
  const run = async () => {
    try {
      const again = await task(controller.signal);
      if (!controller.signal.aborted && again) timer = setTimeout(() => { void run(); }, intervalMs);
    } catch (error) {
      if (!controller.signal.aborted) {
        stop();
        onError(error);
      }
    }
  };
  void run();
  return stop;
}
