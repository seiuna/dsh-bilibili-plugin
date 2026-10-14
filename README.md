# dsh-bilibili-plugin

DeepSeek Harness (DSH) 的 Bilibili 原生插件，直接注册 Cordis 服务、Agent 工具与 Web 配置面板，不使用 MCP。

当前固定适配 **`@seiuna/bilibili-api@1.1.3`**，提供 **24 个 Agent 原生工具**、分步二维码登录、本地加密凭据、评论通知轮询与按内容归组的 DSH 会话。

- **[工具与 SDK API 完整映射](./docs/TOOLS_API.md)**：逐项列出已实现工具、所有分支、对应 SDK/HTTP API、鉴权和确认要求，以及未暴露的 SDK 能力。
- **[1.1.3 重构与验证报告](./docs/REFACTOR_1.1.3.md)**：模块结构、兼容性变化、测试结果、已反馈的上游缺陷及部署边界。

---

## 核心特性

1. **零 MCP 代理开销，DSH 原生工具直接注册**：
   - 摆脱额外 stdio 进程或 MCP 桥接带来的启动延迟和通信开销，工具直接注入 `ctx.tools`；
   - 工具声明 JSON Schema，并在执行层检查参数、业务错误码与数据缺失；所有工具返回标准 JSON（无图标、无渲染模板），请求统一经 `@seiuna/bilibili-api` 的 client 通道执行。
2. **专属 WebUI 登录空间（仅提供二维码登录）**：
   - 顶部导航栏专属胶囊状态（Header Pill）：实时显示登录态、头像、昵称与等级；
   - 弹出式独立登录抽屉/模态框（Overlay）：**严格仅提供二维码扫码登录**（免账号密码/短信，防泄露）；
   - 自动生成高清二维码，智能检测手机扫码、待确认、过期刷新与登录成功全流程。
3. **本地凭据加密保险箱（Vault）与动态解密**：
   - 扫码成功后引导用户设置本地主密码（Master Password）；
   - 基于 **PBKDF2-HMAC-SHA256 (100,000次迭代)** 派生密钥，使用 **AES-256-GCM** 对 Cookie / SESSDATA / bili_jct 进行强加密；
   - 密文保存于 `~/.dsh/storages/bilibili-vault.json`；启用“记住密码”会在独立的 `bilibili-key.json` 保存**明文解锁材料**，并非磁盘零明文；
   - 未配置自动解锁时通过 WebUI 输入密码；记住密码或设置 `BILIBILI_VAULT_PWD` 可在启动时自动解锁。Windows 文件保护依赖目录 ACL，不替代系统凭据库。
   - SDK 1.1.3 自动凭证刷新存在已确认的多 Cookie 解析缺陷，见 [上游 issue #11](https://github.com/seiuna/bilibili-api/issues/11)；需要刷新时可能需重新扫码，不承诺长期自动续期可靠。
4. **安全写操作拦截机制**：
   - 视频互动、动态互动、发评论工具默认 `confirm=false`，先核对后执行。
   - 关注关系和稍后再看增删保留原有立即写入接口，仍需明确授权；通知轮询的自动点赞/自动回复属于用户启用插件后的后台行为，不套用工具的 confirm 参数。

---

## 原生 Agent 工具矩阵 (24 个核心工具)

| 工具名称 | 功能说明 | 需登录 |
| :--- | :--- | :---: |
| `bilibili_search` | 全站综合搜索（支持视频、UP主、直播、专栏筛选） | 否 |
| `bilibili_get_trends` | 获取全站热搜词、热门综合视频、全站排行榜、入站必刷 | 否 |
| `bilibili_get_video_info` | 查询视频基本信息、UP主、播放/点赞/投币/收藏数、分P列表、标签 | 否 |
| `bilibili_get_video_ai_summary` | **视频官方 AI 摘要大纲**（分段大纲与时间戳，长视频速读神器） | 否 |
| `bilibili_get_video_play_url` | 获取视频分辨率规格及 MP4 / DASH 流媒体播放地址 | 否 |
| `bilibili_get_video_recommend` | 获取指定视频的相关推荐关联视频列表（同类热门、关联投稿等） | 否 |
| `bilibili_get_danmaku` | 获取指定视频分P的实时弹幕列表（时间抽样、提取高能点与弹幕梗） | 否 |
| `bilibili_get_comments` | 获取视频/动态评论区（热评、时间排序、子回复展开） | 否 |
| `bilibili_get_comment_detail` | **单条评论精准定位**（根据 RPID & OID 直接查单条评论、点赞与二级回复数） | 否 |
| `bilibili_get_sub_comments` | **楼中楼二级对话流**（获取指定根评论下的一页二级回复） | 否 |
| `bilibili_get_dynamic_detail` | **动态详情与正文解析**（完整正文、配图、UP主、转评赞数、所属评论区参数） | 否 |
| `bilibili_get_user_dynamics` | **UP 主动态列表**（分页查询 UP 主发表的最新图文、文字及转发动态） | 否 |
| `bilibili_get_article_info` | **专栏文章详情**（文章标题、作者、阅读/点赞统计及正文文本内容） | 否 |
| `bilibili_get_live_info` | **直播间实时状态**（开播状态、标题、分区、在线热度、主播信息） | 否 |
| `bilibili_get_user_info` | 查询 UP 主个人资料、粉丝数、关注数、获赞总量 | 否 |
| `bilibili_get_user_videos` | 分页查询指定 UP 主的投稿视频列表 | 否 |
| `bilibili_get_my_info` | 获取当前登录用户的硬币数、经验值、大会员状态、未读消息通知 | **是** |
| `bilibili_view_history` | 获取当前账号观看历史记录（含播放进度） | **是** |
| `bilibili_manage_toview` | 管理“稍后再看”列表（查询、添加、移除） | **是** |
| `bilibili_manage_favorite` | 管理收藏夹（列出收藏夹、读取指定收藏夹视频） | **是** |
| `bilibili_video_interact` | 视频点赞、投币（1/2枚）、一键三连（带安全确认保护） | **是** |
| `bilibili_dynamic_interact` | 动态点赞、取消点赞互动操作（带安全确认保护） | **是** |
| `bilibili_send_comment` | 在视频或动态下发表评论或回复他人（动态评论区自动解析校验，带安全确认保护） | **是** |
| `bilibili_user_relation` | 关注、取消关注或拉黑指定 UP 主 | **是** |

---

## 安装（npm 发布版）

插件运行在 DSH 的 profile 里，因此安装要落到具体 profile 目录（例如 `web`、`desktop`），不需要全局安装：

```powershell
# 1. 进入目标 profile 目录（Windows 为 %USERPROFILE%\.dsh\profiles\web）
cd ~/.dsh/profiles/web

# 2. 从 npm 安装
pnpm add dsh-bilibili-plugin

# 3. 编辑同目录 package.json，把包加入 bundles
```

```json
{
  "dependencies": {
    "dsh-bilibili-plugin": "^0.1.0"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-bilibili-plugin"]
    }
  }
}
```

`dependencies` 负责把包装进 profile，`dsh.profile.bundles` 才决定它是否被加载，两者都需要。完成后**完整重启 DSH 宿主**（只刷新页面不会重载后端），顶部出现 B站胶囊即表示加载成功。

升级与卸载：

```powershell
pnpm add dsh-bilibili-plugin@latest   # 升级
pnpm remove dsh-bilibili-plugin       # 卸载，并同步从 bundles 中删除该条目
```

---

## 本地安装与调试

### 1. 构建插件

```bash
pnpm install
pnpm run build
```

构建将由 `tsdown` 并行产出：
- `lib/index.js`（Node.js 宿主端 Cordis 插件与 HTTP 服务）
- `lib/client.js`（浏览器端 WebUI 模块，带 `window.__ModuleLoader__` 包装）

### 2. 在 DSH 中挂载

在用户的 DSH 运行时 Profile 目录（如 `~/.dsh/profiles/web/package.json`）的 `dependencies` 中引入本地软链接：

```json
{
  "dependencies": {
    "dsh-bilibili-plugin": "link:D:/project/dsh-bilibili-plugin"
  }
}
```

并在 Profile 的 `cordis.patch.yml` 中挂载：

```yaml
- insert:
    - id: bilibili
      name: dsh-bilibili-plugin
```

插件成功加载后，顶部 B站胶囊提供登录和配置入口。后端源码更新需完整重启现有 DSH 宿主；前端资源重建后刷新页面。未确认同安装目录的 HMR watcher 时，不保证自动更新；不要启动另一台服务器代替当前 GUI。

### 3. 离线验证

```powershell
pnpm run typecheck
pnpm test
pnpm run build
# 或一并执行：pnpm run check
```

默认测试拦截真实 fetch。真实账户预览测试默认跳过，只有明确授权且设置 `BILI_STATIC_TEST=1` 后才运行；不要把离线 mock 通过视为真实 B站/DSH 端到端通过。

本次 pnpm 因新版本发布年龄策略拒绝自动依赖安装，未放宽策略；使用现有依赖的直接 Node 入口完成验证，详见报告。

---

## B站会话归组

B站消息按所属内容归组，而不是按发送者归组：同一视频或动态下的不同用户、不同评论线程共用会话。归组使用业务类型与内容主体 ID，不使用评论 ID；不同工作区或模型配置仍隔离会话，避免混用运行目录和模型。旧的按用户会话保留历史，不自动迁移。

## 评论上下文

入站上下文按来源区分：视频使用视频标题，动态使用正文节选；根评论、机器人被回复的评论和当前用户消息分别标注。机器人评论须核对作者身份，不将任意父评论当作机器人发言。获取失败的字段应明确标记缺失，不用通知摘要伪装成正文。附件只使用当前评论的图片，不混入稿件封面、动态配图或根评论图片。

## 发布到 npm

### 1. 首次发布前的准备

1. 确认包名未被占用（`npm view dsh-bilibili-plugin version`，2026-10 查询为 404，可用）。
2. `package.json` 已含发布所需字段：`files` 白名单（`lib`、`skills`、`docs`、`cordis.patch.yml`、`README.md`）、`publishConfig.registry = https://registry.npmjs.org`、`engines.node >= 22`、`packageManager: pnpm@11.12.0`。
3. `lib/` 不入库，必须由构建产生：`prepublishOnly` 会在发布前自动跑 `pnpm run check`（typecheck + 测试 + 构建），任何一步失败都会中止发布。

本地预演（不会真正上传，需要 `lib/` 已构建）：

```powershell
pnpm install --frozen-lockfile
npm publish --dry-run   # 打印 tarball 清单，并触发 prepublishOnly
```

### 2. 凭据配置（二选一）

**方式 A：npm Trusted Publisher（推荐，无长期 token）**

在 npm 包页面 → Settings → Trusted Publisher 填：Publisher 选 GitHub Actions，Organization/user 填 `seiuna`，Repository 填 `dsh-bilibili-plugin`，Workflow 填 `publish-package.yml`，Environment 留空。之后 Actions 通过 OIDC 直接换发短期凭据，仓库里不存任何 secret。

**方式 B：Granular Access Token**

npm 生成 Automation 类型 token（权限 `Read and write`）→ GitHub 仓库 Settings → Secrets and variables → Actions → New repository secret，名称 `NPM_TOKEN`；然后在 `.github/workflows/publish-package.yml` 的发布步骤加上：

```yaml
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### 3. Actions 工作流

| 文件 | 触发 | 作用 |
| :--- | :--- | :--- |
| `.github/workflows/ci.yml` | push/PR 到 `main` | 冻结锁文件安装 → typecheck → 全量测试 → 构建 → `npm pack --dry-run` 校验发布清单，并上传 `lib/` 产物 |
| `.github/workflows/publish-package.yml` | GitHub Release `published`；也可手动 `workflow_dispatch` 走 dry-run | 校验 tag 与 `package.json` 版本一致 → 构建 → `npm publish --access public --provenance` |
| `.github/workflows/release-drafter.yml` | push 到 `main` | 自动维护 Release 草稿 |

工作流里有三个容易踩的坑，已在配置中处理：

1. **不能用 `npm ci`**：仓库只有 `pnpm-lock.yaml`，没有 `package-lock.json`，CI 与发布都使用 `pnpm install --frozen-lockfile`。
2. **必须覆盖 registry**：仓库内 `.npmrc` 指向 `registry.npmmirror.com`（仅镜像读取），工作流用 `NPM_CONFIG_REGISTRY`、`setup-node` 的 `registry-url` 和 `publishConfig.registry` 三处显式压回官方源，否则会推到镜像或直接 404。
3. **tag 必须等于版本号**：发布步骤先比对 `GITHUB_REF_NAME`（去掉前缀 `v`）与 `package.json` 的 `version`，不一致立即失败，避免打出错误版本的包。

### 4. 发版流程

```powershell
git switch main
git pull
pnpm version patch          # 或 minor / major，生成 commit 与 vX.Y.Z tag
git push origin main --follow-tags
```

然后在 GitHub 上把 Release Drafter 的草稿标题改成 `vX.Y.Z` 并发布（Publish release）。Release 一旦 published，publish 工作流自动执行；发布成功后可用 `npm view dsh-bilibili-plugin version` 与 `npm view dsh-bilibili-plugin dist.integrity` 核对。

### 5. 当前未完成的部分

- 仓库目前是 **private**，且还没有远端分支与 Release：Actions 需要先把 `main` 推上去才会运行；Release Drafter 的 `push: main` 触发同样依赖远端 `main`。
- `@deepseek-ai/*`（cordis、dsh-tools、dsh-session 等）是运行时由 DSH 宿主提供的 peer 依赖，不在 npm 公共源上，因此 `peerDependenciesMeta` 全部标为 optional，消费方无需也无法单独安装；CI 只做类型检查与离线测试，不代表真实 DSH 端到端加载通过。
- `npm publish --dry-run` 仅验证了本机清单与 `prepublishOnly` 全通过；真实发布与 Actions 运行结果尚未验证。

---

## 许可证

[MIT](./LICENSE)
