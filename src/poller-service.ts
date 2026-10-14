import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  CommentArea,
  ReplyType,
  MessageAPI,
} from '@seiuna/bilibili-api';
import type {
  BiliPollerConfig,
  BiliSessionContext,
  BiliWhitelistUser,
  BiliWorkspaceItem,
  BiliProcessedMessageItem,
} from './types.js';
import { BilibiliClientManager } from './client-manager.js';
import { commandRegistry } from './command/index.js';
import { getLogger } from './command/logger.js';

import { CommentContextResolver } from './poller/comment-context.js';
import { commentId, commentKey, isCommentBusiness } from './poller/identifiers.js';
import { DispatchQueue } from './poller/dispatch-queue.js';
import { RecentMessageStore } from './poller/recent-messages.js';
import { getFollowings as getFollowingUsers, searchUser as searchBiliUser } from './poller/users.js';
import { PollerConfigStore } from './poller/config-store.js';

const logger = getLogger('BiliPollerService');

export const DEFAULT_BILIBILI_PROMPT = `你是一个活跃在哔哩哔哩（B站）的智能看板娘/AI伙伴。
【性格与语言风格】：
1. 语言亲切、风趣幽默、充满年轻活力，熟知B站常见文化和社区梗（如：干杯、三连、下次一定、名场面、催更等）。
2. 高情商回复，懂得夸赞观众、体贴互动，切勿说教，切勿使用客服式生硬机械的套话。
3. 严格精简：由于发布在评论区楼中楼，回复字数严格控制在 100 字以内，言简意赅、点到即止。
4. 禁止输出任何 Markdown 标题（#）、多余代码块或思维链标签，直接输出准备发表的纯文本评论内容。`;

export type DshDispatchHandler = (
  context: BiliSessionContext,
) => Promise<string | void> | string | void;

export class PollerService {
  private static instance: PollerService | null = null;

  private config: BiliPollerConfig = {
    enableReply: true,
    enableAt: true,
    autoLikeOnReply: true,
    enableWhitelist: false,
    pollIntervalSeconds: 3,
    imageDownloadTimeoutMs: 10_000,
    imageDownloadMaxBytes: 8 * 1024 * 1024,
    imageDownloadMaxCount: 5,
    whitelist: [],
    systemPrompt: DEFAULT_BILIBILI_PROMPT,
  };

  private readonly configStore = new PollerConfigStore(() => this.getConfigPath(), () => this.getPromptFilePath(), this.config);
  private timer: ReturnType<typeof setInterval> | null = null;
  private runtimeOwner: symbol | null = null;
  private isPolling = false;
  private processedIds: Set<string> = new Set();
  private processedOrder: string[] = [];
  private readonly maxProcessedCache = 2000;
  private processedLoaded = false;

  private readonly recent = new RecentMessageStore(() => this.getConfigPath() + '.recent.json', message => logger.warn(message));
  private readonly dispatchQueue = new DispatchQueue(() => logger.warn('后台消息分发失败'));
  private readonly dispatchSignals = new WeakMap<BiliSessionContext, AbortSignal>();
  private pollGeneration = 0;

  private async loadProcessed(): Promise<void> {
    if (this.processedLoaded) return;
    try {
      const ids: unknown = JSON.parse(await fs.readFile(this.getConfigPath() + '.processed.json', 'utf8'));
      if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) throw new Error('去重记录格式错误');
      for (const id of ids.slice(-this.maxProcessedCache)) if (!this.processedIds.has(id)) this.markProcessed(id);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await this.recent.load();
    this.processedLoaded = true;
  }

  private async saveProcessedOrder(order: string[]): Promise<void> {
    const file = this.getConfigPath() + '.processed.json';
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file + '.tmp', JSON.stringify(order), 'utf8');
    await fs.rename(file + '.tmp', file);
  }

  private async commitProcessed(ids: Array<string | undefined>): Promise<void> {
    const next = [...this.processedOrder];
    const seen = new Set(next);
    for (const id of ids) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      next.push(id);
    }
    const bounded = next.slice(-this.maxProcessedCache);
    await this.saveProcessedOrder(bounded);
    this.processedOrder = bounded;
    this.processedIds = new Set(bounded);
  }

  addRecentMessage(item: BiliProcessedMessageItem): void { this.recent.add(item); }

  updateRecentMessage(id: string, patch: Partial<BiliProcessedMessageItem>): void { this.recent.update(id, patch); }

  getRecentMessages(): BiliProcessedMessageItem[] { return this.recent.list(); }

  clearRecentMessages(): void { this.recent.clear(); }

  async flushRecentMessages(): Promise<void> { await this.recent.flush(); }

  async waitForDispatches(): Promise<void> { await this.dispatchQueue.whenIdle(); }

  /** DSH 二级分发自定义钩子 */
  private dshHandler: DshDispatchHandler | null = null;
  private dshHandlerToken: symbol | null = null;

  private constructor(private manager: BilibiliClientManager) {}

  static getInstance(manager?: BilibiliClientManager): PollerService {
    if (!this.instance) {
      this.instance = new PollerService(manager || BilibiliClientManager.getInstance());
    }
    return this.instance;
  }

  /** 获取轮询配置文件路径 */
  getConfigPath(): string {
    if (process.env.BILIBILI_POLLER_CONFIG_PATH) {
      return path.resolve(process.env.BILIBILI_POLLER_CONFIG_PATH);
    }
    const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
    return path.join(dshHome, 'storages', 'bilibili-poller.json');
  }

  /** 获取人设独立 Markdown 文件路径 (允许用户外部直接编辑) */
  getPromptFilePath(): string {
    if (process.env.BILIBILI_PROMPT_PATH) {
      return path.resolve(process.env.BILIBILI_PROMPT_PATH);
    }
    const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
    return path.join(dshHome, 'storages', 'bilibili-prompt.md');
  }

  /** 独立人设文件按需初始化；空文件是有效的显式清空，不覆盖成默认内容。 */
  async initPromptFile(): Promise<string> { return this.configStore.prompt(); }
  async getSystemPrompt(): Promise<string> { return this.configStore.prompt(); }

  async saveSystemPrompt(promptContent: string): Promise<string> {
    await this.saveConfig({ systemPrompt: promptContent });
    return promptContent;
  }

  /** 损坏/不可读配置不等于不存在；失败时不以默认配置启动轮询。 */
  async loadConfig(): Promise<BiliPollerConfig> {
    this.config = await this.configStore.load();
    return this.getConfig();
  }

  async saveConfig(newConfig: Partial<BiliPollerConfig>): Promise<BiliPollerConfig> {
    return this.updateConfig(newConfig);
  }

  private async updateConfig(patch: Partial<BiliPollerConfig> | ((current: BiliPollerConfig) => Partial<BiliPollerConfig>)): Promise<BiliPollerConfig> {
    this.config = await this.configStore.save(patch);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => { void this.poll().catch(() => logger.warn('消息轮询异常')); }, this.config.pollIntervalSeconds * 1000);
    }
    return this.getConfig();
  }

  getConfig(): BiliPollerConfig { return structuredClone(this.config); }

  /** 注册二级分发到 DSH 的自定义处理器 */
  setDshHandler(handler: DshDispatchHandler | null): () => void {
    if (handler === null) {
      this.dshHandler = null;
      this.dshHandlerToken = null;
      return () => {};
    }
    const token = Symbol('bilibili-dsh-handler');
    this.dshHandler = handler;
    this.dshHandlerToken = token;
    return () => {
      if (this.dshHandlerToken === token) {
        this.dshHandler = null;
        this.dshHandlerToken = null;
      }
    };
  }

  claimRuntime(): symbol {
    const token = Symbol('bilibili-poller-runtime');
    this.runtimeOwner = token;
    return token;
  }

  /** 启动后台轮询定时器 */
  start(owner?: symbol): void {
    if (owner && this.runtimeOwner !== owner) return;
    if (this.timer) return;
    logger.info(`启动消息轮询服务，周期: ${this.config.pollIntervalSeconds}s`);
    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        logger.error('消息轮询异常:', err.message);
      });
    }, Math.max(3000, this.config.pollIntervalSeconds * 1000));

    // 立即执行一次探测
    this.poll().catch(() => {});
  }

  /** 停止后台轮询 */
  stop(owner?: symbol): void {
    if (owner && this.runtimeOwner !== owner) return;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('已停止消息轮询服务');
    }
    this.pollGeneration++;
    this.dispatchQueue.stop();
    if (!owner || this.runtimeOwner === owner) this.runtimeOwner = null;
  }

  /** 单次轮询逻辑 */
  async poll(): Promise<{ processedCount: number }> {
    if (this.isPolling) return { processedCount: 0 };
    if (!this.manager.isUnlocked) {
      return { processedCount: 0 };
    }

    this.isPolling = true;
    const generation = this.pollGeneration;
    let count = 0;
    try {
      await this.loadProcessed();
      const client = this.manager.getClient();
      const rawNotifications: Array<{ type: 'at' | 'reply'; item: any }> = [];
      // Exactly one page per enabled feed; unread counters are not pagination quotas.
      for (const type of ['reply', 'at'] as const) {
        if (!(type === 'reply' ? this.config.enableReply : this.config.enableAt)) continue;
        try {
          const response = type === 'reply' ? await MessageAPI.getReplyFeed(client) : await MessageAPI.getAtFeed(client);
          if (response.code !== 0 || !Array.isArray(response.data?.items)) {
            logger.warn('读取 ' + type + ' feed 失败，code=' + response.code); continue;
          }
          for (const item of response.data.items) rawNotifications.push({ type, item });
        } catch { logger.warn('读取 ' + type + ' feed 失败，继续处理另一类通知'); }
      }

      // 3. 处理并去重
      for (const notif of rawNotifications) {
        if (generation !== this.pollGeneration) break;
        const itemDetail = notif.item?.item;
        const user = notif.item?.user;
        if (!itemDetail || !user) continue;

        const notificationId = commentId(notif.item.id);
        const notificationKey = notificationId ? 'notification:' + notif.type + ':' + notificationId : undefined;
        if (notificationKey && this.processedIds.has(notificationKey)) continue;
        // Non-comment @ notifications must not enter comment reply actions.
        if (!commentId(itemDetail.source_id) || !commentId(itemDetail.subject_id) || !isCommentBusiness(itemDetail.business_id)) {
          if (notificationKey) await this.commitProcessed([notificationKey]);
          continue;
        }
        // 去重 Key: 业务ID_主体ID_源评论ID
        const dedupKey = `${itemDetail.business_id}_${itemDetail.subject_id}_${itemDetail.source_id}`;
        if (this.processedIds.has(dedupKey)) {
          if (notificationKey) await this.commitProcessed([notificationKey]);
          continue;
        }
        // Leave overflow uncommitted so a later feed page may retry it.
        if (!this.dispatchQueue.hasCapacity) break;

        // Persist both identities before any public side effect or background admission.
        await this.commitProcessed([notificationKey, dedupKey]);
        if (generation !== this.pollGeneration) break;

        // 检查白名单
        if (this.config.enableWhitelist) {
          const isWhitelisted = this.config.whitelist.some(
            (w) => commentId(w.mid) !== undefined && commentId(w.mid) === commentId(user.mid),
          );
          if (!isWhitelisted) {
            logger.info(
              `[白名单拦截] 跳过非白名单用户: ${user.nickname} (UID: ${user.mid})`,
            );
            this.addRecentMessage({
              id: dedupKey,
              time: Date.now(),
              sourceType: itemDetail.business || 'video',
              sourceTitle: itemDetail.title || '',
              uri: itemDetail.uri || itemDetail.native_uri || '',
              user: {
                mid: String(user.mid),
                uname: user.nickname || '',
                avatar: user.avatar || '',
              },
              message: itemDetail.source_content || '',
              status: 'ignored',
              error: '非白名单用户',
            });
            continue;
          }
        }

        // 构造 SessionContext
        const sessionCtx = this.buildSessionContext(notif.type, notif.item);

        // 接收到回复给用户点个赞
        if (this.config.autoLikeOnReply) {
          sessionCtx.like().catch((err: any) => {
            logger.warn(`自动点赞失败 [${sessionCtx.userName}]: ${err.message}`);
          });
        }

        // Serialize each content lane while allowing unrelated content and future polls
        // to proceed. The captured context (and outbound target) belongs to this task.
        if (this.dispatchQueue.enqueue(`${sessionCtx.businessId}:${sessionCtx.subjectId}`, async signal => {
          this.dispatchSignals.set(sessionCtx, signal);
          signal.addEventListener('abort', () => this.updateRecentMessage(dedupKey, {
            status: 'failed', error: '消息处理已停止或超时',
          }), { once: true });
          await this.dispatch(sessionCtx);
        })) count++;
      }
    } catch (err: any) {
      logger.error('轮询执行出错:', err.message);
    } finally {
      this.isPolling = false;
    }

    return { processedCount: count };
  }

  private markProcessed(id: string): void {
    if (this.processedIds.has(id)) return;
    this.processedIds.add(id);
    this.processedOrder.push(id);
    if (this.processedOrder.length > this.maxProcessedCache) {
      const oldest = this.processedOrder.shift();
      if (oldest) this.processedIds.delete(oldest);
    }
  }

  /**
   * 构造通用的 BiliSessionContext
   */
  buildSessionContext(
    notifyType: 'at' | 'reply',
    rawNotification: any,
  ): BiliSessionContext {
    const item = rawNotification.item || {};
    const user = rawNotification.user || {};
    const client = this.manager.getClient();

    // 格式化 sourceType
    let sourceType = 'unknown';
    const biz = String(item.business || '').toLowerCase();
    const bizId = Number(item.business_id);
    if (bizId === 1 || biz.includes('video') || biz.includes('archive')) {
      sourceType = 'video';
    } else if (bizId === ReplyType.DYNAMIC || bizId === ReplyType.ALBUM || bizId === 17 || biz.includes('dynamic')) {
      sourceType = 'dynamic';
    } else if (bizId === 12 || biz.includes('article')) {
      sourceType = 'article';
    } else {
      sourceType = item.business || 'video';
    }

    const messageText = item.source_content || '';
    const originText =
      item.target_reply_content || item.root_reply_content || '';

    const rootRpid = commentId(item.root_id) ? item.root_id : item.source_id;

    // 解析出潜在的指令名称与参数
    const trimmed = messageText.trim();
    const parts = (trimmed.startsWith('/') ? trimmed.slice(1) : trimmed).split(
      /\s+/,
    );
    const cmdName = parts[0] || '';
    const cmdArgs = parts.slice(1);

    // 回复动作
    const replyFn = async (replyContent: string) => {
      logger.info(`发送评论回复，字符数: ${replyContent.length}`);
      const area = new CommentArea(client, item.subject_id, item.business_id);
      return area.add(replyContent, rootRpid, item.source_id);
    };

    // 点赞动作
    const likeFn = async (unlike = false) => {
      logger.info(
        `正在为 [${user.nickname}] 的评论点赞 (sourceId: ${item.source_id})`,
      );
      const area = new CommentArea(client, item.subject_id, item.business_id);
      return area.like(item.source_id, unlike);
    };

    // Notification image/pictures describe the subject, not necessarily this comment.
    // Populate only from the exact incoming rpid during asynchronous dispatch.
    const images: string[] = [];

    const sessionContext: BiliSessionContext = {
      sessionType: 'command',
      notifyType,
      sourceType,
      sourceId: item.source_id,
      subjectId: item.subject_id,
      businessId: item.business_id,
      rootId: item.root_id,
      root: rootRpid,
      message: messageText,
      originMessage: originText,
      parentCommentId: commentId(item.target_id),
      targetReplyContent: typeof item.target_reply_content === 'string' ? item.target_reply_content : undefined,
      rootReplyContent: typeof item.root_reply_content === 'string' ? item.root_reply_content : undefined,
      title: item.title || '',
      uri: item.uri || item.native_uri || '',
      userId: String(user.mid || ''),
      userName: user.nickname || '',
      userAvatar: user.avatar || '',
      images,
      event: {
        userId: String(user.mid || ''),
        userName: user.nickname || '',
        command: cmdName,
        args: cmdArgs,
        adapter: 'bilibili',
        raw: rawNotification,
      },
      reply: replyFn,
      messageFunc: replyFn,
      like: likeFn,
    };

    return sessionContext;
  }

  private readonly comments = new CommentContextResolver(() => this.manager.getClient(), message => logger.warn(message));

  async hydrateCommentImages(context: BiliSessionContext): Promise<void> {
    await this.comments.hydrateImages(context);
  }

  async hydrateSourceContext(context: BiliSessionContext): Promise<void> {
    await this.comments.hydrateSource(context);
  }

  async dispatch(context: BiliSessionContext): Promise<void> {
    const signal = this.dispatchSignals.get(context);
    signal?.throwIfAborted();
    await Promise.all([this.hydrateCommentImages(context), this.hydrateSourceContext(context)]);
    signal?.throwIfAborted();
    const rawMsg = context.message?.trim() || '';
    if (!rawMsg && !context.images?.length) return;

    logger.info(`接收评论，类型: ${context.businessId}，字符数: ${rawMsg.length}，图片数: ${context.images?.length ?? 0}`);

    const msgId = commentKey(context);
    const recentItem: BiliProcessedMessageItem = {
      id: msgId,
      time: Date.now(),
      sourceType: context.sourceType,
      sourceTitle: context.actualVideoTitle || context.dynamicBodyExcerpt || context.title || '',
      uri: context.uri || '',
      user: {
        mid: context.userId,
        uname: context.userName,
        avatar: context.userAvatar,
      },
      message: rawMsg,
      images: context.images,
      status: 'processing',
    };
    this.addRecentMessage(recentItem);

    // 包装 reply 方法，记录出站回复内容与状态
    const originalReply = context.reply;
    let hasReplied = false;
    let pendingReply: Promise<any> | undefined;
    context.reply = (replyText: string) => {
      signal?.throwIfAborted();
      // A handler may explicitly reply and also return a string; publish once per turn.
      if (pendingReply) return pendingReply;
      pendingReply = (async () => {
        try {
          const res = await originalReply(replyText);
          hasReplied = true;
          this.updateRecentMessage(msgId, { status: 'replied', replyText });
          return res;
        } catch (err: unknown) {
          this.updateRecentMessage(msgId, { status: 'failed', error: '回复发送失败' });
          throw err;
        }
      })();
      return pendingReply;
    };
    context.messageFunc = context.reply;
    const originalLike = context.like;
    context.like = async unlike => { signal?.throwIfAborted(); return originalLike(unlike); };

    // ── 第一阶段：分发到 command ──
    let handled = false;
    try {
      const result = rawMsg ? await commandRegistry.execute(rawMsg, context) : undefined;
      if (typeof result === 'string' && result.trim()) {
        handled = true;
        await context.reply(result);
        logger.info('Command 阶段响应成功');
      } else if (result && typeof result === 'object') {
        if (result.ok) {
          handled = true;
          if (result.message) {
            await context.reply(result.message);
          }
          logger.info('Command 阶段响应成功');
        } else if (result.type !== 'not_found' && result.type !== 'no_action') {
          // 明确的指令语法错误或参数校验失败，也是由 Command 响应
          handled = true;
          await context.reply(result.message);
          logger.info('Command 阶段已发送参数提示');
        }
      }
    } catch (err: any) {
      signal?.throwIfAborted();
      logger.error('Command 分发执行异常');
      if (pendingReply) throw err; // An ambiguous write failure must not publish a second reply.
    }

    if (handled || hasReplied) {
      return;
    }

    // ── 第二阶段：Command 未触发，分发到 DSH ──
    logger.info(`Command 未触发，进入第二阶段: 分发到 DSH 处理...`);
    const handler = this.dshHandler;
    if (!handler) {
      this.updateRecentMessage(msgId, { status: 'failed', error: 'DSH Agent 服务不可用' });
      throw new Error('DSH Agent 服务不可用');
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        signal?.throwIfAborted();
        const reply = await handler(context);
        signal?.throwIfAborted();
        if (!hasReplied && reply && typeof reply === 'string' && reply.trim()) {
          await context.reply(reply);
          logger.info('DSH 阶段响应回复已发送');
        }
        return;
      } catch (err: any) {
        signal?.throwIfAborted();
        if (pendingReply) throw err;
        lastError = err;
        logger.warn(`DSH 阶段处理失败，第 ${attempt}/3 次尝试`);
      }
    }

    const safeMessage = (lastError as any)?.name === 'BiliModelUnavailableError'
      ? '执行过程中出现错误：模型不可用'
      : '执行过程中出现错误';
    await context.reply(safeMessage);
  }

  /**
   * 获取登录用户的关注列表
   */
  async getFollowings(page = 1, pageSize = 50): Promise<{
    list: BiliWhitelistUser[];
    total: number;
  }> {
    return getFollowingUsers(this.manager.requireAuthedClient(), page, pageSize);
  }

  /**
   * 搜索/查找用户（支持输入 UID 纯数字，或用户名 uname）
   */
  async searchUser(query: string): Promise<BiliWhitelistUser> {
    return searchBiliUser(this.manager.getClient(), query);
  }

  /**
   * 添加用户到白名单
   */
  async addWhitelistUser(user: BiliWhitelistUser): Promise<BiliPollerConfig> {
    const copy = structuredClone(user);
    return this.updateConfig(current => ({ whitelist: current.whitelist.some(item => item.mid === copy.mid)
      ? current.whitelist : [...current.whitelist, copy] }));
  }

  /**
   * 从白名单移除用户
   */
  async removeWhitelistUser(mid: number): Promise<BiliPollerConfig> {
    if (!Number.isSafeInteger(mid) || mid < 1) throw new Error('mid 必须为正安全整数');
    return this.updateConfig(current => ({ whitelist: current.whitelist.filter(item => item.mid !== mid) }));
  }

  /**
   * 列出 DSH 当前已注册的所有工作区
   */
  private workspaceRegistry: any;
  private workspaceRegistryToken: symbol | null = null;

  setWorkspaceRegistry(registry: any): () => void {
    if (registry == null) {
      this.workspaceRegistry = undefined;
      this.workspaceRegistryToken = null;
      return () => {};
    }
    const token = Symbol('bilibili-workspace-registry');
    this.workspaceRegistry = registry;
    this.workspaceRegistryToken = token;
    return () => {
      if (this.workspaceRegistryToken === token) {
        this.workspaceRegistry = undefined;
        this.workspaceRegistryToken = null;
      }
    };
  }

  getArchivedSessionIds(): ReadonlySet<string> {
    const ids: unknown = this.workspaceRegistry?.archivedSessionIds;
    if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) {
      throw new Error('DSH workspaceRegistry 归档状态不可用，停止复用会话');
    }
    return new Set(ids);
  }

  async listWorkspaces(): Promise<BiliWorkspaceItem[]> {
    if (!this.workspaceRegistry) return [];
    return this.workspaceRegistry.list().map((w: any) => ({ id: w.id, title: w.title, path: w.path }));
  }


  /**
   * 解析目标工作区路径：优先使用配置的 targetWorkspacePath，否则自动选取当前最常用的首个活跃工作区
   */
  async resolveTargetWorkspaceCwd(): Promise<string> {
    const configured = this.config.targetWorkspacePath;
    if (configured !== undefined && typeof configured !== 'string') throw new Error('工作区路径必须为字符串');
    const selected = configured?.trim();
    const candidate = selected || (await this.listWorkspaces())[0]?.path || process.cwd();
    if (!path.isAbsolute(candidate)) throw new Error('工作区必须为绝对路径');
    const canonical = await fs.realpath(candidate);
    if (!(await fs.stat(canonical)).isDirectory()) throw new Error(`工作区不是目录: ${candidate}`);
    return canonical;
  }

  /**
   * 将会话绑定到指定工作区（使工作区侧边栏立刻显示该会话）
   */
  async attachSessionToWorkspace(sessionId: string, targetCwd: string): Promise<void> {
    if (!this.workspaceRegistry) throw new Error('DSH workspaceRegistry 服务未就绪');
    const workspace = await this.workspaceRegistry.create(targetCwd);
    await workspace.attachSession(sessionId);
  }
}