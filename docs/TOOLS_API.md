# Bilibili 工具 → SDK 1.1.3 API 映射

## 核对基线与组织

本文按本地安装的 `@seiuna/bilibili-api@1.1.3` 实际 `dist/index.d.ts` **及 dist JavaScript 实现**核对，不按旧版 README 推测。插件注册 **24 个工具**，不是 28 个；分支操作不另计工具。本次没有为了覆盖 SDK 而新增工具名。

入口 `src/tools.ts` 保持导出 `registerBilibiliTools`，实现位于：

| 模块 | 工具数 | 范围 |
| --- | ---: | --- |
| `src/tools/discovery.ts` | 2 | 综合搜索、4类榜单 |
| `src/tools/video.ts` | 6 | 详情、AI摘要、播放流、推荐、弹幕、视频互动 |
| `src/tools/comments.ts` | 4 | 顶层评论、精确评论、楼中楼、发评论 |
| `src/tools/users.ts` | 4 | UP资料、投稿、本人信息、关注关系 |
| `src/tools/library.ts` | 3 | 历史、稍后再看、收藏夹查询 |
| `src/tools/dynamics.ts` | 3 | 动态详情、空间动态、动态互动 |
| `src/tools/content.ts` | 2 | 专栏、直播间 |
| `src/tools/shared.ts` / `index.ts` | — | 类型推断、参数校验、响应检查、注册/回滚/释放 |

注册返回幂等释放函数；部分注册失败会逆序回滚已注册工具；某个释放函数抛错不阻止其余释放。所有业务模块不依赖 `any`；SDK 声明不完整的动态模块/评论置顶字段在窄边界显式解析。

## 共同行为与安全边界

- **公开读取**：使用 `manager.getClient()`，不要求本地解锁；实际仍可能使用当前客户端 Cookie，且受 B站登录、会员、风控、地区和接口权限限制。“无需本地鉴权”不承诺匿名访问一定成功。
- **需登录**：使用 `manager.requireAuthedClient()`，本地锁定/缺少有效凭据时拒绝。不自动登录、不扫码、不自动解锁。
- **确认保护**：`bilibili_video_interact`、`bilibili_send_comment`、`bilibili_dynamic_interact` 默认仅预览，严格 `confirm === true` 才写入；字符串 `"true"` 拒绝。确认前也校验动作、ID、金额与回复目标，预览不发 SDK 请求。不得把一次工具参数设置本身当作独立的人类授权。
- **输出契约**：所有工具返回**标准 JSON**（text block 内容为 `JSON.stringify(result, null, 2)`），不使用图标、emoji 或散文渲染模板；缺失值保持 `null`/缺省键，未知不写成 0，`warnings` 以 JSON 字段携带。日期字段为 ISO 8601（UTC）。
- **请求通道**：工具不自行发起 HTTP 请求、不使用全局 `fetch`、不复制 SDK 的 Cookie/CSRF/WBI 实现。全部请求经 bilibili-api 的 `BiliClient` 执行（SDK 静态 API 均以 client 为传输，自动注入 Cookie/CSRF/WBI 并走凭证刷新）。唯一例外是表 #8 的 typed 扩展 `client.request(...)`（仍是 client 的统一请求通道），因 SDK 1.1.3 没有投稿列表方法。
- **兼容的立即写入工具**：`bilibili_user_relation` 和 `bilibili_manage_toview` 的 add/delete 没有新加 confirm 参数，以保留原接口。它们仍是真实账号写操作，调用者必须先取得明确授权；并非只读或已经存在二阶段确认。所有写分支检查 `code` 后才宣告成功，不自动重试。
- **响应检查**：SDK 静态方法通常返回原始 `BiliApiResponse`；`BiliClient.request()` 的实现明确不自动检查业务 `code`。插件统一 `checkCode` / `dataOf`；主读取缺失 data 抛错，不返回伪空列表；合法的 `replies: null` 可表示空页。写 API 允许成功时 `data: null`，但需要发表评论 RPID/三连各项状态的分支要求结果数据。
- **部分信息**：标签、UP附加统计、本人未读、主播资料等可选查询失败时保留主结果并给 `warnings`，不把不可用计数填成 0。专栏两个 API 均失败则失败，一个成功可返回部分内容。上游错误信息不原样回显，避免把潜在敏感请求内容暴露给工具使用者；错误保留操作名及 code。
- **标识符**：数值输入必须为正安全整数，分页/limit 有上限；不安全数字不转换成“精确”字符串。动态ID始终保持字符串。精确评论 `oid` schema 改为字符串以支持长ID，执行层仍兼容原来的安全整数；RPID、根/父字符串优先。其他 SDK 声明为 number 的评论分页/写入参数仍只接受安全整数：这是工具约束，SDK 实现本身通常通过 `String(...)` 序列化，不声称其运行时绝对不能处理字符串。
- **日期输出**：有时间戳的字段改为确定性的 ISO 8601（UTC），动态保留上游相对时间文本优先；不再依赖宿主地区格式。

## 24 个工具与所有分支

下表只列工具直接业务 API。WBI签名密钥获取、凭据刷新等 SDK 内部请求不另计工具/API分支。

| # | 工具名 | SDK1.1.3 调用 / 分支 | 鉴权与确认 | 输出与限制 |
| --- | --- | --- | --- | --- |
| 1 | `bilibili_search` | `SearchAPI.searchAll(client, keyword)`；all/video/bili_user/live/article **本地筛选综合搜索本页** | 公开读取 | live 同时包含 live、live_room、live_user；分类结果 total=过滤后本页条数，`totalScope=filtered_page`；all保留上游total。非独立分类搜索/全量分页。HTML标题解码；保留视频BV、UID、直播roomId、articleId等。 |
| 2 | `bilibili_get_trends` | hot → `SearchAPI.getHotSearch(client,20)`；popular → `RankingAPI.getPopular(client,1,20)`；ranking → `RankingAPI.getRanking(client)`；precious → `RankingAPI.getPreciousVideos(client)` | 公开读取 | 未知category拒绝，不悄悄当popular；每分支检查code/data/list；热搜不透传上游 icon 字段，输出无图标。 |
| 3 | `bilibili_get_video_info` | `VideoAPI.getInfo(client,bvid,aid)` + 可选 `VideoAPI.getTags(client,aid,bvid,cid)` | 公开读取 | title/owner/stat/desc/pages/tags；stat 是总体点赞投币收藏**计数**，不是当前账号是否点赞。标签失败 → tags=null + warnings。BV/AV同时提供需一致。 |
| 4 | `bilibili_get_video_ai_summary` | 总是先 `VideoAPI.getInfo` 取aid/upMid/默认cid，再 `VideoAPI.getAiSummary(client,cid,aid,bvid,upMid)` | 公开读取 | 检查外层与内层code；摘要未生成 → available=false，和接口失败分开；outline保留格式化时间点。 |
| 5 | `bilibili_get_video_play_url` | 未提供cid时 `VideoAPI.getInfo`；`VideoAPI.getPlayUrl(client,cid,{bvid,qn:80默认,fnval:16})` | 公开读取，画质受权限限制 | 按返回quality选择DASH视频，不盲取首条；保留完整dash和durl多段地址；音视频分离，地址有时效，不能保证直接浏览器可播。 |
| 6 | `bilibili_get_comments` | `CommentAPI.getReplies(client,oid,replyType,sort,0,1,20)`，hot=1，time=0 | 公开读取 | 兼容bvid/aid；新增oid+replyType以使原有“动态/专栏”描述真正可用。视频默认为type1；动态须使用真实评论区OID。SDK单页API替代手写URL；合并upper.top、top.upper/admin、top_replies、hots/replies，去重；time保持普通评论顺序。 |
| 7 | `bilibili_get_user_info` | `UserAPI.getInfo(client,mid)` + 可选 `getRelationStat(client,mid)` / `getUpStat(client,mid)` | 公开读取 | 核心资料失败则失败；附加计数不可用为null+warnings。 |
| 8 | `bilibili_get_user_videos` | **SDK无专用方法**（UserAPI 无投稿列表，全 SDK 无 `arc/search` 封装）；`client.request<ApiResponse<SpaceVideosData>>("…/x/space/wbi/arc/search?mid&pn&ps",{wbi:true})` | 公开读取 | 全工具层唯一 URL 构造点，经 client.request（client 统一请求通道）执行；page默认1，pageSize默认10/最大50；返回本页，total取page.count；不虚构不存在的UserAPI.getVideos。 |
| 9 | `bilibili_get_my_info` | `UserAPI.getMyInfo(client)` + 可选 `MessageAPI.unreadCount(client)` | 需登录，只读 | 本人mid/name/coins/level/vipStatus/unread；未读失败为null+warnings，不伪造全部已读。 |
| 10 | `bilibili_view_history` | `HistoryAPI.getHistory(client,limit)` | 需登录，只读 | limit默认15/最大30；只取一页。不用会静默终止的history generator。 |
| 11 | `bilibili_manage_toview` | list → `HistoryAPI.getToViewList`；add → `HistoryAPI.addToView(client,aid)`；delete → `HistoryAPI.removeFromView(client,aid)` | 全部需登录；增删立即写入，须授权 | BV转AV本地完成；所有增删检查code。list可空，响应字段缺失不等于空。 |
| 12 | `bilibili_manage_favorite` | list_folders → `FavoriteAPI.getCreatedFolders(client,mid)`；get_folder → `FavoriteAPI.getFolderList(client,mediaId,20,1)` | 需登录，只读 | mid来自client.userId并校验；只读，不新建/删除/修改收藏夹；内容仅第一页。 |
| 13 | `bilibili_video_interact` | like → `VideoAPI.like(client,aid,1)`；coin → `VideoAPI.coin(client,aid,multiply,1)`；triple → `VideoAPI.triple(client,aid)` | 需登录；三分支均须confirm=true | coin仅1/2枚且同时点赞；multiply仅coin生效，非coin显式传入拒绝。triple硬币数由上游决定，输出逐项like/coin/fav，不把某一项false宣传成全成功。 |
| 14 | `bilibili_send_comment` | 视频：`CommentAPI.add(client,aid,message,1,root,parent)`；动态：先 `DynamicAPI.getDetail(client,id)` 取 `basic.comment_id_str/comment_type`，再 `CommentAPI.add(client,oid,message,type,root,parent)` | 需登录；confirm=true | bvid/aid 与 dynamicId 二选一且不可混用。动态评论区身份来自详情解析（相册/转发/文字动态的 oid 不等于动态 ID），解析失败/缺 comment_id_str 不发表；预览保持零请求并展示目标。空正文/不安全ID拒绝；parent必须有root，只有root时parent默认root。need_captcha拒绝成功声明；优先返回rpid_str，成功输出含解析后的 oid/replyType。 |
| 15 | `bilibili_user_relation` | `UserAPI.modifyRelation(client,mid,act)`：follow=1、unfollow=2、block=5 | 需登录；立即写入，须授权 | 未知动作拒绝；检查code，不自动扩展其他关系操作。 |
| 16 | `bilibili_get_dynamic_detail` | `DynamicAPI.getDetail(client,id)` | 公开读取 | ID接受数字或严格匹配的https B站动态/opus链接；不从任意文本提取数字。统一解析object/array modules；保留commentOid/commentType，不假定commentType总为11。 |
| 17 | `bilibili_get_user_dynamics` | `DynamicAPI.getSpace(client,mid,offset)` | 公开读取 | 游标原样传递；同样兼容object/array modules、pub_time/pub_time_text/pub_ts，返回hasMore/nextOffset。 |
| 18 | `bilibili_get_comment_detail` | `CommentAPI.getReply(client,oid,replyType,rpid)`（jump定位） | 公开读取 | oid支持字符串及安全整数；校验响应rpid、oid、type精确一致，缺主体信息不冒充定位成功；优先rpid_str/root_str/parent_str。未找到不宣称已删除；缺根/父/统计为null。保留当前评论pictures。 |
| 19 | `bilibili_get_sub_comments` | `CommentAPI.getReplyDialog(client,oid,rootRpid,replyType,page,pageSize)` | 公开读取 | page默认1；pageSize默认20/最大49；只返回本页子评论，不把root响应对象混入子列表；数值输入限安全整数。 |
| 20 | `bilibili_get_article_info` | 并行 `ArticleAPI.getInfo(client,id)` / `ArticleAPI.getView(client,id)` | 公开读取 | stats优先info.stats、其次view.stats；不能用info.coin/like（账号互动状态）冒充总体计数。正文去HTML、保留文本，contentAvailable区分不可用；至少一个API成功才返回部分结果。 |
| 21 | `bilibili_get_live_info` | `LiveAPI.getRoomInfo(client,roomId)` + 可选 `UserAPI.getInfo(client,uid)` | 公开读取 | 保留liveStatus：0未播/1直播/2轮播；online是上游人气值，不保证等于真实在线人数。主播资料失败警告。 |
| 22 | `bilibili_get_danmaku` | 未提供cid时 `VideoAPI.getInfo`；`DanmakuAPI.getXmlDanmaku(client,cid)` | 公开读取 | limit默认50/最大200；1.1.3已使用rawRequest，无旧版二次请求回退。拒绝非XML错误页，解码实体，按时间排序取前limit；只是当前池，不是全量历史/字幕。 |
| 23 | `bilibili_get_video_recommend` | `VideoAPI.getRecommend(client,aid,bvid)` | 公开读取 | 本地BV/AV校验转换；单次相关推荐，不保证与视频内容等价。 |
| 24 | `bilibili_dynamic_interact` | `DynamicAPI.like(client,id,up)`：like=1、unlike=2 | 需登录；confirm=true | 未知action拒绝，不再默认点赞；数字字符串ID保精度；确认预览零请求，执行检查code。 |

## 没有专用工具的 SDK 范围

“无专用工具”不等于插件其他模块绝未使用；例如登录由客户端服务/UI承接，回复/@通知由轮询器承接。下表限定 **24 个工具层**，不声称覆盖 SDK 全部实体方法。

| SDK业务域 | 工具未暴露的范围 |
| --- | --- |
| 登录/配置/客户端 | `BiliClient.create/fromProfiles/isLoggedIn/ensureLogin/loginByQrcode/loginByTvQrcode/loginByPassword/logout`、SMS登录导出函数、凭据刷新、ConfigManager/profile管理。不得给Agent暴露凭据或任意登录写操作。 |
| VideoAPI | 独立getInfoByAid/getStat、在线人数getOnlineCount、快照getSnapshot、高能进度getPbp、当前账号hasLiked/hasCoined/hasFavorited、独立favorite/share；现有video_info统计不能冒充这些状态。 |
| CommentAPI | WBI评论getRepliesWbi及generator、专用getHotReplies/hotReplies、replyCount、resolveReply、like/hate/delete/top/report；工具不自动猜测未知归属，也不新增评论管理/删除权限。 |
| DynamicAPI | space generator、create（含图文/@）、createVote、delete、setTop/removeTop；动态创作/删除不因SDK支持而自动开放。 |
| UserAPI | getNavNum、getMedalWall、getFans/fans、nameToUid、getLoginNotice/getLoginLog、getNavInfo/getMemberAccount、getRewardStatus/getTodayCoinExp、addContract/addContractMessage；modifyRelation其他act也未暴露。 |
| MessageAPI | getReplyFeed/getAtFeed及generator（轮询模块另用）、singleUnread/groupUnread、getSessions/sessions/getNewSessions/newSessions/sessionDetail、markRead/removeSession/setTop/setDnd/setPush/setIntercept、getSettings/updateSettings。没有私信工具；不把通知API等同完整私信收发API。 |
| ArticleAPI | like/coin/favorite、getCollection、getCards。 |
| HistoryAPI | history generator、clearHistory、clearToView。 |
| FavoriteAPI | getFolderInfo、folderList generator、createFolder/editFolder/deleteFolder、copyResources/moveResources/deleteResources/cleanInvalidResources。 |
| DanmakuAPI | getHistoryDates、updateConfig、postDanmaku。 |
| RankingAPI / SearchAPI | popular generator、榜单rid/type配置；getDefaultSearch/getSuggest。SDK1.1.3本身没有独立searchType方法，不能在映射中虚构。 |
| LiveAPI | createRoom/updateRoom、banUser/getMutedList/unbanUser。 |
| OpusAPI | getDetail/getSpace；动态工具读取DynamicAPI内的opus摘要，不等于完整Opus工具。 |
| UploadAPI | image/uploadFromBase64/uploadFromUrl/uploadBuffer；没有本地或远端上传工具。 |
| EmojiAPI | getPanel/addPackage/removePackage。 |
| NoteAPI | isForbid/getInfo/getArchiveNotes/getUserNotes/userNotes/save/delete。 |
| ElectricAPI | getMonthlyChargeList/getVideoChargeShow/sendChargeMessage/getChargeRemarks/chargeRemarks/getChargeRemarkDetail。 |
| CommonAPI及工具函数 | getCurrentTimestamp/getServerTimestamp、av2bv、formatImageUrl/getImageAvgColor/getIpLocation、签名辅助；bv2av只用于本地ID转换，不单独注册工具。 |
| 实体包装层 | SDK User/Video/Dynamic/Comment/CommentArea等提供便捷接口，但工具直接调用静态API以显式检查响应；不把每个实体getter计算成独立API覆盖项。 |

## 离线验证

工具相关文件：`test/tools.test.ts`、`test/comments-tool.test.ts`、`test/sdk-tools-contract.test.ts`。

- 原有工具用例保留；测试对SDK `request/rawRequest`设置拒绝默认实现，global fetch禁止，防止遗漏mock发出真实请求。
- 契约测试运行**真实SDK静态方法实现**，仅传输层mock，验证URL、WBI选项、分页参数位置和POST body；覆盖24名及所有分支的成功/非零code/缺响应，以及读取缺data。
- 覆盖确认预览零请求、拒绝非法action/ID/页码/硬币数/confirm、登录拦截、部分失败warnings、精确大ID/主体业务匹配、评论关系未知、三连部分状态、XML错误正文与不隐式重试、部分注册回滚。
- 只测试模拟服务契约，不证明 B站真实端到端或宿主已重载；没有调用插件apply，没有点赞/投币/评论真实账号，没有加载生产profile。

正常命令：

```powershell
pnpm exec vitest run test/tools.test.ts test/comments-tool.test.ts test/sdk-tools-contract.test.ts
pnpm run typecheck
pnpm run build
```

本次环境 pnpm 自动依赖核查被 `minimumReleaseAge` 阻止（1.1.3新发布）；不禁用供应链策略或偷偷安装。可明确使用已安装依赖完成离线验证，最终结果以交付报告为准：

```powershell
node node_modules/vitest/vitest.mjs run test/tools.test.ts test/comments-tool.test.ts test/sdk-tools-contract.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/tsdown/dist/run.mjs
```

后端工具变更需要完整重启现有DSH宿主；仅刷新页面不重载工具实现。不要为验证重构强制关闭承载当前任务的Desktop。
