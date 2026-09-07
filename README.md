# dsh-bilibili-plugin

DeepSeek Harness (DSH) 的 Bilibili 全功能原生插件与 WebUI 登录空间。

基于 `@seiuna/bilibili-api` 深度打造，遵循 DSH 的 Cordis 微内核架构规范，集成了 **面向 LLM 的 15 个高内聚 Agent 原生工具**、**专用的 WebUI 纯二维码扫码登录空间**，以及 **PBKDF2 + AES-256-GCM 强加密凭据保险箱（Vault）**。

---

## 核心特性

1. **零 MCP 代理开销，DSH 原生工具直接注册**：
   - 摆脱额外 stdio 进程或 MCP 桥接带来的启动延迟和通信开销，工具直接注入 `ctx.tools`；
   - 参数经过 Zod / JSON Schema 严格校验，包含优雅的 Markdown 结构化输出渲染。
2. **专属 WebUI 登录空间（仅提供二维码登录）**：
   - 顶部导航栏专属胶囊状态（Header Pill）：实时显示登录态、头像、昵称与等级；
   - 弹出式独立登录抽屉/模态框（Overlay）：**严格仅提供二维码扫码登录**（免账号密码/短信，防泄露）；
   - 自动生成高清二维码，智能检测手机扫码、待确认、过期刷新与登录成功全流程。
3. **企业级凭据加密保险箱（Vault）与动态解密**：
   - 扫码成功后引导用户设置本地主密码（Master Password）；
   - 基于 **PBKDF2-HMAC-SHA256 (100,000次迭代)** 派生密钥，使用 **AES-256-GCM** 对 Cookie / SESSDATA / bili_jct 进行强加密；
   - 密文保存于 `~/.dsh/storages/bilibili-vault.json`，**磁盘零明文**；
   - 每次 DSH 启动时凭据处于加锁状态，用户在 WebUI 中一键输入密码动态解密加载到内存；亦支持通过 `BILIBILI_VAULT_PWD` 环境变量供无头/自动化环境静默解密。
4. **安全写操作拦截机制**：
   - 点赞、投币、一键三连、发评论等涉及账号资产与公开留言的操作，默认启用 `confirm=false` 安全防护，先向用户核对，得到确认后再执行。

---

## 原生 Agent 工具矩阵 (15 个核心工具)

| 工具名称 | 功能说明 | 需登录 |
| :--- | :--- | :---: |
| `bilibili_search` | 全站综合搜索（支持视频、UP主、直播、专栏筛选） | 否 |
| `bilibili_get_trends` | 获取全站热搜词、热门综合视频、全站排行榜、入站必刷 | 否 |
| `bilibili_get_video_info` | 查询视频基本信息、UP主、播放/点赞/投币/收藏数、分P列表、标签 | 否 |
| `bilibili_get_video_ai_summary` | **视频官方 AI 摘要大纲**（分段大纲与时间戳，长视频速读神器） | 否 |
| `bilibili_get_video_play_url` | 获取视频分辨率规格及 MP4 / DASH 流媒体播放地址 | 否 |
| `bilibili_get_comments` | 获取视频/动态评论区（热评、时间排序、楼中楼展开） | 否 |
| `bilibili_get_user_info` | 查询 UP 主个人资料、粉丝数、关注数、获赞总量 | 否 |
| `bilibili_get_user_videos` | 分页查询指定 UP 主的投稿视频列表 | 否 |
| `bilibili_get_my_info` | 获取当前登录用户的硬币数、经验值、大会员状态、未读消息通知 | **是** |
| `bilibili_view_history` | 获取当前账号观看历史记录（含播放进度） | **是** |
| `bilibili_manage_toview` | 管理“稍后再看”列表（查询、添加、移除） | **是** |
| `bilibili_manage_favorite` | 管理收藏夹（列出收藏夹、读取指定收藏夹视频） | **是** |
| `bilibili_video_interact` | 视频点赞、投币（1/2枚）、一键三连（带安全确认保护） | **是** |
| `bilibili_send_comment` | 在指定视频下发表一级评论或回复他人（带安全确认保护） | **是** |
| `bilibili_user_relation` | 关注、取消关注或拉黑指定 UP 主 | **是** |

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

启动 DSH 即可在顶部操作栏看到 `[ 📺 登录 B 站 ]` 胶囊，点击即可开始扫码！

---

## 许可证

[MIT](./LICENSE)
