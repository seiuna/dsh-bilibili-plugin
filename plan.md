# DSH Bilibili 插件架构设计与实施计划 (plan.md)

## 一、项目背景与设计目标

本工程旨在将 `@seiuna/bilibili-api` 深度集成到 **DeepSeek Harness (DSH)** 运行时微内核生态中。

### 核心设计原则
1. **DSH 原生微内核工具（摒弃额外 MCP 进程开销）**：
   - 放弃拉起独立 MCP stdio 子进程的传统方式，直接通过 DSH 的 `@deepseek-ai/dsh-tools` 将能力注册为原生 Agent 工具。
   - 降低子进程通信延迟，支持参数的强类型校验（JSON Schema / Zod）及 Markdown 格式化输出。
2. **专属 WebUI 登录空间（严格仅提供二维码登录）**：
   - 在 DSH Web 客户端顶部导航栏注入常驻状态胶囊（Header Pill）；
   - 在全局遮罩层（`shell.overlay`）注入专属 B 站登录抽屉/模态框（Overlay Modal）；
   - **严格仅提供二维码扫码登录**（免账号密码/短信，杜绝凭据在输入界面泄漏风险）。
3. **主密码保护与 AES-256-GCM 本地加密保险箱（Vault）**：
   - 扫码成功后，要求用户设置一个本地主保护密码（Master Password）；
   - 采用 **PBKDF2-HMAC-SHA256 (100,000次迭代)** 派生 256 位加密密钥，并结合 **AES-256-GCM** 对 B 站凭据（`SESSDATA`、`bili_jct`、`refreshToken` 等）进行强加密；
   - 密文保存于 `~/.dsh/storages/bilibili-vault.json`，**磁盘零明文**；
   - 每次 DSH 启动时凭据处于加锁状态，用户在 WebUI 中一键输入密码动态解密至 Node 内存单例中；亦支持通过 `BILIBILI_VAULT_PWD` 环境变量供无头/自动化环境静默解密。
4. **安全写操作拦截机制（Human-in-the-loop）**：
   - 点赞、投币、一键三连、发评论等不可逆或消耗资产的操作，默认启用 `confirm=false` 安全防护，先向用户核对，得到显式许可后再以 `confirm=true` 执行。
5. **完备的单元测试覆盖**：
   - 为加解密保险箱、客户端管理器、以及 Agent 原生工具调用编写全面的自动化测试用例，确保网络调用、Mock 响应、安全拦截和渲染逻辑稳健可靠。

---

## 二、系统总体架构与模块划分

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        DeepSeek Harness (DSH)                          │
├───────────────────────────────────┬────────────────────────────────────┤
│         Node.js 宿主端 (Host)     │        Web 浏览器端 (Client)       │
│                                   │                                    │
│  1. Cordis 微内核生命周期         │  1. 顶部栏胶囊 (Header Pill)       │
│  2. 原生 Agent 工具总线 (ctx.tools)│  2. 全局纯二维码弹窗 (Auth Overlay)│
│  3. WebServer API 路由            │  3. 主密码设置 / 动态解锁弹窗      │
│  4. ClientManager 内存单例        │  4. 响应式状态机 (biliStore)       │
│  5. VaultService 加解密引擎       │  5. 哔哩粉色主题样式 (styles.ts)   │
└─────────────────┬─────────────────┴──────────────────┬─────────────────┘
                  │                                    │
                  │ 持久化密文存储                     │ 浏览器端加载
                  ▼                                    ▼
       ~/.dsh/storages/bilibili-vault.json       lib/client.js
       (PBKDF2 + AES-256-GCM 加密落盘)      (DSH __ModuleLoader__ 契约)
```

### 模块详细职责

1. **`src/vault-service.ts` (加密保险箱服务)**：
   - 实现基于 Node 原生 `node:crypto` 的 PBKDF2 密钥派生；
   - 实现 AES-256-GCM 对称加密与带认证标签（AuthTag）的解密；
   - 生成并校验快速密码验证子（Verifier Hash）；
   - 提供落盘持久化、读取公开账号摘要（用于未解锁时展示头像昵称）及销毁抹除方法。
2. **`src/client-manager.ts` (客户端状态管理器)**：
   - 维护 `BiliClient` 内存单例，防止凭证刷新并发竞态；
   - 二维码申请（生成 Base64 Data URL 图片）与 2 秒轮询检测；
   - 临时认证会话管理（暂存已扫码未设置密码的凭证）；
   - 动态解密凭证注入与全局登出清理。
3. **`src/tools.ts` (DSH 原生 Agent 工具集)**：
   - 实现 15 个高内聚原子工具；
   - 提供输入参数 Schema、执行体 `execute()` 与上下文输出格式化 `render()`。
4. **`src/index.ts` (插件主入口)**：
   - 声明 Cordis 插件依赖（`['tools', 'webServer']`）；
   - 启动时自动检查本地 Vault 状态与环境变量密码；
   - 注册 6 个面向 Web 端的 HTTP 路由（状态、二维码生成、轮询、设置密码、解锁、登出）。
5. **`src/client/` (WebUI 界面模块)**：
   - `BilibiliHeaderPill.tsx`：挂载在 `conversation.session.header.actions`；
   - `BilibiliAuthOverlay.tsx`：挂载在 `shell.overlay`，只提供纯二维码扫码登录；
   - `store.ts`：前端订阅制状态机与 API 调度器；
   - `styles.ts`：注入自适应深浅色模式的 B 站粉色主题 CSS。

---

## 三、原生 Agent 工具矩阵设计 (15 个核心工具)

| 序号 | 工具名称 | 对应底层 API | 需登录 | 核心功能与 Agent 场景 |
| :--- | :--- | :--- | :---: | :--- |
| 1 | `bilibili_search` | `SearchAPI.searchAll` | 否 | **全能搜索**：按关键词搜索视频、UP主、专栏或直播，支持类型过滤。 |
| 2 | `bilibili_get_trends` | `SearchAPI.getHotSearch` / `RankingAPI` | 否 | **热点发现**：获取全站热搜词、热门综合视频、全站排行榜、入站必刷。 |
| 3 | `bilibili_get_video_info` | `VideoAPI.getInfo` / `getTags` | 否 | **视频详情**：获取标题、UP主、简介、播放/点赞/投币/收藏数、分P列表与标签。 |
| 4 | `bilibili_get_video_ai_summary` | `VideoAPI.getAiSummary` | 否 | **官方 AI 摘要大纲**：提取官方 AI 生成的分段提纲与关键时间戳（速读长视频神器）。 |
| 5 | `bilibili_get_video_play_url` | `VideoAPI.getPlayUrl` | 否 | **音视频流获取**：获取指定分辨率的 MP4 / DASH 流媒体播放地址。 |
| 6 | `bilibili_get_comments` | `CommentAPI.replies` | 否 | **评论区检索**：支持按热度/最新时间排序获取评论及楼中楼回复。 |
| 7 | `bilibili_get_user_info` | `UserAPI.getInfo` / `getRelationStat` | 否 | **UP主画像**：查询 UP 主资料、粉丝数、关注数、获赞总量及个性签名。 |
| 8 | `bilibili_get_user_videos` | `Space / wbi arc search` | 否 | **UP主投稿**：分页查询指定 UP 主的所有投稿视频列表。 |
| 9 | `bilibili_get_my_info` | `UserAPI.getMyInfo` / `MessageAPI` | **是** | **个人数据中心**：查询当前登录用户的硬币数、等级、大会员状态及未读通知。 |
| 10 | `bilibili_view_history` | `HistoryAPI.history` | **是** | **观看历史**：查询当前账号的观看历史记录（附带观看进度百分比与时间点）。 |
| 11 | `bilibili_manage_toview` | `HistoryAPI` (list / add / del) | **是** | **稍后再看管理**：查询列表、添加视频或从列表移除视频。 |
| 12 | `bilibili_manage_favorite` | `FavoriteAPI.getCreatedFolders` | **是** | **收藏夹管理**：列出个人创建的所有收藏夹或获取指定收藏夹视频。 |
| 13 | `bilibili_video_interact` | `VideoAPI` (like / coin / triple) | **是** | **视频交互 (带确认)**：执行点赞、投币（1/2枚）、一键三连操作。 |
| 14 | `bilibili_send_comment` | `CommentArea.add` | **是** | **发表评论 (带确认)**：在指定视频下发表一级评论或回复他人评论。 |
| 15 | `bilibili_user_relation` | `UserAPI.modifyRelation` | **是** | **关系操作**：关注、取关或拉黑指定 UP 主。 |

---

## 四、单元测试实施方案

### 1. 测试工具选型
- 使用 **Vitest** 作为现代、极速的 TypeScript 测试执行器；
- 配置 `vitest.config.ts`，开启 Node 环境。

### 2. 测试模块划分与覆盖重点
- **测试套件 1：`test/vault-service.test.ts` (加密保险箱安全性测试)**
  - 验证密钥派生（PBKDF2 100,000次迭代）；
  - 验证 AES-256-GCM 加密与解密还原的准确性；
  - 验证错误密码抛出 `InvalidPasswordError`；
  - 验证密文篡改拦截（GCM AEAD AuthTag 认证失败）；
  - 验证公开账号摘要（AccountSummary）读取。
- **测试套件 2：`test/client-manager.test.ts` (状态与认证服务测试)**
  - 验证单例模式与生命周期；
  - 验证未解锁时的状态输出（`hasVault`, `isUnlocked: false`）；
  - 验证二维码生成输出（DataURL 有效性）；
  - 验证扫码状态映射（86101 waiting -> 86090 scanned -> 86038 expired -> 0 success）；
  - 验证登出时凭据销毁逻辑。
- **测试套件 3：`test/tools.test.ts` (DSH Agent 原生工具调用测试)**
  - 验证工具注册成功（15 个工具名称唯一且存在）；
  - 验证公开工具（如 `bilibili_search`、`bilibili_get_trends`、`bilibili_get_video_info`）在 Mock/真实请求下的执行体输出与 `render()` 文本渲染；
  - 验证需要登录的工具（如 `bilibili_get_my_info`、`bilibili_view_history`）在未登录状态下的拦截报错；
  - 验证高危写操作工具（`bilibili_video_interact`、`bilibili_send_comment`）在 `confirm=false` 时的安全拦截提示与 `confirm=true` 时的执行。

---

## 五、实施步骤与路线图

| 步骤 | 任务名称 | 关键动作与检查点 |
| :--- | :--- | :--- |
| **Step 1** | **方案设计与归档** | 将完整设计方案输出为 `plan.md` |
| **Step 2** | **测试环境安装与配置** | 安装 `vitest`，配置 `package.json` 中的 `test` 脚本 |
| **Step 3** | **编写并执行 Vault 单元测试** | 编写 `test/vault-service.test.ts`，测试加密解密防篡改 |
| **Step 4** | **编写并执行 ClientManager 单元测试** | 编写 `test/client-manager.test.ts`，测试状态与会话流转 |
| **Step 5** | **编写并执行 Tools 工具调用测试** | 编写 `test/tools.test.ts`，测试工具执行与安全拦截 |
| **Step 6** | **全量集成构建与验证** | 运行全量 `pnpm test` + `pnpm run build`，产物通过双端验证 |
