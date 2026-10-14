import QRCode from 'qrcode';
import type { QrcodeGenerateResponse, QrcodePollResponse } from '../types.js';
import type { TempAuthRecord } from './temp-auth-store.js';
import { createMemoryClient, getCredentials, readNavUser } from './sdk-client.js';

const PASSPORT = 'https://passport.bilibili.com/x/passport-login/web/qrcode';
const TIMEOUT_MS = 15_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function request(endpoint: string): Promise<Response> {
  return fetch(`${PASSPORT}/${endpoint}`, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export async function generateQrcode(): Promise<QrcodeGenerateResponse> {
  const response = await request('generate');
  if (!response.ok) throw new Error(`申请二维码失败: HTTP ${response.status}`);
  const json: unknown = await response.json();
  if (!isObject(json) || json.code !== 0 || !isObject(json.data)) {
    throw new Error('申请二维码失败，响应无效');
  }
  const { qrcode_key: qrcodeKey, url } = json.data;
  if (typeof qrcodeKey !== 'string' || !qrcodeKey || typeof url !== 'string' || !url) {
    throw new Error('申请二维码失败，响应缺少二维码信息');
  }
  const qrcodeDataUrl = await QRCode.toDataURL(url, {
    margin: 1, width: 256, color: { dark: '#000000', light: '#ffffff' },
  });
  return { qrcodeKey, url, qrcodeDataUrl };
}

export interface QrcodePollResult {
  response: QrcodePollResponse;
  record?: TempAuthRecord;
}

/** 保留 UI 分步协议。SDK 高层登录会自己轮询并持久化 profile，不适用这里。 */
export async function pollQrcode(qrcodeKey: string): Promise<QrcodePollResult> {
  if (!qrcodeKey.trim() || qrcodeKey.length > 512) {
    return { response: { code: -1, status: 'error', message: '二维码标识无效' } };
  }
  try {
    const response = await request(`poll?qrcode_key=${encodeURIComponent(qrcodeKey)}`);
    if (!response.ok) {
      return { response: { code: -1, status: 'error', message: `轮询二维码网络异常: HTTP ${response.status}` } };
    }
    const json: unknown = await response.json();
    if (!isObject(json) || json.code !== 0 || !isObject(json.data)) {
      return { response: { code: -1, status: 'error', message: '轮询二维码响应无效' } };
    }
    const code = json.data.code;
    if (code === 86101) return { response: { code, status: 'waiting', message: '等待手机端扫码...' } };
    if (code === 86090) return { response: { code, status: 'scanned', message: '已扫码，请在手机客户端点击【确认登录】' } };
    if (code === 86038) return { response: { code, status: 'expired', message: '二维码已失效，请重新生成' } };
    if (code !== 0) return { response: { code: typeof code === 'number' ? code : -1, status: 'error', message: '未知二维码状态' } };

    const client = createMemoryClient();
    const cookies = response.headers.getSetCookie?.();
    await client.config.setAuthCookies(cookies?.length ? cookies : response.headers.get('set-cookie') ?? '');
    // 不接受仅有 code=0 但缺少有效 Cookie 的伪成功。
    if (!/(?:^|;\s*)SESSDATA=[^;]+/.test(client.config.data.cookie)) throw new Error('缺少登录凭据');
    client.config.getCsrf();
    const user = await readNavUser(client);
    client.config.data.mid = user.mid;
    client.config.data.refreshToken = typeof json.data.refresh_token === 'string' ? json.data.refresh_token : '';
    return {
      response: { code: 0, status: 'success', message: '扫码成功！请设置本地保护密码完成凭据加密', user },
      record: {
        credentials: getCredentials(client), user,
        account: { mid: user.mid, uname: user.uname, face: user.face },
      },
    };
  } catch {
    // 不回显上游任意错误内容，避免 URL、Cookie 等敏感信息进入 UI/日志。
    return { response: { code: -1, status: 'error', message: '扫码验证失败，请稍后重试或重新扫码' } };
  }
}
