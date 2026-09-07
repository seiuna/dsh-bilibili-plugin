import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { BiliClient } from '@seiuna/bilibili-api';
import { VaultService } from './vault-service.js';
import type {
  BiliUserInfo,
  DecryptedBiliCredentials,
  QrcodeGenerateResponse,
  QrcodePollResponse,
  VaultAccountSummary,
  VaultStatusResponse,
} from './types.js';

interface TempAuthRecord {
  credentials: DecryptedBiliCredentials;
  account: VaultAccountSummary;
  user: BiliUserInfo;
  expiresAt: number;
}

export class BilibiliClientManager {
  private static instance: BilibiliClientManager | null = null;

  public client: BiliClient<any>;
  public isUnlocked = false;
  public cachedUser: BiliUserInfo | null = null;
  public accountSummary: VaultAccountSummary | null = null;

  /** 扫码成功后等待设置密码的临时会话 (最多暂存 5 分钟) */
  private tempAuthTokens = new Map<string, TempAuthRecord>();

  /** 内存中缓存的当前主密码（用于会话生命周期内凭证刷新时静默重加密） */
  private activeMasterPassword: string | null = null;

  private constructor() {
    // 初始化无参匿名客户端
    this.client = new BiliClient<any>();
    // 拦截原本默认的磁盘写入，确保磁盘零明文
    this.client.config.save = async () => {
      if (this.isUnlocked && this.activeMasterPassword && this.accountSummary) {
        try {
          const creds: DecryptedBiliCredentials = {
            cookie: this.client.config.data.cookie,
            refreshToken: this.client.config.data.refreshToken,
            mid: this.client.config.data.mid,
          };
          await VaultService.encryptAndSave(
            this.activeMasterPassword,
            creds,
            this.accountSummary,
          );
        } catch {
          // 静默处理重加密失败
        }
      }
    };
  }

  static getInstance(): BilibiliClientManager {
    if (!this.instance) {
      this.instance = new BilibiliClientManager();
    }
    return this.instance;
  }

  /** 启动时初始化：检测本地 vault，自动读取存储密码实现免密解密 */
  async initOnStartup(): Promise<void> {
    const hasVault = await VaultService.hasVault();
    if (!hasVault) {
      return;
    }

    this.accountSummary = await VaultService.readSummary();

    // 优先从 DSH 仓库存储的 key 或环境变量密码中自动解密
    const autoPwd = await VaultService.getAutoUnlockPassword();
    const pwdToUse = autoPwd || process.env.BILIBILI_VAULT_PWD;
    if (pwdToUse) {
      try {
        await this.unlock(pwdToUse, false);
        console.log('[dsh-bilibili-plugin] 凭据已自动解密，账号就绪');
      } catch (err: any) {
        console.warn('[dsh-bilibili-plugin] 自动解密失败:', err.message);
      }
    }
  }

  /** 获取当前运行态状态 */
  async getStatus(): Promise<VaultStatusResponse> {
    const hasVault = await VaultService.hasVault();
    if (!hasVault) {
      return {
        hasVault: false,
        isUnlocked: false,
        user: null,
        accountSummary: null,
      };
    }

    if (!this.isUnlocked) {
      if (!this.accountSummary) {
        this.accountSummary = await VaultService.readSummary();
      }
      return {
        hasVault: true,
        isUnlocked: false,
        user: null,
        accountSummary: this.accountSummary,
      };
    }

    return {
      hasVault: true,
      isUnlocked: true,
      user: this.cachedUser,
      accountSummary: this.accountSummary,
    };
  }

  /** 动态解密凭据并注入内存客户端 */
  async unlock(password: string, remember: boolean = true): Promise<BiliUserInfo> {
    const credentials = await VaultService.decrypt(password);
    this.activeMasterPassword = password;

    if (remember) {
      await VaultService.saveAutoUnlockPassword(password);
    }

    // 注入内存
    this.client.config.data.cookie = credentials.cookie;
    this.client.config.data.refreshToken = credentials.refreshToken;
    if (credentials.mid) {
      this.client.config.data.mid = credentials.mid;
    }

    // 验证并拉取用户信息
    const user = await this.refreshNavUser();
    this.isUnlocked = true;
    this.cachedUser = user;
    this.accountSummary = {
      mid: user.mid,
      uname: user.uname,
      face: user.face,
    };

    return user;
  }

  /** 申请生成登录二维码 (Data URL + Terminal) */
  async generateQrcode(): Promise<QrcodeGenerateResponse> {
    const res = await fetch(
      'https://passport.bilibili.com/x/passport-login/web/qrcode/generate',
      { method: 'GET' },
    );

    if (!res.ok) {
      throw new Error(`申请二维码失败: HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
      code: number;
      message: string;
      data: { qrcode_key: string; url: string };
    };

    if (json.code !== 0) {
      throw new Error(`申请二维码失败: ${json.message}`);
    }

    const { qrcode_key, url } = json.data;
    const qrcodeDataUrl = await QRCode.toDataURL(url, {
      margin: 1,
      width: 256,
      color: { dark: '#000000', light: '#ffffff' },
    });

    return {
      qrcodeKey: qrcode_key,
      url,
      qrcodeDataUrl,
    };
  }

  /** 轮询二维码扫码状态 */
  async pollQrcode(qrcodeKey: string): Promise<QrcodePollResponse> {
    const res = await fetch(
      `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}`,
      { method: 'GET' },
    );

    if (!res.ok) {
      return {
        code: -1,
        status: 'error',
        message: `轮询二维码网络异常: HTTP ${res.status}`,
      };
    }

    const pollSetCookie = this.extractSetCookies(res.headers);
    const json = (await res.json()) as {
      code: number;
      message: string;
      data?: {
        url: string;
        refresh_token: string;
        timestamp: number;
        code: number;
        message: string;
      };
    };

    const statusSubCode = json.data?.code;

    // 86101: 未扫码
    if (statusSubCode === 86101) {
      return {
        code: 86101,
        status: 'waiting',
        message: '等待手机端扫码...',
      };
    }

    // 86090: 已扫码未确认
    if (statusSubCode === 86090) {
      return {
        code: 86090,
        status: 'scanned',
        message: '已扫码，请在手机客户端点击【确认登录】',
      };
    }

    // 86038: 二维码已失效
    if (statusSubCode === 86038) {
      return {
        code: 86038,
        status: 'expired',
        message: '二维码已失效，请重新生成',
      };
    }

    // 0: 登录成功
    if (statusSubCode === 0 && json.data) {
      const cookieHeader = Array.isArray(pollSetCookie)
        ? pollSetCookie.join('; ')
        : pollSetCookie;

      const cookiePairs = this.parseCookiePairs(cookieHeader);
      const cookieStr = Object.entries(cookiePairs)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

      const midStr = cookiePairs['DedeUserID'];
      const mid = midStr ? Number(midStr) : undefined;

      // 提取用户信息
      let userInfo: BiliUserInfo = {
        mid: mid ?? 0,
        uname: 'B站用户',
        face: '',
        level: 0,
        coins: 0,
        vipType: 0,
      };

      try {
        const navRes = await fetch('https://api.bilibili.com/x/web-interface/nav', {
          headers: { Cookie: cookieStr },
        });
        const navJson = (await navRes.json()) as any;
        if (navJson.code === 0 && navJson.data) {
          const d = navJson.data;
          userInfo = {
            mid: d.mid,
            uname: d.uname,
            face: d.face,
            level: d.level_info?.current_level ?? 0,
            coins: d.money ?? 0,
            vipType: d.vipType ?? 0,
          };
        }
      } catch {
        // 忽略 nav 获取异常
      }

      // 生成一次性 tempAuthToken 待设置密码
      const tempToken = crypto.randomBytes(24).toString('hex');
      const accountSummary: VaultAccountSummary = {
        mid: userInfo.mid,
        uname: userInfo.uname,
        face: userInfo.face,
      };

      this.tempAuthTokens.set(tempToken, {
        credentials: {
          cookie: cookieStr,
          refreshToken: json.data.refresh_token,
          mid,
        },
        account: accountSummary,
        user: userInfo,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      return {
        code: 0,
        status: 'success',
        message: '扫码成功！请设置本地保护密码完成凭据加密',
        tempToken,
        user: userInfo,
      };
    }

    return {
      code: statusSubCode ?? -1,
      status: 'error',
      message: json.data?.message || json.message || '未知状态',
    };
  }

  /** 扫码成功后设置主密码，加密落盘并即时激活会话 */
  async setupPassword(
    tempToken: string,
    password: string,
    remember: boolean = true,
  ): Promise<BiliUserInfo> {
    const record = this.tempAuthTokens.get(tempToken);
    if (!record || Date.now() > record.expiresAt) {
      throw new Error('临时认证凭据已失效或不存在，请重新扫码');
    }

    if (!password || password.trim().length < 1) {
      throw new Error('密码不能为空');
    }

    // 1. 加密落盘
    await VaultService.encryptAndSave(
      password,
      record.credentials,
      record.account,
    );

    // 2. 保存免密解密 key
    if (remember) {
      await VaultService.saveAutoUnlockPassword(password);
    }

    // 3. 注入内存
    this.activeMasterPassword = password;
    this.client.config.data.cookie = record.credentials.cookie;
    this.client.config.data.refreshToken = record.credentials.refreshToken;
    this.client.config.data.mid = record.credentials.mid;

    this.isUnlocked = true;
    this.cachedUser = record.user;
    this.accountSummary = record.account;

    // 清理临时凭据
    this.tempAuthTokens.delete(tempToken);

    return record.user;
  }

  /** 退出登录并抹除 DSH 加密凭据仓库 */
  async logout(): Promise<void> {
    await VaultService.removeVault();
    this.isUnlocked = false;
    this.cachedUser = null;
    this.accountSummary = null;
    this.activeMasterPassword = null;
    this.client.config.data.cookie = '';
    this.client.config.data.refreshToken = '';
    this.client.config.data.mid = undefined;
  }

  /** 刷新并获取当前登录用户的完整状态 */
  private async refreshNavUser(): Promise<BiliUserInfo> {
    const res = await this.client.request<{
      code: number;
      message: string;
      data: any;
    }>('https://api.bilibili.com/x/web-interface/nav');

    if (res.code !== 0 || !res.data?.isLogin) {
      throw new Error('当前凭据已失效，需要重新扫码登录');
    }

    const d = res.data;
    return {
      mid: d.mid,
      uname: d.uname,
      face: d.face,
      level: d.level_info?.current_level ?? 0,
      coins: d.money ?? 0,
      vipType: d.vipType ?? 0,
    };
  }

  /** 获取客户端实例（公开/只读） */
  getClient(): BiliClient<any> {
    return this.client;
  }

  /** 要求当前必须处于已解锁（登录）状态，否则抛错 */
  requireAuthedClient(): BiliClient<any> {
    if (!this.isUnlocked) {
      throw new Error(
        'Bilibili 凭据尚未解锁！请在 DSH 界面点击顶部药丸输入主密码进行动态解密。',
      );
    }
    return this.client;
  }

  // ---- 辅助工具方法 ----

  private extractSetCookies(headers: Headers): string | string[] {
    if (typeof (headers as any).getSetCookie === 'function') {
      const list = (headers as any).getSetCookie();
      if (list.length > 0) return list;
    }
    return headers.get('set-cookie') ?? '';
  }

  private parseCookiePairs(cookieStr: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!cookieStr) return result;
    const parts = cookieStr.split(';');
    for (const part of parts) {
      const [rawKey, ...rawVal] = part.trim().split('=');
      if (rawKey) {
        const val = rawVal.join('=');
        // 过滤掉 path, expires, domain 等属性
        if (!/^(path|expires|domain|samesite|httponly|secure)$/i.test(rawKey)) {
          result[rawKey] = val;
        }
      }
    }
    return result;
  }
}
