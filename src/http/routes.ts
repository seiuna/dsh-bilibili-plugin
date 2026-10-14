import type { IncomingMessage } from 'node:http';
import { downloadBilibiliImage, parseBilibiliImageUrl } from '../network/bilibili-image.js';
import { BiliUserNotFoundError } from '../poller/users.js';
import { modelCatalog } from '../model-selection.js';
import type { HttpDependencies, HttpHandler } from './contracts.js';
import { boolean, parsePollerConfig, text, whitelistUser } from './config.js';
import { assertSameOrigin, errorMessage, HttpError, parseQuery, readBodyJson, requireInteger, sendJson } from './utils.js';

/** One exact handler per path; all browser-origin reads AND writes receive the same origin check. */
export function registerBilibiliRoutes(deps: HttpDependencies): () => void {
  const { manager, poller } = deps;
  const releases: Array<() => void> = [];
  const downloads = new AbortController();
  let disposed = false;
  const assertActive = () => { if (disposed) throw new HttpError(503, '插件已卸载'); };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    downloads.abort();
    for (const release of releases.splice(0).reverse()) {
      try { release(); } catch { /* Continue releasing the remaining routes. */ }
    }
  };
  const readBody = async (req: IncomingMessage) => {
    const body = await readBodyJson(req);
    assertActive();
    return body;
  };
  const register = (path: string, methods: string[], handler: HttpHandler, status = 500, fallback = '请求失败') => {
    releases.push(deps.webServer.register({
      kind: 'exact', path: `/api/bilibili${path}`,
      handler: async (req, res) => {
        try {
          assertActive();
          assertSameOrigin(req);
          if (!methods.includes(req.method ?? '')) {
            res.setHeader('allow', methods.join(', '));
            throw new HttpError(405, 'Method not allowed');
          }
          await handler(req, res);
        } catch (error) {
          sendJson(res, error instanceof HttpError ? error.status : status, { error: errorMessage(error, fallback) });
        }
      },
    }));
  };
  const queryInteger = (req: IncomingMessage, key: string, fallback: number, max: number) => {
    const value = parseQuery(req.url).get(key);
    if (value === null) return fallback;
    if (!/^\d+$/.test(value)) throw new HttpError(400, `${key} 必须是正整数`);
    return requireInteger(Number(value), key, 1, max);
  };

  try {
    register('/auth/status', ['GET'], async (_req, res) => {
      sendJson(res, 200, await manager.getStatus());
    }, 500, '获取状态失败');
    register('/auth/qrcode/generate', ['POST'], async (_req, res) => {
      sendJson(res, 200, await manager.generateQrcode());
    }, 500, '申请二维码失败');
    register('/auth/qrcode/poll', ['GET'], async (req, res) => {
      const key = text(parseQuery(req.url).get('key'), 'qrcode key', 1024);
      sendJson(res, 200, await manager.pollQrcode(key));
    }, 500, '轮询二维码状态失败');
    register('/vault/setup-pwd', ['POST'], async (req, res) => {
      const body = await readBody(req);
      const token = text(body.tempToken, 'tempToken', 1024);
      const password = text(body.password, 'password', 4096);
      const remember = body.remember === undefined ? true : boolean(body.remember, 'remember');
      const start = deps.beginLogin();
      const user = await manager.setupPassword(token, password, remember);
      start();
      sendJson(res, 200, { success: true, user });
    }, 400, '设置密码加密存储失败');
    register('/vault/unlock', ['POST'], async (req, res) => {
      const body = await readBody(req);
      const password = text(body.password, 'password', 4096);
      const remember = body.remember === undefined ? true : boolean(body.remember, 'remember');
      const start = deps.beginLogin();
      const user = await manager.unlock(password, remember);
      start();
      sendJson(res, 200, { success: true, user });
    }, 401, '密码错误，解锁失败');
    register('/vault/logout', ['POST'], async (_req, res) => {
      deps.stopPolling();
      await manager.logout();
      sendJson(res, 200, { success: true, message: '已成功退出登录并抹除本地凭据' });
    }, 500, '退出登录失败');
    register('/avatar/proxy', ['GET'], async (req, res) => {
      const input = text(parseQuery(req.url).get('url'), 'url', 8192);
      let url: URL;
      try { url = parseBilibiliImageUrl(input); }
      catch { throw new HttpError(403, '不允许的 B站图片地址'); }
      const image = await downloadBilibiliImage(url.href, { signal: downloads.signal });
      assertActive();
      res.statusCode = 200;
      res.setHeader('content-type', image.mediaType);
      res.setHeader('cache-control', 'public, max-age=86400');
      res.setHeader('x-content-type-options', 'nosniff');
      res.end(image.data);
    }, 502, 'Avatar proxy error');
    register('/models', ['GET'], async (_req, res) => {
      sendJson(res, 200, await modelCatalog(deps.getLlm()));
    }, 503, '获取模型失败');
    register('/poller/config', ['GET', 'POST'], async (req, res) => {
      if (req.method === 'GET') {
        sendJson(res, 200, {
          ...poller.getConfig(), systemPrompt: await poller.getSystemPrompt(), promptFilePath: poller.getPromptFilePath(),
        });
        return;
      }
      const config = await parsePollerConfig(await readBody(req), deps.getLlm);
      assertActive();
      const updated = await poller.saveConfig(config);
      sendJson(res, 200, { success: true, config: { ...updated, promptFilePath: poller.getPromptFilePath() } });
    }, 400, '更新轮询配置失败');
    register('/poller/recent-messages', ['GET'], async (_req, res) => {
      sendJson(res, 200, { success: true, list: poller.getRecentMessages() });
    }, 500, '获取最近处理消息失败');
    register('/poller/recent-messages/clear', ['POST'], async (_req, res) => {
      poller.clearRecentMessages();
      sendJson(res, 200, { success: true });
    }, 500, '清空最近处理消息失败');
    register('/followings', ['GET'], async (req, res) => {
      sendJson(res, 200, await poller.getFollowings(queryInteger(req, 'page', 1, 100_000), queryInteger(req, 'pageSize', 50, 50)));
    }, 500, '获取关注列表失败');
    register('/workspaces', ['GET'], async (_req, res) => {
      sendJson(res, 200, await poller.listWorkspaces());
    }, 500, '获取工作区列表失败');
    register('/user/search', ['GET'], async (req, res) => {
      const query = text(parseQuery(req.url).get('q'), 'q', 256);
      try { sendJson(res, 200, await poller.searchUser(query)); }
      catch (error) {
        if (error instanceof BiliUserNotFoundError) throw new HttpError(404, error.message);
        throw error;
      }
    }, 502, '查询用户失败');
    register('/whitelist/add', ['POST'], async (req, res) => {
      sendJson(res, 200, { success: true, config: await poller.addWhitelistUser(whitelistUser(await readBody(req))) });
    }, 400, '添加白名单失败');
    register('/whitelist/remove', ['POST'], async (req, res) => {
      const body = await readBody(req);
      sendJson(res, 200, { success: true, config: await poller.removeWhitelistUser(requireInteger(body.mid, 'mid')) });
    }, 400, '移除白名单失败');
  } catch (error) {
    dispose(); // Registration itself can fail half-way (e.g. an existing exact path).
    throw error;
  }
  return dispose;
}
