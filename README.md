# dsh-bilibili-plugin

给 DeepSeek Harness（DSH） 用的 B站插件。装好后，可以让 Agent 搜索视频、查看评论和动态，也可以登录自己的账号，查询观看历史、管理稍后再看，或在确认后点赞、投币和回复评论。

插件直接接入 DSH 的工具、会话和 Web 界面，不需要另起 MCP 服务。目前提供 24 个工具，使用的 SDK 版本为 `@seiuna/bilibili-api@1.1.3`。

## 能做什么

- 搜索视频、UP 主、直播和专栏，查看热搜与榜单。
- 获取视频详情、官方 AI 摘要、播放地址、相关推荐和弹幕。
- 读取评论、楼中楼回复、UP 主动态、专栏正文和直播间状态。
- 登录后查询自己的账号信息、观看历史、稍后再看和收藏夹。
- 点赞、投币、一键三连、发评论，以及关注、取消关注或拉黑用户。
- 轮询回复和 @ 通知，把消息交给 DSH Agent 处理；也支持配置自动点赞和自动回复。

登录和配置入口在 DSH 顶部的 B站按钮中。登录只支持扫码，不需要在插件里输入 B站账号密码。

## 安装

需要 Node.js 22 或更新版本，以及可运行的 DSH 环境。`@deepseek-ai/*` 依赖由 DSH 宿主提供，无需单独安装。

### 从 npm 安装

进入要使用插件的 DSH profile 目录。下面以 `web` 为例，桌面端请换成对应目录：

```powershell
cd ~/.dsh/profiles/web
pnpm add dsh-bilibili-plugin
```

在同目录的 `package.json` 中，将 `dsh-bilibili-plugin` 加入 `dsh.profile.bundles`。保留已有配置，只补上插件这一项：

```json
{
  "dependencies": {
    "dsh-bilibili-plugin": "^0.1.0"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-bilibili-plugin"
      ]
    }
  }
}
```

`dependencies` 负责安装包，`bundles` 决定 DSH 是否加载它，两处都需要配置。完成后退出并重新启动 DSH，顶部出现 B站按钮就说明插件已加载。只刷新网页不会重新加载后端插件。

如果 npm 上还没有可用版本，可以按下方的本地开发步骤安装。

升级时，在同一个 profile 目录执行：

```powershell
pnpm add dsh-bilibili-plugin@latest
```

卸载时执行 `pnpm remove dsh-bilibili-plugin`，同时从 `bundles` 中移除插件，再重启 DSH。

## 登录与配置

1. 点击 DSH 顶部的 B站按钮，打开登录面板。
2. 用 B站客户端扫码，并在手机上确认。
3. 按提示设置本地解锁密码，用于加密保存登录凭据。
4. 登录后，在面板中配置通知轮询、自动回复、模型和工作区等选项。

登录凭据使用 AES-256-GCM 加密，保存在 `~/.dsh/storages/bilibili-vault.json`；密钥通过 PBKDF2-HMAC-SHA256 派生，迭代 100,000 次。

默认需要在界面中输入密码解锁。勾选“记住密码”后，插件会在独立的 `bilibili-key.json` 中保存**明文解锁材料**，以便下次启动自动解锁；也可以通过环境变量 `BILIBILI_VAULT_PWD` 提供密码。是否启用自动解锁，请根据电脑的使用环境选择。Windows 下的文件访问保护依赖目录 ACL。

SDK 1.1.3 的凭据自动刷新有一个已确认的多 Cookie 解析问题，登录失效后可能需要重新扫码，详见 [上游 issue #11](https://github.com/seiuna/bilibili-api/issues/11)。

### 账号操作与确认

视频互动、动态互动和发评论这三个工具默认只返回操作预览，传入 `confirm=true` 才会执行。Agent 应先向你说明具体目标和操作，得到同意后再提交。

关注、取消关注、拉黑，以及“稍后再看”的添加和移除会直接执行，没有额外的 `confirm` 参数，调用前同样需要取得你的授权。

面板中的自动点赞和自动回复是后台功能，启用后会按配置运行，不会每次弹出确认。开启前请检查相关设置。

## 工具列表

下表中的“无需登录”表示工具不要求本地解锁。实际请求仍受 B站风控、地区、会员和接口权限限制，部分内容可能无法匿名读取。

| 工具 | 用途 | 需要登录 |
| --- | --- | :---: |
| `bilibili_search` | 综合搜索，支持按视频、UP 主、直播和专栏筛选本页结果 | 否 |
| `bilibili_get_trends` | 热搜、热门视频、排行榜和入站必刷 | 否 |
| `bilibili_get_video_info` | 视频详情、统计数据、分 P 和标签 | 否 |
| `bilibili_get_video_ai_summary` | 官方 AI 摘要和分段大纲，取决于视频是否已有摘要 | 否 |
| `bilibili_get_video_play_url` | MP4 / DASH 播放地址，画质取决于账号权限 | 否 |
| `bilibili_get_video_recommend` | 视频相关推荐 | 否 |
| `bilibili_get_danmaku` | 当前弹幕池中的弹幕，非全量历史弹幕 | 否 |
| `bilibili_get_comments` | 评论区内容，支持热度和时间排序 | 否 |
| `bilibili_get_comment_detail` | 根据评论区 ID 和评论 ID 定位单条评论 | 否 |
| `bilibili_get_sub_comments` | 指定根评论下的一页楼中楼回复 | 否 |
| `bilibili_get_dynamic_detail` | 动态正文、配图、作者和评论区信息 | 否 |
| `bilibili_get_user_dynamics` | 分页读取 UP 主动态 | 否 |
| `bilibili_get_article_info` | 专栏标题、作者、统计数据和正文文本 | 否 |
| `bilibili_get_live_info` | 直播间状态、标题、分区和人气值 | 否 |
| `bilibili_get_user_info` | UP 主资料、粉丝数和关注数等 | 否 |
| `bilibili_get_user_videos` | 分页读取 UP 主投稿 | 否 |
| `bilibili_get_my_info` | 当前账号信息和未读通知数量 | 是 |
| `bilibili_view_history` | 观看历史和播放进度 | 是 |
| `bilibili_manage_toview` | 查询、添加和移除稍后再看 | 是 |
| `bilibili_manage_favorite` | 读取收藏夹列表和收藏夹内容 | 是 |
| `bilibili_video_interact` | 点赞、投币和一键三连，执行前需要确认 | 是 |
| `bilibili_dynamic_interact` | 点赞或取消点赞动态，执行前需要确认 | 是 |
| `bilibili_send_comment` | 在视频或动态下评论、回复，执行前需要确认 | 是 |
| `bilibili_user_relation` | 关注、取消关注或拉黑用户 | 是 |

工具参数、分页限制和对应的 SDK API 见 [工具与 API 对照](./docs/TOOLS_API.md)。

播放地址有时效，DASH 通常是音视频分离的，拿到地址不代表能直接在浏览器中播放。收藏夹工具目前只支持读取，不支持创建、删除或修改收藏夹。

## 评论与会话

同一视频或动态下的消息会放进同一个 DSH 会话，包括不同用户、不同楼层的评论，方便 Agent 延续讨论。不同内容、工作区和模型配置之间的会话仍然隔离。旧版按用户划分的会话会保留，不自动合并历史。

处理通知时，插件会补充视频标题或动态正文节选，并区分当前评论、根评论和相关的机器人回复。取不到的信息会标记为缺失。图片附件只取当前评论自带的图片，不会混入视频封面、动态配图或其他评论的图片。

通知轮询目前每轮只读取已启用通知类型的一页结果，不会继续翻页；通知较多时可能漏掉更早的消息。

## 本地开发

克隆仓库并构建：

```bash
git clone https://github.com/seiuna/dsh-bilibili-plugin.git
cd dsh-bilibili-plugin
pnpm install
pnpm run build
```

构建产物在 `lib/` 中：`index.js` 是宿主端插件，`client.js` 是 Web 界面模块。

在目标 DSH profile 的 `package.json` 中添加本地依赖，将路径换成你的仓库路径：

```json
{
  "dependencies": {
    "dsh-bilibili-plugin": "link:D:/project/dsh-bilibili-plugin"
  }
}
```

然后在该 profile 的 `cordis.patch.yml` 中添加：

```yaml
- insert:
    - id: bilibili
      name: dsh-bilibili-plugin
```

修改后端代码后，重新构建并重启 DSH；只修改前端时，重建后刷新页面。`pnpm run dev` 可以监听源码并重新构建，宿主是否自动重载取决于当前 DSH 环境。

### 检查与测试

```bash
pnpm run typecheck
pnpm test
pnpm run build
```

也可以用 `pnpm run check` 一次执行以上三项。

默认测试使用模拟请求。真实账号预览测试默认跳过，只有在明确授权并设置 `BILI_STATIC_TEST=1` 后才运行。离线测试通过不代表已经验证真实 B站请求或 DSH 中的完整使用流程。

SDK 适配、测试范围和已知问题见 [1.1.3 重构与验证记录](./docs/REFACTOR_1.1.3.md)。

## 发布

发布前运行 `pnpm run check`，再用 `npm publish --dry-run` 检查打包内容。`lib/` 不提交到仓库，需要先构建；正式发布时，`prepublishOnly` 也会执行完整检查。

仓库的 CI 会在向 `main` 推送或提交 PR 时运行检查。发布 npm 包由 GitHub Release 的 `published` 事件触发，需要在仓库的 Actions secrets 中配置 `NPM_TOKEN`。

发版步骤：

```bash
git switch main
git pull
pnpm version patch
git push origin main --follow-tags
```

随后在 GitHub 发布对应 tag 的 Release。tag 去掉 `v` 后必须与 `package.json` 中的版本一致，否则发布工作流会失败。

发布工作流已将 registry 指向 npm 官方源。更换 npm token 或调整发布配置时，可参考 [发布工作流](./.github/workflows/publish-package.yml)。

## 反馈问题

遇到问题可以在 [Issues](https://github.com/seiuna/dsh-bilibili-plugin/issues) 中反馈。请附上 DSH 和插件版本、复现步骤，以及相关的报错日志；提交前记得去掉 Cookie、密码、Token 和私人评论内容。

## 许可证

[MIT](./LICENSE)
