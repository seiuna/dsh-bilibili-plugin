import { describe, it, expect, vi } from 'vitest';
import {
  Command,
  CommandRegistry,
  CommandContext,
  CMDdispatcher,
  checkScope,
  parseScopeRules,
  Validators,
  chain,
  createCommandDispatcherMiddleware,
} from '../src/command/index.js';

describe('Command Builder & Options', () => {
  it('stores required permissions or tags', () => {
    const cmd = new Command('admin').require('admin.user');
    expect(cmd.requiredPermissions).toEqual(['admin.user']);

    cmd.require('admin.setting', 'admin.role');
    expect(cmd.requiredPermissions).toEqual([
      'admin.user',
      'admin.setting',
      'admin.role',
    ]);
  });

  it('stores adapter scope rules', () => {
    const cmd = new Command('multi').scope('qq').scope('all', '!telegram');
    expect(cmd.scopeRules).toEqual(['qq', 'all', '!telegram']);
  });

  it('builds command tree with literal subcommands and aliases', () => {
    const root = new Command('user');
    const info = root.literal('info', ['i', 'profile']);
    info.desc('查看用户信息');

    expect(root.children.get('info')).toBe(info);
    expect(root.children.get('i')).toBe(info);
    expect(root.children.get('profile')).toBe(info);
  });

  it('generates accurate help tree', () => {
    const root = new Command('bili');
    root.desc('B站相关工具');

    const search = root.literal('search', ['s']).desc('搜索视频');
    search.action(async () => {});

    const user = root.literal('user');
    const userUid = user.argument(Command.argument('uid')).desc('查看UP主');
    userUid.action(async () => {});

    const help = root.getHelp();
    expect(help).toContain('/bili search - 搜索视频');
    expect(help).toContain('/bili user <uid> - 查看UP主');
  });
});

describe('Scope Matching (parseScopeRules & checkScope)', () => {
  it('parses positive, negative and wildcard rules', () => {
    expect(parseScopeRules(['qq'])).toEqual({
      positive: ['qq'],
      negative: [],
    });
    expect(parseScopeRules(['all', '!qq'])).toEqual({
      positive: ['all'],
      negative: ['qq'],
    });
    expect(parseScopeRules(['*'])).toEqual({
      positive: ['all'],
      negative: [],
    });
  });

  it('evaluates checkScope accurately', () => {
    expect(checkScope(['qq'], 'qq')).toBe(true);
    expect(checkScope(['qq'], 'telegram')).toBe(false);

    expect(checkScope(['all', '!qq'], 'telegram')).toBe(true);
    expect(checkScope(['all', '!qq'], 'qq')).toBe(false);

    expect(checkScope(['!qq'], 'web')).toBe(true);
    expect(checkScope(['!qq'], 'qq')).toBe(false);

    expect(checkScope([], 'qq')).toBe(true);
  });
});

describe('Validators & ChainValidator', () => {
  it('validates numeric values', () => {
    expect(Validators.numeric('12345')).toBe(true);
    expect(typeof Validators.numeric('12a45')).toBe('string');
  });

  it('validates email, url and uuid', () => {
    expect(Validators.email('test@example.com')).toBe(true);
    expect(typeof Validators.email('invalid-email')).toBe('string');

    expect(Validators.url('https://bilibili.com')).toBe(true);
    expect(typeof Validators.url('not-a-url')).toBe('string');

    expect(Validators.uuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(typeof Validators.uuid('12345')).toBe('string');
  });

  it('validates numberRange and bounds', () => {
    expect(Validators.numberRange(1, 10)('5')).toBe(true);
    expect(typeof Validators.numberRange(1, 10)('0')).toBe('string');
    expect(typeof Validators.numberRange(1, 10)('15')).toBe('string');
  });

  it.each(['5oops', '', ' ', 'Infinity', 'NaN'])('rejects partial or non-finite numeric input: %j', value => {
    expect(Validators.numberRange(1, 10)(value)).not.toBe(true);
    expect(Validators.minimum(1)(value)).not.toBe(true);
    expect(Validators.maximum(10)(value)).not.toBe(true);
    expect(Validators.timestamp()(value)).not.toBe(true);
  });

  it('validates reusable regex and real ISO calendar dates', () => {
    const validator = Validators.pattern(/^abc$/g);
    expect(validator('abc')).toBe(true);
    expect(validator('abc')).toBe(true);
    expect(validator('bad')).not.toBe(true);
    expect(Validators.isoDate()('2024-02-29')).toBe(true);
    expect(Validators.isoDate()('2024-02-29T12:30:00+08:00')).toBe(true);
    for (const value of ['2023-02-29', '2024-02-31', '2024-13-01', '2024-01-01junk', '']) {
      expect(Validators.isoDate()(value)).not.toBe(true);
    }
    expect(Validators.timestamp()('12.5')).not.toBe(true);
    expect(Validators.timestamp()('123x')).not.toBe(true);
  });

  it('validates choice and length', () => {
    const choiceVal = Validators.choice(['apple', 'banana']);
    expect(choiceVal('apple')).toBe(true);
    expect(typeof choiceVal('pear')).toBe('string');

    const lenVal = Validators.lengthRange(3, 6);
    expect(lenVal('abcd')).toBe(true);
    expect(typeof lenVal('ab')).toBe('string');
    expect(typeof lenVal('abcdefgh')).toBe('string');
  });

  it('combines with chain() validator', () => {
    const cv = chain().required().numeric().length(2, 5).build();

    expect(cv('1234')).toBe(true);
    expect(typeof cv('')).toBe('string');
    expect(typeof cv('1')).toBe('string');
    expect(typeof cv('123456')).toBe('string');
    expect(typeof cv('abcde')).toBe('string');
  });
});

describe('CommandRegistry & Dispatcher Execution', () => {
  it('registers and retrieves root commands and aliases', () => {
    const registry = new CommandRegistry();
    const cmd = registry.register('bili', ['bilibili', 'b']);
    expect(registry.get('bili')).toBe(cmd);
    expect(registry.get('bilibili')).toBe(cmd);
    expect(registry.get('B')).toBe(cmd);
    expect(registry.getRootCommands().size).toBe(1);
  });

  it('executes literal command chain with action result', async () => {
    const registry = new CommandRegistry();
    registry
      .register('ping')
      .desc('Ping-Pong')
      .action(async () => 'pong!');

    const res = await registry.execute('ping');
    expect(res).toBe('pong!');

    // with leading slash
    const resSlash = await registry.execute('/ping');
    expect(resSlash).toBe('pong!');
  });

  it('extracts arguments and default values', async () => {
    const registry = new CommandRegistry();
    const user = registry.register('user');
    user
      .literal('view')
      .argument(Command.argument('uid').default('1000'))
      .action(async (_ctx, args) => {
        return Command.ok(`UID is ${args.uid}`);
      });

    // with explicit arg
    const res1 = (await registry.execute('user view 390794259')) as any;
    expect(res1.ok).toBe(true);
    expect(res1.message).toBe('UID is 390794259');

    // with default arg
    const res2 = (await registry.execute('user view')) as any;
    expect(res2.ok).toBe(true);
    expect(res2.message).toBe('UID is 1000');
  });

  it('validates argument using argument.validate()', async () => {
    const registry = new CommandRegistry();
    registry
      .register('card')
      .argument(Command.argument('id').validate(Validators.numeric))
      .action(async (_ctx, args) => `card:${args.id}`);

    const okRes = await registry.execute('card 12345');
    expect(okRes).toBe('card:12345');

    const failRes = (await registry.execute('card abc')) as any;
    expect(failRes.ok).toBe(false);
    expect(failRes.type).toBe('invalid_args');
    expect(failRes.message).toContain('必须是有效的纯数字格式');
  });

  it('supports node redirection (redirect)', async () => {
    const registry = new CommandRegistry();
    const target = new Command('target').action(async () => 'redirected!');
    registry.register('alias').redirect(target);

    const res = await registry.execute('alias');
    expect(res).toBe('redirected!');
  });

  it('enforces scopeRules in execution', async () => {
    const registry = new CommandRegistry();
    registry
      .register('desktop-only')
      .scope('desktop')
      .action(async () => 'ok');

    const deniedRes = (await registry.execute('desktop-only', {
      adapter: 'qq',
    })) as any;
    expect(deniedRes.ok).toBe(false);
    expect(deniedRes.type).toBe('scope_denied');

    const allowedRes = await registry.execute('desktop-only', {
      adapter: 'desktop',
    });
    expect(allowedRes).toBe('ok');
  });

  it('supports optional permission checker hook', async () => {
    const registry = new CommandRegistry();
    registry
      .register('delete')
      .require('admin')
      .action(async () => 'deleted');

    // Without permissionChecker -> allowed by default (no permissions system configured)
    expect(await registry.execute('delete')).toBe('deleted');

    // With permissionChecker configured
    registry.setPermissionChecker((userId, perms) => {
      return perms.includes('admin') && userId === 'admin-user';
    });

    const denied = (await registry.execute('delete', { userId: 'guest' })) as any;
    expect(denied.ok).toBe(false);
    expect(denied.type).toBe('permission_denied');

    const allowed = await registry.execute('delete', { userId: 'admin-user' });
    expect(allowed).toBe('deleted');
  });

  it('returns usage hints on incomplete commands or unknown commands', async () => {
    const registry = new CommandRegistry();
    const root = registry.register('settings');
    root.literal('set').desc('设置项');

    const unknownRes = (await registry.execute('notfound')) as any;
    expect(unknownRes.ok).toBe(false);
    expect(unknownRes.type).toBe('not_found');

    const incompleteRes = (await registry.execute('settings')) as any;
    expect(incompleteRes.ok).toBe(false);
    expect(incompleteRes.type).toBe('no_action');
    expect(incompleteRes.message).toContain('可用子命令:');
    expect(incompleteRes.message).toContain('/settings set');
  });
});

describe('Middleware & Legacy CMDdispatcher', () => {
  it('CommandDispatcherMiddleware routes commands to action', async () => {
    const registry = new CommandRegistry();
    registry.register('echo').action(async (_ctx, args) => 'echo back');

    const mw = createCommandDispatcherMiddleware(registry);
    const messages: string[] = [];
    const next = vi.fn();

    const mockCtx = {
      sessionType: 'command',
      event: { command: 'echo', args: [] },
      message: (msg: any) => messages.push(msg),
    };

    await mw(mockCtx, next);
    expect(messages).toEqual(['echo back']);
    expect(next).not.toHaveBeenCalled();
  });

  it('CommandDispatcherMiddleware passes non-command sessions to next()', async () => {
    const mw = createCommandDispatcherMiddleware();
    const next = vi.fn();

    await mw({ sessionType: 'chat' } as any, next);
    expect(next).toHaveBeenCalled();
  });

  it('CMDdispatcher handles /help and command strings', async () => {
    const messages: string[] = [];
    const mockCtx = {
      event: { command: 'help', args: [] },
      message: (m: any) => messages.push(m),
    };

    await CMDdispatcher(mockCtx);
    expect(messages.length).toBe(1);
    expect(messages[0]).toContain('可用命令列表:');
  });
});
