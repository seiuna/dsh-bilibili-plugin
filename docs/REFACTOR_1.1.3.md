# @seiuna/bilibili-api 1.1.3 重构与验证报告

对应工具映射文档：[TOOLS_API.md](./TOOLS_API.md)。本文记录本次重构的范围、模块整理、兼容性变化、验证结果、已反馈的上游缺陷和未验证边界。

## 基线

- 依赖固定为 `@seiuna/bilibili-api@1.1.3`（`package.json` 精确版本，`pnpm-lock.yaml` 同步），以本地安装的 `dist/index.d.ts` **和 dist 实现**逐项核对，不依据历史示例推断。
- DSH 宿主按当前安装的 `app.asar` 内 `@deepseek-ai/dsh-agent@0.1.5-rc.1` 等公共接口核对（`followup`/`turn/end` 事件、`webServer.register` disposer、`systemPrompt.section/variable`）。
- 保留全部 **24 个工具名**、全部 16 个 HTTP 路由与 UI 响应协议；不为“覆盖 SDK”增删工具。

## 模块整理结果

| 区域 | 结果 |
| --- | --- |
| 工具 | `src/tools.ts`（1600+ 行）拆为 `src/tools/{shared,discovery,video,comments,users,library,dynamics,content,index}.ts` 七业务域，`src/tools.ts` 保留兼容 re-export |
| 轮询 | `src/poller-service.ts` 拆出 `src/poller/{comment-context,identifiers,dispatch-queue,recent-messages,config-store,users}.ts` |
| 认证/存储 | `src/client-manager.ts` 拆出 `src/auth/{sdk-client,qrcode-login,temp-auth-store}.ts` 与 `src/storage/{atomic-file,serial-task-queue,vault-record}.ts` |
| HTTP/入口 | `src/index.ts` 从 600+ 行降为约 140 行生命周期装配；路由拆到 `src/http/{routes,config,utils,contracts}.ts` |
| 前端 | `src/client/` 新增 `request/contracts/async/auth-store/qrcode-session`，消除重复 fetch 与 `any` |
| 图片 | 统一 `src/network/bilibili-image.ts` 作为头像与评论图片的受限下载边界 |

## 关键修正（重构中确认并修复）

**工具层**
- SDK 静态 API 返回的业务 `code` 统一检查（`checkCode`/`dataOf`）；此前点赞/投币/三连/关注等可把非 0 code 当成功，读取失败被伪装成空列表。
- 评论工具改用 SDK 1.1.3 `CommentAPI.getReplies/getReplyDialog` 单页 API，移除手写 URL；精确评论严格核对 `oid/type/rpid`，根/父/统计缺失显示未知而不是 0。
- 弹幕拒绝非 XML 正文（风险控制 HTML/JSON 错误页不再变成"空弹幕"）；历史改检查单页 `getHistoryPage`。
- `confirm` 严格布尔校验；动态 ID 只接受数字或已知 B站动态链接，不再从任意文本抓数字。
- `bilibili_send_comment` 支持视频（bvid/aid）与动态（dynamicId）发评/回复：动态评论区 `oid/type` 经 `DynamicAPI.getDetail` 解析并校验后写入，不把动态 ID 当 oid；解析失败不发表；confirm 预览保持零请求。
- **请求通道**：全部请求经 `@seiuna/bilibili-api` 的 `BiliClient`（SDK 静态 API 以 client 为传输），工具层无全局 `fetch`、不复制 Cookie/CSRF/WBI；全 SDK 无投稿/关注列表方法，唯一 URL 构造点是 `bilibili_get_user_videos` 的 `client.request` typed 扩展（表 #8）。已按用户决定提上游 feature issue [#14](https://github.com/seiuna/bilibili-api/issues/14) 请求 `UserAPI.getSubmissions/getFollowings`，SDK 补齐后删除该扩展。
- **输出契约**：所有工具返回标准 JSON（无图标、无 emoji、无散文模板），未知保持 `null`/缺省而不是 0；热搜上游 `icon` 字段不再透传。

**轮询与评论上下文**
- 改用 `CommentAPI.getReply`（接受 string ID）精确优先 + 同通知缓存 + 各最多 5 页有界回退；大整数 ID 全程字符串，不做有损 number 转换。
- 来源解析：视频用 `VideoAPI.getInfoByAid` 并校验 aid 匹配；动态 11/16 仅在拿到可靠动态 ID 时取 `DynamicAPI.getDetail` 并校验 `basic.comment_id_str/comment_type`，绝不把 oid 当动态 ID。
- 图片只取精确匹配当前 `sourceId` 的 `content.pictures`；无任何封面/父评论/通知图回退。
- 后台分发改为按内容 key 串行的有界队列（容量 100、10 分钟超时、stop/卸载取消、迟到出站拒绝），轮询不再因单个模型轮次阻塞全部内容；同内容消息按轮次处理，回复目标不被下一条消息覆盖。

**配置持久化**
- 新增 `PollerConfigStore`：串行保存、同目录原子替换（fsync+rename、受限权限）、字段白名单+运行时校验、并发白名单更新用 updater 合并。
- 损坏/不可读配置 fail closed，不再静默退默认并开启轮询；系统提示词单文件，外部编辑即时生效，显式清空（空文件）不被默认值覆盖。
- 工作区在保存时校验存在/绝对目录，使用时按 canonical path 再校验；无效显式工作区不静默回退。
- 兼容迁移：旧配置 `pollIntervalSeconds: 2`（历史上被定时器强制成 3s）迁移为 3；未知字段不再回写。

**认证/凭据**
- 解锁改"候选客户端验证成功后才提交"，失败不污染当前会话；`remember=false` 会清除旧自动解锁材料，临时授权有界（16 个、5 分钟过期），二维码轮询合并且可取消。
- Vault 原子受限写入、格式/KDF/base64 校验、常量时间校验、敏感 buffer 用后清零。
- **如实边界**：启用"记住密码"时 `bilibili-key.json` 仍是明文解锁材料（两个独立文件不是跨文件事务），Windows 上 0600 不替代目录 ACL；README 已移除"磁盘零明文"表述。

**HTTP/前端**
- 每个 exact 路由 GET/POST 单 handler 方法分支；同源检查、1 MiB 字节上限 JSON、400/403/405/413/502 分类；user/search 仅 `BiliUserNotFoundError` 返回 404，上游故障返回 502，不再把所有异常吞成 404/伪默认值。
- 头像代理改共享受限下载：严格域名后缀边界（`evilhdslb.com` 类绕过失效）、禁止重定向、大小/超时限制。
- 二维码生成+轮询同生命周期串行可取消；并发刷新 latest-only；清空最近消息失败保留原记录并显示错误。

## 验证

由于 `@seiuna/bilibili-api@1.1.3` 发布在 pnpm 供应链 `minimumReleaseAge` 窗口内，`pnpm exec/run` 触发的自动依赖安装被策略拒绝。**未放宽策略、未改供应链配置**，改为直接调用已安装的 Node 入口验证；`pnpm run typecheck/test/build` 在策略窗口过后可正常执行。

```powershell
node node_modules/vitest/vitest.mjs run --reporter=dot --silent
node node_modules/typescript/bin/tsc --noEmit
node node_modules/tsdown/dist/run.mjs
```

结果（2026-09-22 本次会话）：

- 测试：**23 个文件通过、1 个跳过（`static-profile-prompt`，真实账户预览默认关闭）；661 通过 + 1 预期失败 + 1 跳过**（663 项，含工具标准 JSON 输出、图标禁用与动态发评回归）。
  - 预期失败项是锁定上游 Cookie 刷新缺陷的 `it.fails` 契约测试（见 issue #11），SDK 修复后应删除 `.fails`。
- 类型检查：通过（无输出、exit 0）。
- 构建：host `lib/index.js`（ESM）与 client `lib/client.js`（CJS 包装）均成功。
- 全套测试默认 stub 全局 `fetch` 拒绝真实网络；无真实登录、无真实评论/点赞、未加载生产 profile、未调用插件 `apply()`。

## 已确认并反馈的上游 SDK 1.1.3 缺陷

均为离线 customFetch/类型检查最小复现，脱敏后提交，已查重（仓库此前无 issue）：

| issue | 缺陷 | 插件侧规避 |
| --- | --- | --- |
| [#11](https://github.com/seiuna/bilibili-api/issues/11) | `performRefresh` 把原始 `Set-Cookie` 直接写入 Cookie，多 Cookie 丢失/污染、`getCsrf()` 失效 | 离线契约测试以 `it.fails` 锁定；刷新后需重新扫码不承诺自动续期 |
| [#12](https://github.com/seiuna/bilibili-api/issues/12) | `DanmakuAPI.getXmlDanmaku` 不检查 `res.ok`，403 HTML 被当弹幕 XML 返回 | 工具侧校验 XML 正文结构，拒绝 HTML/JSON 伪装 |
| [#13](https://github.com/seiuna/bilibili-api/issues/13) | 评论 ID 类型声明不一致（`getReplies/getReplyDialog/getComment` 限 number），`getReplyDialog` 返回类型缺 `root` | 窄边界局部类型桥，保留字符串 ID（升级 SDK 后删除） |
| [#14](https://github.com/seiuna/bilibili-api/issues/14) | （feature）`UserAPI` 缺投稿列表/关注列表方法，消费者只能手拼 URL | 保留 `client.request` typed 扩展并集中标注；SDK 补齐后删除 |

草稿存档在 `docs/issues/`。未修改 `node_modules`，未向上传播任何凭据、私人评论或本地隐私路径。

## 未验证边界

- 未重启 DSH Desktop 宿主做真实加载；离线 mock 通过不等于真实 DSH/B站端到端通过。后端变更需完整重启宿主，前端重建后刷新；未确认同安装目录 HMR watcher，不承诺自动更新。
- 未用真实账号验证登录、轮询、评论、图片入库全链路（真实预览测试默认跳过，需明确授权 + `BILI_STATIC_TEST=1`）。
- 未做浏览器端 React DOM/主题交互 E2E。
- SDK Cookie 刷新缺陷（#11）未修复前，长期自动续期不承诺可靠。
- AbortSignal 不能强杀不合作的底层模型 Promise：超时/停止后拒绝迟到出站并占用有界槽位直到真实 settle，不声称底层轮次已被取消。
