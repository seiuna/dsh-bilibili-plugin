import type { VaultStatusResponse } from '../types.js';
import { fetchAuthStatus } from './api.js';
import { createLatestRequest } from './async.js';
import { errorMessage } from './request.js';

export interface BiliState {
  isOpen: boolean;
  status: VaultStatusResponse;
  isLoading: boolean;
  error: string | null;
}

/** Independent instances make store concurrency testable without mounting React. */
export function createBiliStore(loadStatus = fetchAuthStatus) {
  let state: BiliState = {
    isOpen: false,
    status: { hasVault: false, isUnlocked: false, user: null, accountSummary: null },
    isLoading: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  const requests = createLatestRequest();
  const update = (patch: Partial<BiliState>) => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };
  return {
    getState: () => state,
    open: () => update({ isOpen: true }),
    close: () => update({ isOpen: false }),
    setIsOpen: (isOpen: boolean) => update({ isOpen }),
    async refresh(): Promise<boolean> {
      const request = requests.begin();
      update({ isLoading: true, error: null });
      try {
        const status = await loadStatus(request.signal);
        if (!request.isCurrent()) return false;
        update({ status, isLoading: false, error: null });
        return true;
      } catch (error) {
        if (request.isCurrent()) update({ isLoading: false, error: errorMessage(error, '获取账号状态失败') });
        return false;
      }
    },
    setStatus(status: VaultStatusResponse): void {
      requests.cancel();
      update({ status, isLoading: false, error: null });
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
