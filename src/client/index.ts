import { BilibiliHeaderPill } from './BilibiliHeaderPill.js';
import { BilibiliAuthOverlay } from './BilibiliAuthOverlay.js';
import { installStyles } from './styles.js';

export const NS = 'bilibili';
export const inject = ['slots', 'locale'];

export function apply(ctx: any): void {
  // 1. 安装组件样式
  ctx.effect(() => installStyles(), 'bilibili: styles');

  // 2. 注入顶部会话栏操作区胶囊 (Header Pill)
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register(
      {
        name: 'conversation.session.header.actions',
        id: 'bilibili-status-pill',
        order: 12,
        locale: NS,
      },
      BilibiliHeaderPill,
    ),
  );

  // 3. 注入全局抽屉/浮层 (Overlay Modal)
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'bilibili-auth-overlay',
        order: 12,
        locale: NS,
      },
      BilibiliAuthOverlay,
    ),
  );
}
