import { DanmakuAPI, VideoAPI } from '@seiuna/bilibili-api';
import { aidOf, arrayOf, bvidOf, checkCode, clock, confirmed, dataOf, dateTime, decodeEntities, oneOf, optionalData, positiveInt, tool, type RegisterTool, type ToolManager } from './shared.js';

export function parseDanmakuXml(xml: string, limit: number) {
  // A risk-control HTML page / JSON error is not a valid empty danmaku list.
  if (typeof xml !== 'string' || !/^\s*(?:<\?xml[^>]*>\s*)?<i(?:\s[^>]*)?>[\s\S]*<\/i>\s*$/.test(xml)) {
    throw new Error('弹幕响应不是有效的 XML 弹幕文档');
  }
  const items: Array<{ time: number; timeFormatted: string; text: string }> = [];
  const regex = /<d\b[^>]*\bp=(['"])(.*?)\1[^>]*>([\s\S]*?)<\/d>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const time = Number.parseFloat(match[2].split(',')[0]);
    if (!Number.isFinite(time) || time < 0) continue;
    const content = decodeEntities(match[3]);
    if (content) items.push({ time, timeFormatted: clock(time).padStart(5, '0'), text: content });
  }
  return items.sort((a, b) => a.time - b.time).slice(0, limit);
}

export function registerVideoTools(register: RegisterTool, manager: ToolManager): void {
  register(tool({
    name: 'bilibili_get_video_info',
    description: '获取视频详情、UP主、简介、播放/点赞/投币/收藏统计、分P与标签；统计不代表当前账号互动状态。',
    parameters: { bvid: { type: 'string', description: '视频 BV 号' }, aid: { type: 'integer', description: '视频 AV 号' } },
    async execute(args: { bvid?: string; aid?: number }) {
      aidOf(args);
      const client = manager.getClient();
      const data = dataOf(await VideoAPI.getInfo(client,args.bvid === undefined ? undefined : bvidOf(args.bvid), args.aid), '视频详情');
      const warnings: string[] = [];
      const tagsData = await optionalData(VideoAPI.getTags(client,data.aid, data.bvid, data.cid), '视频标签', warnings);
      return { bvid: data.bvid, aid: data.aid, title: data.title, pic: data.pic, pubdate: dateTime(data.pubdate),
        duration: data.duration, owner: data.owner, stat: data.stat, desc: data.desc,
        pages: arrayOf(data.pages, '视频分P').map(p => ({ page: p.page, cid: p.cid, part: p.part, duration: p.duration })),
        tags: tagsData?.map(t => t.tag_name) ?? null, warnings };
    },
  }));
  register(tool({
    name: 'bilibili_get_video_ai_summary', description: '获取 Bilibili 官方视频 AI 摘要、大纲和关键时间点；未生成摘要与请求失败区分。',
    parameters: { bvid: { type: 'string', required: true, description: '视频 BV 号' }, cid: { type: 'integer', description: '可选分P CID，默认第一P' } },
    async execute(args: { bvid: string; cid?: number }) {
      const bvid = bvidOf(args.bvid);
      if (args.cid !== undefined) positiveInt(args.cid, 'cid');
      const client = manager.getClient();
      const info = dataOf(await VideoAPI.getInfo(client,bvid), '视频详情');
      const cid = positiveInt(args.cid ?? info.cid, 'cid');
      const data = dataOf(await VideoAPI.getAiSummary(client,cid, info.aid, bvid, info.owner?.mid), 'AI摘要');
      if (data.code !== undefined && data.code !== 0) throw new Error(`AI摘要失败 (code=${data.code})`);
      const model = data.model_result;
      return { bvid, cid, title: info.title, available: Boolean(model?.summary), summary: model?.summary || '无官方 AI 摘要',
        outline: (model?.outline ?? []).map(o => ({ title: o.title, timeStr: clock(o.timestamp),
          partOutline: (o.part_outline ?? []).map(p => ({ content: p.content, timeStr: clock(p.timestamp) })) })) };
    },
  }));
  register(tool({
    name: 'bilibili_get_video_play_url', description: '获取 MP4/DASH 视频流及清晰度；URL 有时效，DASH 音视频分离，受登录与会员权限限制。',
    parameters: { bvid: { type: 'string', required: true, description: '视频 BV 号' }, cid: { type: 'integer', description: '可选分P CID，默认第一P' }, qn: { type: 'integer', description: '画质代码，例如 80=1080P、64=720P；默认80' } },
    async execute(args: { bvid: string; cid?: number; qn?: number }) {
      const bvid = bvidOf(args.bvid);
      if (args.cid !== undefined) positiveInt(args.cid, 'cid');
      const qn = positiveInt(args.qn ?? 80, 'qn');
      const client = manager.getClient();
      const cid = positiveInt(args.cid ?? dataOf(await VideoAPI.getInfo(client,bvid), '视频详情').cid, 'cid');
      const data = dataOf(await VideoAPI.getPlayUrl(client,cid, { bvid, qn, fnval: 16 }), '播放流');
      const videos = data.dash?.video ?? [];
      const selected = videos.find(stream => stream.id === data.quality) ?? videos[0];
      const videoUrl = selected?.baseUrl || data.durl?.[0]?.url;
      if (!videoUrl) throw new Error('播放流响应缺失媒体地址');
      return { bvid, cid, quality: data.quality, timelength: data.timelength, videoUrl,
        audioUrl: data.dash?.audio?.[0]?.baseUrl, supportFormats: data.support_formats ?? [],
        // Keep all MP4 segments and DASH choices; the first URL is not always the entire video.
        durl: data.durl, dash: data.dash };
    },
  }));
  register(tool({
    name: 'bilibili_get_video_recommend', description: '获取指定视频的相关推荐列表。',
    parameters: { bvid: { type: 'string', description: '视频 BV 号' }, aid: { type: 'integer', description: '视频 AV 号' } },
    async execute(args: { bvid?: string; aid?: number }) {
      const aid = aidOf(args);
      const list = arrayOf(dataOf(await VideoAPI.getRecommend(manager.getClient(),aid, args.bvid === undefined ? undefined : bvidOf(args.bvid)), '推荐视频'), '推荐视频')
        .map(item => ({ aid: item.aid, bvid: item.bvid, title: item.title, pic: item.pic, author: item.owner?.name, mid: item.owner?.mid, play: item.stat?.view, duration: item.duration }));
      return { bvid: args.bvid, aid, list };
    },
  }));
  register(tool({
    name: 'bilibili_get_danmaku', description: '读取视频分P XML弹幕池，按时间升序截取最多 limit 条；不是全量历史弹幕或视频字幕。',
    parameters: { bvid: { type: 'string', description: '视频 BV号，未提供cid时查询第一P' }, cid: { type: 'integer', description: '视频分P CID' }, limit: { type: 'integer', description: '返回条数，默认50，最大200' } },
    async execute(args: { bvid?: string; cid?: number; limit?: number }) {
      const bvid = args.bvid === undefined ? undefined : bvidOf(args.bvid);
      if (args.cid !== undefined) positiveInt(args.cid, 'cid');
      const limit = positiveInt(args.limit ?? 50, 'limit', 200);
      if (!args.cid && !args.bvid) throw new Error('必须提供 cid 或有效的 bvid 以查询弹幕');
      const client = manager.getClient();
      const cid = positiveInt(args.cid ?? dataOf(await VideoAPI.getInfo(client,bvid), '视频详情').cid, 'cid');
      // 1.1.3 already uses rawRequest; never retry a failed SDK request invisibly.
      const danmaku = parseDanmakuXml(await DanmakuAPI.getXmlDanmaku(client,cid), limit);
      return { cid, bvid: args.bvid, total: danmaku.length, danmaku };
    },
  }));
  register(tool({
    name: 'bilibili_video_interact', description: '【需登录】点赞、投币或三连；全部操作必须先核对用户意图，再传 confirm=true。投币同时点赞，三连会消耗硬币。',
    parameters: { bvid: { type: 'string', required: true, description: '目标视频 BV号' }, action: { type: 'string', required: true, description: 'like / coin / triple' }, multiply: { type: 'integer', description: '仅coin生效：1或2，默认1；triple由B站决定' }, confirm: { type: 'boolean', description: '默认false，只预览，不请求；获准后设true' } },
    async execute(args: { bvid: string; action: string; multiply?: number; confirm?: boolean }) {
      const client = manager.requireAuthedClient();
      const aid = aidOf(args);
      const action = oneOf(args.action, ['like', 'coin', 'triple'], 'action');
      const multiply = positiveInt(args.multiply ?? 1, 'multiply', 2);
      if (args.multiply !== undefined && action !== 'coin') throw new Error('multiply 仅适用于 coin');
      const name = action === 'like' ? '点赞' : action === 'coin' ? `投 ${multiply} 枚硬币并点赞` : '一键三连 (点赞+投币+收藏，硬币数由B站决定)';
      if (!confirmed(args.confirm)) return { confirmed: false, message: `[安全拦截提示] 即将对视频 ${args.bvid} 执行【${name}】。\n请向用户确认无误后传入 confirm=true 执行。` };
      if (action === 'like') {
        checkCode(await VideoAPI.like(client,aid, 1), '视频点赞');
        return { confirmed: true, message: `已成功为视频 ${args.bvid} 点赞！` };
      }
      if (action === 'coin') {
        checkCode(await VideoAPI.coin(client,aid, multiply, 1), '视频投币');
        return { confirmed: true, message: `已成功为视频 ${args.bvid} 投掷 ${multiply} 枚硬币并点赞！` };
      }
      const result = dataOf(await VideoAPI.triple(client,aid), '视频三连');
      return { confirmed: true, result, message: `视频 ${args.bvid} 三连请求已处理 (点赞: ${result.like}, 投币: ${result.coin}, 收藏: ${result.fav})；以各项返回状态为准。` };
    },
  }));
}
