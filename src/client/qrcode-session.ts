import type { QrcodeGenerateResponse, QrcodePollResponse } from '../types.js';
import { generateQrcode, pollQrcode } from './api.js';
import { startSerialPolling } from './async.js';

interface QrcodeSessionHandlers {
  generated: (value: QrcodeGenerateResponse) => void;
  polled: (value: QrcodePollResponse) => void;
  failed: (error: unknown) => void;
}

/** Generation and polling share one cancellable lifetime; callbacks never fire after stop. */
export function startQrcodeSession(handlers: QrcodeSessionHandlers): () => void {
  let key: string | undefined;
  return startSerialPolling(async signal => {
    if (!key) {
      const qr = await generateQrcode(signal);
      signal.throwIfAborted();
      key = qr.qrcodeKey;
      handlers.generated(qr);
      return true;
    }
    const result = await pollQrcode(key, signal);
    signal.throwIfAborted();
    if (result.code === 0 && !result.tempToken) throw new Error('登录响应缺少临时凭据，请重新扫码');
    if (![0, 86101, 86090, 86038].includes(result.code)) {
      throw new Error(result.message || '二维码状态异常，请重新扫码');
    }
    handlers.polled(result);
    return result.code === 86101 || result.code === 86090;
  }, handlers.failed, 2000);
}
