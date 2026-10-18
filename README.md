# @seiuna/dsh-bilibili-plugin

一个给 DeepSeek Harness（DSH） 用的 B站插件。

想让 Agent 帮你找视频、翻评论，或者接着 B站评论区里的话题聊下去，可以试试这个插件。它把 B站工具和登录面板接进了 DSH，不用另外启动 MCP 服务。

登录后，还能查观看历史、整理稍后再看，以及点赞、投币和回复评论。登录、模型和自动回复等设置都在 DSH 顶部的 B站按钮里。

## 可以拿它做什么

- **找内容**：搜视频、UP 主、直播和专栏，看看热搜、热门视频和排行榜。
- **看内容**：读取视频详情、官方 AI 摘要、评论、弹幕、动态和专栏正文，查询直播间状态。
- **处理自己的账号内容**：查看观看历史、稍后再看和收藏夹，添加或移除稍后再看。
- **参与互动**：点赞、投币、一键三连、发评论，以及关注、取消关注或拉黑用户。
- **接入评论区**：轮询回复和 @ 通知，把消息交给 DSH Agent；也可以在面板中开启自动点赞、自动回复。

目前有 24 个工具，基于 `@seiuna/bilibili-api@1.1.3`。完整工具列表见下文。

## 安装

先准备好能正常运行的 DSH 和 Node.js 22 或更新版本。`@deepseek-ai/*` 依赖由 DSH 宿主提供。

进入你使用的 DSH profile 目录安装。下面以 `web` 为例，桌面端换成自己的 profile 目录：

```powershell
cd ~/.dsh/profiles/web
pnpm add @seiuna/dsh-bilibili-plugin
```

然后打开同目录的 `package.json`，在 `dsh.profile.bundles` 里加上 `@seiuna/dsh-bilibili-plugin`。原来的配置保留，只补这一项：

```json
{
  "dependencies": {
    "@seiuna/dsh-bilibili-plugin": "^1.0.4"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@seiuna/dsh-bilibili-plugin"
      ]
    }
  }
}
```

这里有两步：`pnpm add` 把包安装下来，`bundles` 让 DSH 加载它。配好后，退出并重新启动 DSH。顶部出现 B站按钮，就可以开始用了。只刷新网页不会重新加载后端插件。

如果 npm 暂时没有可用版本，可以按后面的「本地开发」步骤从源码安装。

### 升级和卸载

升级时，在同一个 profile 目录运行：

```powershell
pnpm add @seiuna/dsh-bilibili-plugin@latest
```

卸载时运行 `pnpm remove @seiuna/dsh-bilibili-plugin`，再从 `bundles` 中删掉插件。两种操作完成后都需要重启 DSH。

## 登录和使用

点击顶部的 B站按钮，用 B站客户端扫码，在手机上确认登录，再按提示设置本地解锁密码。插件只提供扫码登录，不需要输入 B站账号密码。

登录后，可以在面板里设置通知轮询、自动回复、使用的模型和工作区。也可以直接在 DSH 对话里提出请求，比如：

> 帮我找几个讲二叉树遍历的视频。
>
> 看看这个视频的热门评论。
>
> 把这个视频加到稍后再看。

工具能获取官方 AI 摘要，但前提是 B站已经为该视频生成了摘要。播放地址也有时效，DASH 通常是音视频分离的，拿到地址后不一定能直接在浏览器里播放。

### 点赞、评论等操作怎么确认

点赞、投币、一键三连、动态点赞和发评论，默认会先返回操作预览。Agent 应先告诉你要对什么内容做什么，得到同意后，再用 `confirm=true` 执行。

关注、取消关注、拉黑，以及添加或移除稍后再看，没有额外的 `confirm` 参数，调用后会直接执行，调用前同样需要你的授权。

**自动点赞和自动回复开启后会在后台按配置运行，不会逐条询问。** 开启前先检查面板中的设置。

### 登录信息存在哪里

登录凭据加密保存在 `~/.dsh/storages/bilibili-vault.json`，使用 AES-256-GCM 加密，密钥通过 PBKDF2-HMAC-SHA256 派生（100,000 次迭代）。默认需要在界面中输入密码解锁，也可以通过环境变量 `BILIBILI_VAULT_PWD` 提供密码。

如果勾选「记住密码」，插件会在独立的 `bilibili-key.json` 中保存**明文解锁材料**，供下次启动时自动解锁。共用电脑上请留意这一点；Windows 下的文件访问保护依赖目录 ACL。

SDK 1.1.3 的凭据自动刷新存在多 Cookie 解析问题，登录失效后可能需要重新扫码，进展见 [上游 issue #11](https://github.com/seiuna/bilibili-api/issues/11)。

## 评论区接入 DSH 后是什么样的

同一个视频或动态下的评论会进入同一个 DSH 会话，不同用户、不同楼层可以接着聊。不同内容、工作区和模型配置之间仍然分开。旧版按用户划分的会话会保留，历史记录不会自动合并。

收到通知时，插件会尽量补上视频标题或动态正文，以及相关的根评论和机器人回复，让 Agent 知道在聊什么。查不到的信息会标记为缺失。图片附件只使用当前评论自带的图片。

目前每轮轮询只读取已启用通知类型的一页结果，不会继续翻页。如果短时间内通知很多，可能漏掉较早的消息。

## 工具列表

下面的「无需登录」指工具不要求本地解锁。B站仍可能因为风控、地区、会员或接口权限限制请求，不能保证所有内容都能匿名读取。

| 工具 | 用途 | 需要登录 |
| --- | --- | :---: |
| `bilibili_search` | 综合搜索，可按视频、UP 主、直播和专栏筛选本页结果 | 否 |
| `bilibili_get_trends` | 热搜、热门视频、排行榜和入站必刷 | 否 |
| `bilibili_get_video_info` | 视频详情、统计数据、分 P 和标签 | 否 |
| `bilibili_get_video_ai_summary` | 官方 AI 摘要和分段大纲 | 否 |
| `bilibili_get_video_play_url` | MP4 / DASH 播放地址，画质取决于账号权限 | 否 |
| `bilibili_get_video_recommend` | 视频相关推荐 | 否 |
| `bilibili_get_danmaku` | 当前弹幕池中的弹幕，不含全量历史弹幕 | 否 |
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
| `bilibili_video_interact` | 点赞、投币和一键三连，需确认 | 是 |
| `bilibili_dynamic_interact` | 点赞或取消点赞动态，需确认 | 是 |
| `bilibili_send_comment` | 在视频或动态下评论、回复，需确认 | 是 |
| `bilibili_user_relation` | 关注、取消关注或拉黑用户 | 是 |

收藏夹目前只能读取，不能创建、删除或修改。各工具的参数、分页限制和 SDK 调用见 [工具与 API 对照](./docs/TOOLS_API.md)。

## 本地开发

```bash
git clone https://github.com/seiuna/dsh-bilibili-plugin.git
cd dsh-bilibili-plugin
pnpm install
pnpm run build
```

构建产物在 `lib/` 中，`index.js` 是宿主端插件，`client.js` 是 Web 界面模块。

在目标 DSH profile 的 `package.json` 中添加本地依赖，路径换成你的仓库路径：

```json
{
  "dependencies": {
    "@seiuna/dsh-bilibili-plugin": "link:D:/project/dsh-bilibili-plugin"
  }
}
```

再在该 profile 的 `cordis.patch.yml` 中添加：

```yaml
- insert:
    - id: bilibili
      name: '@seiuna/dsh-bilibili-plugin'
```

`pnpm run dev` 可以监听源码并重新构建。修改后端后需要重建并重启 DSH；只改前端时，重建后刷新页面即可。宿主是否自动重载，取决于当前 DSH 环境。

### 检查和测试

```bash
pnpm run typecheck
pnpm test
pnpm run build
```

也可以运行 `pnpm run check`，一次执行这三项。

默认测试使用模拟请求，真实账号预览测试默认跳过。只有在明确授权并设置 `BILI_STATIC_TEST=1` 后才运行真实账号预览。离线测试通过，只能说明对应的模拟场景通过，不能代替真实 B站请求和 DSH 中的完整使用验证。

SDK 适配和已知问题记录在 [1.1.3 重构与验证记录](./docs/REFACTOR_1.1.3.md)。

### 发布

发布前先运行 `pnpm run check`，再用 `npm publish --dry-run` 查看打包内容。`lib/` 不提交到仓库，需要先构建；正式发布时，`prepublishOnly` 也会执行完整检查。

```bash
git switch main
git pull
pnpm version patch
git push origin main --follow-tags
```

然后在 GitHub 发布对应 tag 的 Release。tag 去掉 `v` 后，要与 `package.json` 中的版本一致。

仓库 CI 会在推送到 `main` 或提交 PR 时运行检查。npm 发布由 Release 的 `published` 事件触发，使用 Trusted Publishing，无需配置 `NPM_TOKEN`。首次手动发布后，在 npm 包设置的 Trusted Publisher 中选择 GitHub Actions，填写用户 `seiuna`、仓库 `dsh-bilibili-plugin`、工作流文件名 `publish-package.yml`，环境名留空，并允许直接发布。[发布工作流](./.github/workflows/publish-package.yml)已指定 npm 官方源。

## 遇到问题

欢迎到 [Issues](https://github.com/seiuna/dsh-bilibili-plugin/issues) 反馈。带上 DSH 和插件版本、复现步骤、相关报错日志，会更容易定位。

贴日志前，记得去掉 Cookie、密码、Token 和私人评论内容。

## 许可证

[MIT](./LICENSE)
