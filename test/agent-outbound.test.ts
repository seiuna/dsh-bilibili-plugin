import { afterEach, expect, it, vi } from 'vitest';
import { BilibiliAgentBridge } from '../src/agent-bridge.js';

const bridges: BilibiliAgentBridge[] = [];
afterEach(() => { bridges.forEach(b => b.dispose()); bridges.length = 0; vi.restoreAllMocks(); });
function harness() {
  let listener: any;
  const stream = vi.fn(() => { throw new Error('must not call fallback'); });
  const bridge = new BilibiliAgentBridge({
    on: (_: string, fn: any) => { listener = fn; return () => {}; },
    get: (name: string) => name === 'llm' ? { stream } : undefined,
  } as any);
  bridges.push(bridge);
  const followup = vi.fn();
  const record: any = { sessionId: 'test', sessionKey: 'content', agent: { followup }, lastActivity: 0 };
  vi.spyOn(bridge, 'getOrCreate').mockResolvedValue(record);
  vi.spyOn(bridge, 'findBySessionId').mockReturnValue(record);
  const emit = (type: string, data: any) => listener({ header: { id: 'test' } }, { type, data });
  const say = (text: string) => emit('assistant/message', { message: { content: [{ type: 'text', text }] } });
  const end = (reason: any = { kind: 'completed' }) => emit('turn/end', { reason });
  const start = async (reply = vi.fn(async () => {})) => {
    const done: Promise<void> = (bridge as any).processInbound({ sourceType: 'video', subjectId: '1', businessId: 1, sourceId: '2', userName: 'user', userId: '3', message: 'hello', reply });
    // Attach rejection handling immediately; tests await the original promise later.
    void done.catch(() => {});
    await Promise.resolve();
    return { reply, done };
  };
  return { bridge, stream, followup, say, end, start };
}
it('sends only the last message after successful completion, ignoring duplicate and late events', async () => {
  const h = harness(); const run = await h.start();
  h.say('progress'); h.say('final');
  expect(run.reply).not.toHaveBeenCalled();
  h.end(); h.end(); h.say('late');
  await run.done;
  expect(run.reply).toHaveBeenCalledExactlyOnceWith('final');
  expect(h.stream).not.toHaveBeenCalled();
});
it.each([{ kind: 'error' }, { kind: 'cancelled' }, { kind: 'interrupted' }, {}, null, { kind: 'completed', failure: { message: 'failed' } }])(
  'discards buffered output on unsuccessful or unknown end: %j', async reason => {
    const h = harness(); const run = await h.start(); h.say('must not send'); h.end(reason);
    await expect(run.done).rejects.toThrow('未成功结束');
    expect(run.reply).not.toHaveBeenCalled(); expect(h.stream).not.toHaveBeenCalled();
  },
);
it('does not send earlier progress if the last assistant message has no text', async () => {
  const h = harness(); const run = await h.start(); h.say('progress'); h.say(''); h.end();
  await run.done; expect(run.reply).not.toHaveBeenCalled();
});
it('keeps reply completion pending and isolates consecutive comment targets', async () => {
  const h = harness(); let release!: () => void;
  const firstReply = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const first = await h.start(firstReply); h.say('first final'); h.end();
  let finished = false; void first.done.then(() => { finished = true; });
  await vi.waitFor(() => expect(firstReply).toHaveBeenCalled());
  expect(finished).toBe(false); release(); await first.done;
  const second = await h.start(); h.say('second final'); h.end(); await second.done;
  expect(firstReply).toHaveBeenCalledExactlyOnceWith('first final');
  expect(second.reply).toHaveBeenCalledExactlyOnceWith('second final');
});
it('does not fallback after asynchronous admission failure or reply failure', async () => {
  const h = harness(); h.followup.mockRejectedValueOnce(new Error('admission failed'));
  const first = await h.start(); await expect(first.done).rejects.toThrow('admission failed');
  const second = await h.start(vi.fn(async () => { throw new Error('reply failed'); }));
  h.say('final'); h.end(); await expect(second.done).rejects.toThrow('reply failed');
  expect(first.reply).not.toHaveBeenCalled(); expect(second.reply).toHaveBeenCalledTimes(1);
  expect(h.stream).not.toHaveBeenCalled();
});
it('late admission rejection cannot delete the next active turn', async () => {
  const h = harness(); let rejectAdmission!: (reason: Error) => void;
  h.followup.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectAdmission = reject; }));
  const first = await h.start(); h.say('first'); h.end(); await first.done;
  const second = await h.start();
  rejectAdmission(new Error('late first admission failure'));
  await Promise.resolve(); await Promise.resolve();
  h.say('second'); h.end(); await second.done;
  expect(first.reply).toHaveBeenCalledExactlyOnceWith('first');
  expect(second.reply).toHaveBeenCalledExactlyOnceWith('second');
});
it('failed admission does not suppress first-source header on retry', async () => {
  const h = harness(); h.followup.mockRejectedValueOnce(new Error('admission failed'));
  const first = await h.start(); await expect(first.done).rejects.toThrow('admission failed');
  const second = await h.start();
  expect(JSON.stringify(h.followup.mock.calls[1][0])).toContain('[消息来源类型]:');
  h.end(); await second.done;
});
it('disposal during asynchronous binding prevents late model admission', async () => {
  const h = harness(); let release!: (value: any) => void;
  vi.mocked(h.bridge.getOrCreate).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const run = await h.start(); h.bridge.dispose();
  release({ sessionId: 'test', sessionKey: 'content', agent: { followup: h.followup } });
  await expect(run.done).rejects.toThrow('disposed');
  expect(h.followup).not.toHaveBeenCalled(); expect(run.reply).not.toHaveBeenCalled();
});
it('discards buffered output on disposal', async () => {
  const h = harness(); const run = await h.start(); h.say('progress'); h.bridge.dispose(); h.end();
  await expect(run.done).rejects.toThrow('disposed'); expect(run.reply).not.toHaveBeenCalled();
});
