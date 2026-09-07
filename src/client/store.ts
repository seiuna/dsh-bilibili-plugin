import { useState, useEffect } from 'react';
import type { VaultStatusResponse } from '../types.js';
import { fetchAuthStatus } from './api.js';

interface BiliState {
  isOpen: boolean;
  status: VaultStatusResponse;
  isLoading: boolean;
}

const defaultStatus: VaultStatusResponse = {
  hasVault: false,
  isUnlocked: false,
  user: null,
  accountSummary: null,
};

let state: BiliState = {
  isOpen: false,
  status: defaultStatus,
  isLoading: false,
};

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export const biliStore = {
  getState(): BiliState {
    return state;
  },

  open(): void {
    state = { ...state, isOpen: true };
    notify();
  },

  close(): void {
    state = { ...state, isOpen: false };
    notify();
  },

  setIsOpen(isOpen: boolean): void {
    state = { ...state, isOpen };
    notify();
  },

  async refresh(): Promise<void> {
    state = { ...state, isLoading: true };
    notify();
    try {
      const status = await fetchAuthStatus();
      state = { ...state, status, isLoading: false };
    } catch {
      state = { ...state, isLoading: false };
    }
    notify();
  },

  setStatus(status: VaultStatusResponse): void {
    state = { ...state, status };
    notify();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useBiliStore(): BiliState {
  const [snap, setSnap] = useState(biliStore.getState());

  useEffect(() => {
    return biliStore.subscribe(() => {
      setSnap(biliStore.getState());
    });
  }, []);

  return snap;
}
