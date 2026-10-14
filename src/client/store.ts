import { useSyncExternalStore } from 'react';
import { createBiliStore, type BiliState } from './auth-store.js';

export const biliStore = createBiliStore();

/** React rechecks snapshots when subscribing, avoiding missed render/effect updates. */
export function useBiliStore(): BiliState {
  return useSyncExternalStore(biliStore.subscribe, biliStore.getState, biliStore.getState);
}
