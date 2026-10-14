import type { RegisterTool, ToolManager, ToolRegistry } from './shared.js';
import { registerCommentTools } from './comments.js';
import { registerContentTools } from './content.js';
import { registerDiscoveryTools } from './discovery.js';
import { registerDynamicTools } from './dynamics.js';
import { registerLibraryTools } from './library.js';
import { registerUserTools } from './users.js';
import { registerVideoTools } from './video.js';

/** Register exactly 24 existing names. Roll back partial registration and dispose idempotently. */
export function registerBilibiliTools(registry: ToolRegistry, manager: ToolManager): () => void {
  const registrations: Array<() => void> = [];
  const dispose = () => {
    let release: (() => void) | undefined;
    while ((release = registrations.pop())) {
      try { release(); } catch { /* continue releasing the remaining tools */ }
    }
  };
  const register: RegisterTool = definition => {
    const release = registry.register(definition);
    if (typeof release === 'function') registrations.push(release);
  };
  try {
    for (const domain of [registerDiscoveryTools, registerVideoTools, registerCommentTools,
      registerUserTools, registerLibraryTools, registerDynamicTools, registerContentTools]) {
      domain(register, manager);
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
