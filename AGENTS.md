# AGENTS.md

## 项目定位

这是 DeepSeek Harness (DSH) 的 Bilibili 原生插件，基于 `@seiuna/bilibili-api`。直接注册 Cordis 服务、DSH 工具和 Web 面板，不使用 MCP。用户交流和进度说明优先使用中文。

## 代码导航

- `src/index.ts`：插件入口、依赖声明、服务装配、初始化与销毁；HTTP 路由实现在 `src/http/`。
- `src/poller-service.ts`：通知轮询、去重、白名单、Command → DSH 分发、配置与工作区解析；`src/poller/` 内含评论上下文、ID/URI、有界后台分发队列、最近记录、配置持久化与用户查询。
- `src/agent-bridge.ts`：会话归组、模型选择、人设注入、消息排队、DSH 入站与出站。
- `src/client/`：登录与悬浮配置面板；`styles.ts` 管理样式，`request.ts`/`contracts.ts` 为前端共享 HTTP 契约。
- `src/client-manager.ts`、`src/vault-service.ts`、`src/auth/`、`src/storage/`：B站客户端、登录、本地凭据与原子受限存储。
- `src/command/`：命令解析与分发。
- `src/tools.ts` 为兼容入口；`src/tools/` 按业务域拆分工具与写操作确认，完整映射见 `docs/TOOLS_API.md`。
- `src/network/bilibili-image.ts`：头像与评论图片的受限下载边界（host、协议、redirect、大小、超时）。
- `src/types.ts`：共享数据类型。新增业务字段优先声明明确类型，不依赖索引签名逃避检查。
- `docs/TOOLS_API.md`、`docs/REFACTOR_1.1.3.md`：工具/API 映射与重构验证报告；`docs/issues/` 保存已提交上游 issue 的脱敏草稿。
- `skills/bilibili-comment-context/SKILL.md`：结构化评论输入的识别规则；插件入口注册，发布包包含 `skills/`。
- `test/`：离线测试及显式启用的真实 profile 预览。
- `lib/`：构建产物，不直接修改。

## 核心行为约定

### 会话归组

同一视频或动态下的不同用户、不同楼层共用 session。归组依据工作区、业务类型、评论区主体 ID 和模型路由，不依据用户 ID 或当前评论 ID。

不同工作区、模型路由和内容保持隔离。旧会话历史不自动合并或迁移。修改归组规则时说明新会话与旧历史的关系。

同一内容的消息须按轮次处理；每次出站保留原评论的回复目标，不能因下一位用户到来而覆盖。后台队列需有数量限制、超时和销毁处理，不能无限等待或产生未处理拒绝。不要因为等待一个模型轮次而阻塞全部内容的轮询。

### 入站 prompt

同一 session 的首次用户消息包含：

```text
[消息来源类型]: Video-BV号 或 Dynamic-动态ID
[视频标题/动态内容]: 真实视频标题或动态正文节选
[评论区Id (oid)]: 主体ID [业务类型]: 类型值
```

这三项后续不重复发送；恢复历史会话时也要识别已经发送的来源信息。来源没有取得时不可编造 ID 或把通知摘要当作真实内容。

每次消息包含当前评论与发送者：

```text
[评论Id]: 当前评论ID
[父评论Id]: 存在且已知时提供
[根评论Id]: 与当前评论不同且已取得时提供
[父评论] [作者UID]: 已取得的父评论正文
[用户消息] [昵称:UID]: 当前消息
```

机器人旧评论只从相关回复链中按机器人 UID 核对，不选任意最新机器人评论。当前评论就是根评论时不重复正文；没有父评论时省略字段。字段缺失与查询失败不能混为已确认的“不存在”。

视频标题从视频详情获取；动态正文从动态详情获取，目前节选最多 500 字。BV 号、动态 ID、评论区 `oid`、评论 `rpid`、根 ID 和父 ID 不能混用；相册评论区 ID 不保证等于动态 ID。把 ID 当标识符处理，避免有损数字转换。

### 图片

图片只来自精确匹配当前 `sourceId` 的评论 `content.pictures`。

禁止把通知 `item.image`、动态配图、视频封面、父评论或根评论的图片作为当前评论附件回退。当前用户的一级根评论本身带图时仍应支持。纯图片评论不应被空文本判断或命令帮助响应拦截。

生产入站使用 DSH attachment/image block；只得到 URL 或下载失败时，不声称模型已看见图片。外部图片下载应有大小、超时、协议和目标检查。

### 人设、模型与工作区

- 人设作为 B站 Agent 作用域中的系统提示词段注册，不拼入用户消息。编辑后的文件应在后续组装时读取。
- 保留宿主工具、安全与工作区约束，不为了人设清空全部系统指令。
- B站独立模型设置不修改 DSH 全局默认；明确配置无效时不要偷偷换成其他模型。
- 指定目录必须真实存在且是绝对目录，通过 canonical path 校验 Agent 的实际 `session.header.cwd`。
- 无效的显式工作区禁止静默回退。
- 通过 `workspaceRegistry` 公共服务注册与关联，禁止直接修改宿主 `workspace.json`。

## DSH 集成注意事项

- 先检查当前安装版本的真实 API，再实现集成；不要仅凭历史示例推断契约。
- 使用 `createUserMessage()` 构造带稳定消息 ID 的输入。
- `followup()` 的调用返回不代表模型轮次完成；以真实事件契约处理出站和结束。
- Session ID 没有已证实的 `session-UUID` 强制格式要求，不把格式猜测当成侧边栏问题的根因。
- 同一路径的 HTTP GET/POST 使用同一 exact handler 内的方法分支，避免重复路由注册。
- 声明需要的服务依赖；可选服务通过注入回调挂载。监听器、路由、队列和注册资源需随插件卸载释放。
- 技能正文与输入协议一起更新，确保 `package.json` 的发布清单包含技能资源。

## UI 约定

配置面板跟随 DSH 的明暗主题、语义颜色、字体、圆角、边框与交互样式。粉色 `#FB7299` 主要保留在 B站品牌胶囊，不让面板大面积脱离宿主风格。

保留头像、昵称和 `Lv.` 等级，不增加硬币计数或装饰 emoji。悬浮面板用 portal 避免顶栏裁剪，限制视口高度并支持滚动。错误、加载、保存状态在面板内展示；不要把所有 404 都解释为必须重启。

## 测试与命令

```powershell
pnpm run typecheck
pnpm run build
pnpm exec vitest run test/prompt-preview.test.ts test/source-context.test.ts test/comment-images.test.ts test/agent-workspace.test.ts
```

测试优先使用临时目录和模拟 SDK、Agent、attachment、workspace 服务，避免读取生产凭据、调用真实模型、点赞或发评论。模拟测试通过不等于真实 DSH/B站端到端通过。

`pnpm test` 执行全套测试；部分历史测试可能含二维码等网络行为，执行前检查隔离情况。不要盲目用插件 `apply()` 做加载测试，它可能自动解锁并启动真实轮询。

### 离线 prompt 预览

```powershell
pnpm exec vitest run test/prompt-preview.test.ts
```

复用生产上下文和 prompt 组装，在模拟 `followup` 截获输出。

### static-test 真实账户轮询预览

仅在用户明确要求真实账户测试时运行：

```powershell
$env:BILI_STATIC_TEST = '1'
$env:BILI_TEST_ROUNDS = '6'
pnpm exec vitest run test/static-profile-prompt.test.ts
Remove-Item Env:BILI_STATIC_TEST
Remove-Item Env:BILI_TEST_ROUNDS
```

该测试明确加载 Bilibili profile `static-test`，不是 DSH 的 profile。每 10 秒轮询，使用临时工作区和模拟 DSH session，截获最终 prompt；拦截点赞、回复，不调用模型。图片仅打印 URL，不下载。默认跳过；没有截获消息不能视为全链路通过。真实输出含用户评论，分享前检查隐私。

## 已知边界：修改前需核实

- 轮询每轮只调用一次已启用的 `getReplyFeed`／`getAtFeed`，只处理各自本页返回条目，不用未读计数门控，不追踪游标翻页。以通知类型＋通知 ID 和业务类型＋主体 ID＋评论 ID 双层去重；最近 2000 个去重键保存在轮询配置旁的 `.processed.json` 文件，重启后继续跳过，超出容量的旧记录会淘汰。去重状态读取损坏或持久化失败时停止该轮投递，不冒险重放。
- SDK `replyDialog` 只输出子评论，不输出响应的根评论对象；不能假设根评论会在 `page.comments` 中。
- SDK 1.1.3 的 `CommentAPI.getReply`（jump 定位接口）接受 `number | string` ID；优先用它获取当前／父／根评论，同一通知上下文缓存定位结果。未找到时共用有界列表回退（楼中楼与顶层各最多 5 页），未找到不等于已删除；大整数字符串主体 ID 不转换为不安全 number。`getReplies`／`getReplyDialog`／`BiliClient.getComment` 的声明仍限定 number 且 `getReplyDialog` 返回类型缺 root，运行实现会用 `String(...)` 序列化字符串 ID，插件在窄边界用局部类型桥兼容（上游 issue #13），升级 SDK 后应删除该桥。
- 从历史文本识别首次来源信息不是防伪元数据；改进持久化标记时须兼容旧记录。
- 当前本地自动解锁机制可能在独立文件保存解锁材料，不能宣称“磁盘零明文”或“企业级安全”。不要输出 cookie、SESSDATA、bili_jct、密码、refresh token 或模型 API key。

## 上游 SDK 问题反馈

用户要求：以后确认属于 `@seiuna/bilibili-api` 的问题，直接向 https://github.com/seiuna/bilibili-api 提交 GitHub issue，不只在插件侧绕过。提交前检查重复 issue，附 SDK 版本、最小复现、预期与实际行为及脱敏错误信息；插件自身问题不要误报给上游。不得公开凭据、私人评论或本地隐私路径。若 GitHub 认证或提交能力不可用，明确说明未提交并提供 issue 草稿，不声称已创建。

## 交付标准

修改源码、增加对应回归测试，再做类型检查和构建。至少覆盖本次改变的成功、缺失和失败路径；并发、复用、恢复行为不得仅靠单消息测试证明。

后端修改需完整重启现有 DSH 宿主，页面刷新不等于后端重载。前端修改需重建资源后刷新；没有确认同一安装目录的 HMR watcher 时，不承诺自动更新。不要启动另一个服务器冒充更新当前 GUI，不强制关闭承载当前任务的 Desktop。

报告准确的修改文件、运行命令、测试结果和未验证边界。不得使用“100%”“彻底解决”“即时可见”等未经真实验证的承诺。
