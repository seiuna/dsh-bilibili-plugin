import { beforeEach, afterEach, expect, it, vi } from 'vitest';

import { CommentAPI, DynamicAPI, VideoAPI } from '@seiuna/bilibili-api';
import { PollerService } from '../src/poller-service.js';
import { BilibiliAgentBridge } from '../src/agent-bridge.js';

let testTempDir: string;
beforeEach(async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  testTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bili-preview-test-'));
  vi.stubEnv('BILIBILI_POLLER_CONFIG_PATH', path.join(testTempDir, 'config.json'));
  vi.stubEnv('BILIBILI_PROMPT_PATH', path.join(testTempDir, 'prompt.md'));
});

// Offline notification -> context enrichment -> actual bridge message assembly.
// Stop at followup: no real Agent, model, Bilibili write, or credentials.
afterEach(async () => {
  await PollerService.getInstance().flushRecentMessages();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  (PollerService as any).instance = null;
  if (testTempDir) {
    const fs = await import('node:fs/promises');
    await fs.rm(testTempDir, { recursive: true, force: true }).catch(() => {});
  }
});

it.each([{ kind: '视频', businessId: 1 }, { kind: '动态', businessId: 11 }])(
  '$kind：打印投递给 DSH 前的真实用户 prompt', async ({ kind, businessId }) => {
    (PollerService as any).instance = null;
    const entries: Record<string, any> = {};
    const request = vi.fn(() => { throw new Error('意外的底层请求'); });
    const getReply = vi.spyOn(CommentAPI, 'getReply').mockImplementation(async (_client, _oid, _type, id) => ({ code: 0, data: entries[String(id)] }));
    vi.spyOn(VideoAPI, 'getInfoByAid').mockResolvedValue({ code: 0, data: { aid: 20, title: '周末的猫咪观察日记', bvid: 'BV17x411w7KC' } } as any);
    vi.spyOn(DynamicAPI, 'getDetail').mockResolvedValue({ code: 0, data: { item: { id_str: '200', basic: { comment_id_str: '20', comment_type: 11 }, modules: { module_dynamic: { desc: { text: '今天拍到了窗边晒太阳的小猫，分享一下。' } } } } } } as any);
    const poller = PollerService.getInstance({ getClient: () => ({ userId: '99', request }) } as any);
    const input = {
      user: { mid: 7, nickname: '测试用户', avatar: '' },
      item: {
        business_id: businessId, subject_id: 20, root_id: 30, source_id: 32,
        source_content: '你觉得这个怎么样？',
        title: '通知摘要（不应当作真实正文）',
        image: 'https://example.invalid/dynamic-cover.jpg',
        uri: 'https://t.bilibili.com/200',
      },
    };
    Object.assign(entries, {
      30: { rpid: '30', oid: '20', type: String(businessId), root: '0', parent: '0', mid: '7', content: { message: '这只猫是不是在等主人回家？' } },
      31: { rpid: '31', oid: '20', type: String(businessId), root: '30', parent: '30', mid: '99', content: { message: '这只猫看起来很惬意！' } },
      32: { rpid: '32', oid: '20', type: String(businessId), root: '30', parent: '31', mid: '7', content: { message: '列表正文不能替换通知原文' } },
    });
    // Fail closed if any unexpected direct network request is introduced.
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试禁止网络请求'); }));
    const bridge = new BilibiliAgentBridge({ on: () => () => {}, get: () => undefined } as any);
    const captured: any[] = [];
    const reply = vi.fn();
    const record: any = {
      sessionId: 'preview', sessionKey: 'preview', reply,
      agent: { followup: (message: any) => {
        captured.push(message);
        // Complete the fake turn without sending any output.
        (bridge as any).active.get('preview').finish();
      } },
    };
    vi.spyOn(bridge, 'getOrCreate').mockResolvedValue(record);
    try {
      const context = poller.buildSessionContext('reply', input);
      context.reply = reply;
      const like = vi.fn();
      context.like = like;
      poller.setDshHandler(async c => {
        // Use the production assembler, skipping only Agent identity/lifecycle setup.
        await (bridge as any).processInbound(c);
      });
      await poller.dispatch(context);
      expect(captured).toHaveLength(1);
      expect(request).not.toHaveBeenCalled();
      expect(getReply).toHaveBeenCalledTimes(3);
      const message = captured[0];
      const prompt = message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      console.log(`\n========== ${kind}：DSH 用户 prompt（截获，未发送） ==========\n${prompt}\n========== END ==========\n`);
      expect(prompt).toContain('这只猫是不是在等主人回家？');
      expect(prompt).toContain('这只猫看起来很惬意！');
      expect(prompt).toContain(input.item.source_content);
      expect(prompt).not.toContain('列表正文不能替换通知原文');
      expect(prompt).toContain(businessId === 1 ? '周末的猫咪观察日记' : '今天拍到了窗边晒太阳的小猫');
      expect(prompt).toContain(`[评论区Id (oid)]: 20 [业务类型]: ${businessId}`);
      expect(prompt).not.toContain(input.item.title);
      expect(JSON.stringify(message)).not.toContain(input.item.image);
      expect(message.role).toBe('user');
      expect(message.id).toBeTruthy();
      expect(reply).not.toHaveBeenCalled();
      expect(like).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      await (bridge as any).processInbound({ ...context, message: '第二条评论' });
      const second = captured[1].content[0].text;
      expect(second).not.toContain('[消息来源类型]:');
      expect(second).not.toContain('[视频标题/动态内容]:');
      expect(second).not.toContain('[评论区Id');
      expect(second).toContain('第二条评论');
      // Simulate restart: in-memory marker gone, persisted user event remains.
      (bridge as any).sourceHeaderSent.clear();
      record.agent.session = { events: [{ type: 'user/message', data: message }] };
      await (bridge as any).processInbound({ ...context, message: '恢复后的评论' });
      expect(captured[2].content[0].text).not.toContain('[消息来源类型]:');
    } finally {
      bridge.dispose();
      vi.unstubAllGlobals();
    }
  },
);