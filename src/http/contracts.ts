import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BilibiliClientManager } from '../client-manager.js';
import type { PollerService } from '../poller-service.js';

export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export interface HttpServer {
  register(route: { kind: 'exact'; path: string; handler: HttpHandler }): () => void;
}

export type HttpManager = Pick<BilibiliClientManager,
  'getStatus' | 'generateQrcode' | 'pollQrcode' | 'setupPassword' | 'unlock' | 'logout'>;
export type HttpPoller = Pick<PollerService,
  'getConfig' | 'getSystemPrompt' | 'getPromptFilePath' | 'saveConfig' |
  'getRecentMessages' | 'clearRecentMessages' | 'getFollowings' | 'listWorkspaces' |
  'searchUser' | 'addWhitelistUser' | 'removeWhitelistUser'>;

export type { ModelService as HttpLlmService } from '../model-selection.js';
import type { ModelService as HttpLlmService } from '../model-selection.js';

export interface HttpDependencies {
  webServer: HttpServer;
  manager: HttpManager;
  poller: HttpPoller;
  getLlm(): HttpLlmService | undefined;
  /** Capture the current login generation before awaiting the manager. */
  beginLogin(): () => void;
  stopPolling(): void;
}
