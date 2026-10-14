import type { BiliClient } from '@seiuna/bilibili-api';
import { VaultService } from './vault-service.js';
import { getLogger } from './command/logger.js';
import { createMemoryClient, getCredentials, readNavUser } from './auth/sdk-client.js';
import { generateQrcode, pollQrcode } from './auth/qrcode-login.js';
import { TempAuthStore } from './auth/temp-auth-store.js';
import { SerialTaskQueue } from './storage/serial-task-queue.js';
import type {
  BiliUserInfo, DecryptedBiliCredentials, QrcodeGenerateResponse,
  QrcodePollResponse, VaultAccountSummary, VaultStatusResponse,
} from './types.js';

const logger = getLogger('BiliClientManager');

export class BilibiliClientManager {
  private static instance: BilibiliClientManager | null = null;

  public client: BiliClient<any>;
  public isUnlocked = false;
  public cachedUser: BiliUserInfo | null = null;
  public accountSummary: VaultAccountSummary | null = null;

  private readonly tempAuthTokens = new TempAuthStore();
  private readonly mutations = new SerialTaskQueue();
  private readonly polls = new Map<string, Promise<QrcodePollResponse>>();
  private activeMasterPassword: string | null = null;
  private sessionRevision = 0;
  private qrcodeRevision = 0;

  private constructor() {
    this.client = createMemoryClient(() => this.sessionRevision);
    // SDK 的持久化重定向到加密 vault；remember 的独立 key 文件仍是明文解锁材料。
    // 捕获调用时快照并串行写入；错误必须传给调用者，不能伪装成持久化成功。
    this.client.config.save = () => {
      if (!this.isUnlocked || !this.activeMasterPassword || !this.accountSummary) return Promise.resolve();
      const revision = this.sessionRevision;
      const password = this.activeMasterPassword;
      const credentials = getCredentials(this.client);
      const account = { ...this.accountSummary };
      return this.mutations.run(async () => {
        if (revision !== this.sessionRevision || !this.isUnlocked) return;
        await VaultService.encryptAndSave(password, credentials, account);
      });
    };
  }

  static getInstance(): BilibiliClientManager {
    return this.instance ??= new BilibiliClientManager();
  }

  /** 启动时使用本地 key 或显式环境密码；不改变用户已经选择的记住密码设置。 */
  async initOnStartup(): Promise<void> {
    return this.mutations.run(async () => {
      if (!await VaultService.hasVault()) return;
      this.accountSummary = await VaultService.readSummary();
      const password = await VaultService.getAutoUnlockPassword() || process.env.BILIBILI_VAULT_PWD;
      if (!password) return;
      try {
        await this.unlockInternal(password);
        logger.info('凭据已自动解密，账号就绪');
      } catch {
        logger.warn('自动解密或凭据验证失败，请手动解锁或重新扫码');
      }
    });
  }

  async getStatus(): Promise<VaultStatusResponse> {
    const hasVault = await VaultService.hasVault();
    if (!hasVault) return { hasVault: false, isUnlocked: false, user: null, accountSummary: null };
    if (!this.isUnlocked && !this.accountSummary) this.accountSummary = await VaultService.readSummary();
    return {
      hasVault: true, isUnlocked: this.isUnlocked,
      user: this.isUnlocked ? this.cachedUser : null, accountSummary: this.accountSummary,
    };
  }

  /** 候选凭据先在隔离的内存客户端验证，成功后才提交状态和记住密码设置。 */
  unlock(password: string, remember = true): Promise<BiliUserInfo> {
    return this.mutations.run(() => this.unlockInternal(password, remember));
  }

  private async unlockInternal(password: string, remember?: boolean): Promise<BiliUserInfo> {
    const credentials = await VaultService.decrypt(password);
    const candidate = createMemoryClient();
    // 验证阶段不触发 SDK 的自动 refresh 写请求；过期凭据交由 UI 重新扫码。
    candidate.config.data.cookie = credentials.cookie;
    candidate.config.data.mid = credentials.mid;
    const user = await readNavUser(candidate);
    if (remember === true) await VaultService.saveAutoUnlockPassword(password);
    if (remember === false) await VaultService.removeAutoUnlockPassword();
    this.activate({ ...credentials, cookie: candidate.config.data.cookie, mid: user.mid }, user, password);
    return user;
  }

  generateQrcode(): Promise<QrcodeGenerateResponse> {
    return generateQrcode();
  }

  /** 同一二维码的并发轮询合并，全部在途轮询有界，退出后旧结果不能重新激活。 */
  pollQrcode(qrcodeKey: string): Promise<QrcodePollResponse> {
    const existing = this.polls.get(qrcodeKey);
    if (existing) return existing;
    if (this.polls.size >= 16) {
      return Promise.resolve({ code: -1, status: 'error', message: '二维码轮询过多，请稍后重试' });
    }
    const revision = this.qrcodeRevision;
    const operation = pollQrcode(qrcodeKey).then(({ response, record }) => {
      if (revision !== this.qrcodeRevision) {
        return { code: -1, status: 'error' as const, message: '登录操作已取消，请重新扫码' };
      }
      if (record) response.tempToken = this.tempAuthTokens.add(record);
      return response;
    }).finally(() => { this.polls.delete(qrcodeKey); });
    this.polls.set(qrcodeKey, operation);
    return operation;
  }

  /** 设置密码与消费 token 串行执行，失败可重试，成功的 token 不能重复使用。 */
  setupPassword(tempToken: string, password: string, remember = true): Promise<BiliUserInfo> {
    return this.mutations.run(async () => {
      const record = this.tempAuthTokens.get(tempToken);
      if (!record) throw new Error('临时认证凭据已失效或不存在，请重新扫码');
      if (!password.trim()) throw new Error('密码不能为空');
      // 先撤销旧自动解锁材料。两个独立文件不构成跨文件原子事务：失败时不激活内存。
      await VaultService.removeAutoUnlockPassword();
      await VaultService.encryptAndSave(password, record.credentials, record.account);
      try {
        if (remember) await VaultService.saveAutoUnlockPassword(password);
      } catch (error) {
        // vault 已替换；旧会话不能继续把旧密码/账号写回新 vault。token 保留供重试。
        this.clearSession();
        throw error;
      }
      this.activate(record.credentials, record.user, password);
      return record.user;
    });
  }

  logout(): Promise<void> {
    // 即使磁盘删除失败，也立刻丢弃临时授权；运行态仍在串行队列中安全清理。
    this.qrcodeRevision++;
    this.tempAuthTokens.clear();
    return this.mutations.run(async () => {
      this.clearSession();
      await VaultService.removeVault();
    });
  }

  private clearSession(): void {
    this.sessionRevision++;
    this.isUnlocked = false;
    this.cachedUser = null;
    this.accountSummary = null;
    this.activeMasterPassword = null;
    this.client.config.data = { cookie: '', refreshToken: '' };
  }

  private activate(credentials: DecryptedBiliCredentials, user: BiliUserInfo, password: string): void {
    this.sessionRevision++;
    this.qrcodeRevision++;
    this.tempAuthTokens.clear();
    this.client.config.data = { ...credentials };
    this.activeMasterPassword = password;
    this.cachedUser = user;
    this.accountSummary = { mid: user.mid, uname: user.uname, face: user.face };
    this.isUnlocked = true;
  }

  /** 公共 client 对象身份稳定，现有 SDK API、实体和测试引用继续可用。 */
  getClient(): BiliClient<any> {
    return this.client;
  }

  requireAuthedClient(): BiliClient<any> {
    if (!this.isUnlocked) {
      throw new Error('Bilibili 凭据尚未解锁！请在 DSH 界面点击顶部药丸输入主密码进行动态解密。');
    }
    return this.client;
  }
}
