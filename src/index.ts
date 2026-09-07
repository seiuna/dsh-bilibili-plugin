import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { BilibiliClientManager } from './client-manager.js';
import { registerBilibiliTools } from './tools.js';

export * from './types.js';
export * from './vault-service.js';
export * from './client-manager.js';

export const name = 'dsh-bilibili-plugin';
export const inject = ['tools', 'webServer'];

export interface Config {
  enabled?: boolean;
}

export const Config = z.object({
  enabled: z.boolean().default(true).description('是否启用 Bilibili 插件功能'),
});

function sendJson(res: any, status: number, value: any): void {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(body);
}

function parseQuery(urlStr: string): URLSearchParams {
  const qIdx = urlStr.indexOf('?');
  if (qIdx === -1) return new URLSearchParams();
  return new URLSearchParams(urlStr.slice(qIdx + 1));
}

async function readBodyJson(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
      if (body.length > 1024 * 1024) {
        reject(new Error('请求体过大'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export function apply(ctx: Context, config: Config = { enabled: true }): void {
  if (config && config.enabled === false) return;

  const manager = BilibiliClientManager.getInstance();

  // 1. 启动时异步探测本地 Vault
  manager.initOnStartup().catch((err) => {
    console.error('[dsh-bilibili-plugin] 启动初始化失败:', err);
  });

  // 2. 注册面向 LLM 的 原生工具集
  registerBilibiliTools(ctx.tools, manager);

  // 3. 注册面向 Web 端 UI 的 HTTP API 路由
  const unregisterRoutes: Array<() => void> = [];

  // GET /api/bilibili/auth/status
  unregisterRoutes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/bilibili/auth/status',
      handler: async (req: any, res: any) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        try {
          const status = await manager.getStatus();
          sendJson(res, 200, status);
        } catch (err: any) {
          sendJson(res, 500, { error: err.message || '获取状态失败' });
        }
      },
    }),
  );

  // POST /api/bilibili/auth/qrcode/generate
  unregisterRoutes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/bilibili/auth/qrcode/generate',
      handler: async (req: any, res: any) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        try {
          const qrData = await manager.generateQrcode();
          sendJson(res, 200, qrData);
        } catch (err: any) {
          sendJson(res, 500, { error: err.message || '申请二维码失败' });
        }
      },
    }),
  );

  // GET /api/bilibili/auth/qrcode/poll?key=xxx
  unregisterRoutes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/bilibili/auth/qrcode/poll',
      handler: async (req: any, res: any) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        try {
          const query = parseQuery(req.url);
          const key = query.get('key');
          if (!key) {
            sendJson(res, 400, { error: '缺少 qrcode key' });
            return;
          }
          const pollResult = await manager.pollQrcode(key);
          sendJson(res, 200, pollResult);
        } catch (err: any) {
          sendJson(res, 500, { error: err.message || '轮询二维码状态失败' });
        }
      },
    }),
  );

  // POST /api/bilibili/vault/setup-pwd
  unregisterRoutes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/bilibili/vault/setup-pwd',
      handler: async (req: any, res: any) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        try {
          const body = await readBodyJson(req);
          const { tempToken, password, remember = true } = body;
          if (!tempToken || !password) {
            sendJson(res, 400, { error: '缺少 tempToken 或 password' });
            return;
          }
          const user = await manager.setupPassword(tempToken, password, remember !== false);
          sendJson(res, 200, { success: true, user });
        } catch (err: any) {
          sendJson(res, 400, { error: err.message || '设置密码加密存储失败' });
        }
      },
    }),
  );

  // POST /api/bilibili/vault/unlock
  unregisterRoutes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/bilibili/vault/unlock',
      handler: async (req: any, res: any) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        try {
          const body = await readBodyJson(req);
          const { password, remember = true } = body;
          if (!password) {
            sendJson(res, 400, { error: '请输入密码' });
            return;
          }
          const user = await manager.unlock(password, remember !== false);
          sendJson(res, 200, { success: true, user });
        } catch (err: any) {
          sendJson(res, 401, { error: err.message || '密码错误，解锁失败' });
        }
      },
    }),
  );

  // GET /api/bilibili/avatar/proxy (解决 B站图片防盗链 403 Forbidden 问题)
  unregisterRoutes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/bilibili/avatar/proxy',
      handler: async (req: any, res: any) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        try {
          const query = parseQuery(req.url);
          const targetUrl = query.get('url');
          if (!targetUrl || !targetUrl.startsWith('http')) {
            sendJson(res, 400, { error: 'Invalid URL parameter' });
            return;
          }

          const parsed = new URL(targetUrl);
          if (
            !parsed.hostname.endsWith('hdslb.com') &&
            !parsed.hostname.endsWith('bilibili.com')
          ) {
            sendJson(res, 403, { error: 'Forbidden image host' });
            return;
          }

          const fetchRes = await fetch(targetUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Referer: 'https://www.bilibili.com/',
            },
          });

          if (!fetchRes.ok) {
            res.statusCode = fetchRes.status;
            res.end();
            return;
          }

          const contentType = fetchRes.headers.get('content-type') || 'image/jpeg';
          const buffer = Buffer.from(await fetchRes.arrayBuffer());

          res.statusCode = 200;
          res.setHeader('content-type', contentType);
          res.setHeader('cache-control', 'public, max-age=86400');
          res.setHeader('access-control-allow-origin', '*');
          res.end(buffer);
        } catch (err: any) {
          sendJson(res, 500, { error: err.message || 'Avatar proxy error' });
        }
      },
    }),
  );

  // POST /api/bilibili/vault/logout
  unregisterRoutes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/bilibili/vault/logout',
      handler: async (req: any, res: any) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        try {
          await manager.logout();
          sendJson(res, 200, { success: true, message: '已成功退出登录并抹除本地凭据' });
        } catch (err: any) {
          sendJson(res, 500, { error: err.message || '退出登录失败' });
        }
      },
    }),
  );

  // 4. 插件销毁与热重载时释放路由
  ctx.effect(() => {
    return () => {
      for (const unregister of unregisterRoutes) {
        try {
          unregister();
        } catch {
          // ignore
        }
      }
    };
  }, 'bilibili: unregister api routes');
}
