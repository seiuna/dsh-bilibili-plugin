export interface BiliUserInfo {
  mid: number;
  uname: string;
  face: string;
  level: number;
  coins: number;
  vipType: number;
}

export interface VaultAccountSummary {
  mid: number;
  uname: string;
  face: string;
}

export interface VaultStatusResponse {
  hasVault: boolean;
  isUnlocked: boolean;
  user: BiliUserInfo | null;
  accountSummary?: VaultAccountSummary | null;
}

export interface QrcodeGenerateResponse {
  qrcodeKey: string;
  url: string;
  qrcodeDataUrl: string;
}

export type QrcodePollStatusCode = 'waiting' | 'scanned' | 'success' | 'expired' | 'error';

export interface QrcodePollResponse {
  code: number;
  status: QrcodePollStatusCode;
  message: string;
  tempToken?: string;
  user?: BiliUserInfo | null;
}

export interface VaultEncryptedRecord {
  version: 1;
  createdAt: number;
  updatedAt: number;
  account: VaultAccountSummary;
  crypto: {
    algorithm: 'aes-256-gcm';
    kdf: 'pbkdf2-sha256';
    iterations: number;
    salt: string;
    iv: string;
    authTag: string;
    verifier: string;
    ciphertext: string;
  };
}

export interface DecryptedBiliCredentials {
  cookie: string;
  refreshToken: string;
  mid?: number;
}

export interface BiliWhitelistUser {
  mid: number;
  uname: string;
  face: string;
  sign?: string;
}

export interface BiliWorkspaceItem {
  id: string;
  title: string;
  path: string;
}

export interface BiliPollerConfig {
  enableReply: boolean;
  enableAt: boolean;
  autoLikeOnReply: boolean;
  enableWhitelist: boolean;
  pollIntervalSeconds: number;
  imageDownloadTimeoutMs: number;
  imageDownloadMaxBytes: number;
  imageDownloadMaxCount: number;
  whitelist: BiliWhitelistUser[];
  systemPrompt?: string;
  targetWorkspacePath?: string;
  modelSelection?: { provider: string; model: string; reasoningEffort?: string } | null;
}

export interface BiliProcessedMessageItem {
  id: string;
  time: number;
  sourceType: string;
  sourceTitle?: string;
  uri?: string;
  user: {
    mid: string;
    uname: string;
    avatar?: string;
  };
  message: string;
  images?: string[];
  status: 'processing' | 'replied' | 'command_replied' | 'failed' | 'ignored';
  replyText?: string;
  error?: string;
}

export interface BiliSessionContext {
  sessionType: 'command' | 'chat';
  sourceType: 'video' | 'dynamic' | 'article' | string;
  sourceId: string | number;
  subjectId: string | number;
  businessId: number;
  rootId: string | number;
  notifyType?: 'at' | 'reply';
  parentCommentId?: string;
  videoBvid?: string;
  dynamicId?: string;
  /** Notification snapshots only; not authenticated author/body records. */
  targetReplyContent?: string;
  rootReplyContent?: string;
  root: string | number;
  message: string;
  originMessage: string;
  actualVideoTitle?: string;
  dynamicBodyExcerpt?: string;
  rootComment?: { id: string; authorId: string; text: string };
  parentComment?: { id: string; authorId: string; text: string };
  botRepliedComment?: { id: string; authorId: string; text: string };
  title: string;
  uri: string;
  userId: string;
  userName: string;
  userAvatar: string;
  event: {
    userId: string;
    userName: string;
    command?: string;
    args?: string[];
    adapter: 'bilibili';
    raw: any;
  };
  reply: (text: string) => Promise<any>;
  messageFunc: (text: string) => Promise<any>;
  like: (unlike?: boolean) => Promise<any>;
  /** 当前 sourceId 评论详情中的附件图片；不包含动态封面或父评论图片。 */
  images?: string[];
  [key: string]: any;
}

