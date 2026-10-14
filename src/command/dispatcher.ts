import { Command, checkScope } from './command.js';
import type { ArgsType, CmdResult, CommandSessionContext } from './types.js';
import { getLogger } from './logger.js';

const logger = getLogger('CommandDispatcher');

// ── Command Context ──

export class CommandContext {
  constructor(private args: ArgsType) {}

  get<K extends keyof ArgsType>(key: K): ArgsType[K] {
    return this.args[key];
  }

  getAll(): ArgsType {
    return { ...this.args };
  }
}

export type PermissionChecker = (
  userId: string | undefined,
  permissions: string[],
  node: Command,
  context: any,
) => Promise<boolean> | boolean;

// ── Command Registry ──

export class CommandRegistry {
  /** Root command routing table (name -> command node) */
  private roots: Map<string, Command> = new Map();
  /** All root commands for help generation */
  private rootCommands: Map<string, Command> = new Map();
  /** Optional custom permission checker */
  private permissionChecker: PermissionChecker | null = null;

  /**
   * Set a custom permission checker for commands that use .require(...)
   */
  setPermissionChecker(checker: PermissionChecker | null): void {
    this.permissionChecker = checker;
  }

  /**
   * Register a root command with optional aliases
   * @param rootName - Primary command name
   * @param aliases - Alternative names for the same command
   * @returns The root Command node
   */
  register(rootName: string, aliases: string[] = []): Command {
    const rootNode = new Command(rootName);
    this.roots.set(rootName.toLowerCase(), rootNode);
    this.rootCommands.set(rootName, rootNode);

    for (const alias of aliases) {
      this.roots.set(alias.toLowerCase(), rootNode);
    }

    logger.info(
      `Registered /${rootName} command${aliases.length > 0 ? ` (aliases: ${aliases.join(', ')})` : ''}`,
    );
    return rootNode;
  }

  /**
   * Get an existing root command or create a new one.
   * Useful when multiple plugins need to add children to the same root.
   */
  getOrCreate(rootName: string, aliases: string[] = []): Command {
    const existing = this.roots.get(rootName.toLowerCase());
    if (existing) {
      // Add any new aliases that weren't registered yet
      for (const alias of aliases) {
        if (!this.roots.has(alias.toLowerCase())) {
          this.roots.set(alias.toLowerCase(), existing);
        }
      }
      return existing;
    }
    return this.register(rootName, aliases);
  }

  /**
   * Get a root command by name (supports aliases)
   */
  get(name: string): Command | undefined {
    return this.roots.get(name.toLowerCase());
  }

  /**
   * Get all registered root commands (primary names only, no aliases).
   */
  getRootCommands(): Map<string, Command> {
    return new Map(this.rootCommands);
  }

  /**
   * Execute a command string
   * @param inputString - The full command string (without leading /)
   * @param context - The session context for execution
   */
  async execute(
    inputString: string,
    context?: any,
  ): Promise<CmdResult | string | void> {
    const trimmed = inputString.trim();
    const cleanInput = trimmed.startsWith('/') ? trimmed.slice(1).trim() : trimmed;
    const parts = cleanInput.split(/\s+/);
    if (parts.length === 0 || parts[0] === '') {
      return Command.fail(
        'invalid_args',
        '请输入有效命令。输入 /help 查看可用命令。',
      );
    }

    const rootName = parts[0].toLowerCase();
    let currentNode = this.roots.get(rootName);

    if (!currentNode) {
      return Command.fail(
        'not_found',
        `未知命令: /${parts[0]}\n输入 /help 查看帮助。`,
      );
    }

    const argsDict: ArgsType = {};
    const path: string[] = [currentNode.name];
    let idx = 1;

    while (idx < parts.length) {
      // Check for redirect at start of iteration
      if (currentNode.redirectTarget) {
        currentNode = currentNode.redirectTarget;
        path.push(currentNode.name);
      }

      const part = parts[idx].toLowerCase();

      // 1. Match literal child (or alias)
      if (currentNode.children.has(part)) {
        currentNode = currentNode.children.get(part)!;
        path.push(currentNode.name);
        idx++;
      }
      // 2. Match dynamic argument
      else if (currentNode.argChild) {
        currentNode = currentNode.argChild;
        const argValue = parts[idx];

        // Validate argument if validator is present
        if (currentNode.validator) {
          const valRes = currentNode.validator(argValue);
          if (valRes !== true) {
            return Command.fail(
              'invalid_args',
              typeof valRes === 'string'
                ? valRes
                : `参数 <${currentNode.name}> 校验失败`,
            );
          }
        }

        argsDict[currentNode.name] = argValue; // 保留原始大小写
        path.push(currentNode.name);
        idx++;
      }
      // 3. No match - show usage hint
      else {
        return this.generateUsageHint(currentNode, parts.slice(0, idx).join(' '));
      }
    }

    // Tail redirect check
    if (currentNode.redirectTarget) {
      currentNode = currentNode.redirectTarget;
      path.push(currentNode.name);
    }

    // Default value fallback for arguments
    if (currentNode.argChild && idx >= parts.length) {
      const nextNode = currentNode.argChild;
      if (nextNode.defaultValue !== undefined) {
        argsDict[nextNode.name] = nextNode.defaultValue;
        currentNode = nextNode;
        path.push(currentNode.name);
      }
    }

    // Permission check if configured
    const userId = context?.event?.userId ?? context?.userId;
    if (currentNode.requiredPermissions.length > 0 && this.permissionChecker) {
      const allowed = await this.permissionChecker(
        userId,
        currentNode.requiredPermissions,
        currentNode,
        context,
      );
      if (!allowed) {
        logger.warn(`Permission denied for ${userId}: missing required permissions`);
        return Command.fail('permission_denied', '你没有权限执行此命令。');
      }
    }

    // Check adapter scope restriction
    const adapter = context?.event?.adapter ?? context?.adapter;
    if (
      currentNode.scopeRules.length > 0 &&
      adapter &&
      !checkScope(currentNode.scopeRules, adapter)
    ) {
      logger.warn(
        `Scope denied for ${userId}: command not available on adapter ${adapter}`,
      );
      return Command.fail('scope_denied', '此命令不可在当前平台使用。');
    }

    // Execute action
    if (currentNode.actionCallback) {
      try {
        return await currentNode.actionCallback(context, argsDict);
      } catch (error: any) {
        logger.error(`Command execution error: ${error.message}`);
        return Command.fail('execution_error', `命令执行错误: ${error.message}`);
      }
    }

    // No action defined - show usage hint
    return Command.fail(
      'no_action',
      this.generateUsageHint(currentNode, parts.join(' ')),
    );
  }

  /**
   * Generate usage hint for a command node
   */
  private generateUsageHint(node: Command, currentPath: string): string {
    const hints: string[] = [`命令不完整。用法:`];

    // If node has children, show available subcommands
    if (node.children.size > 0) {
      const subcmds: string[] = [];
      const seen = new Set<string>();

      for (const [, child] of node.children) {
        // Only show primary names (not aliases)
        if (!seen.has(child.name)) {
          seen.add(child.name);
          const desc = child.description ? ` - ${child.description}` : '';
          subcmds.push(`  /${currentPath} ${child.name}${desc}`);
        }
      }

      if (subcmds.length > 0) {
        hints.push('\n可用子命令:');
        hints.push(...subcmds);
      }
    }

    // If node has arg child, show argument info
    if (node.argChild) {
      const argName = node.argChild.name;
      const desc = node.argChild.description
        ? ` (${node.argChild.description})`
        : '';
      hints.push(`\n参数: <${argName}>${desc}`);

      if (node.argChild.defaultValue !== undefined) {
        hints.push(`默认值: ${node.argChild.defaultValue}`);
      }
    }

    // If node has action but no children/args, it should have executed
    // Show description if available
    if (node.description && node.children.size === 0 && !node.argChild) {
      hints.push(`\n${node.description}`);
    }

    return hints.join('\n');
  }

  /**
   * Generate help menu for all registered commands.
   */
  async generateHelpMenu(userId?: string): Promise<string> {
    const lines: string[] = ['可用命令列表:'];

    const canAccess = async (path: string, node: Command): Promise<boolean> => {
      if (!this.permissionChecker || node.requiredPermissions.length === 0) {
        return true;
      }
      return Boolean(
        await this.permissionChecker(userId, node.requiredPermissions, node, null),
      );
    };

    for (const [, cmd] of this.rootCommands) {
      const help = this.permissionChecker
        ? await cmd.getHelpFiltered('', canAccess)
        : cmd.getHelp();
      if (help) {
        lines.push(help);
      }
    }

    return lines.join('\n');
  }
}

// ── Singleton Instance ──

export const commandRegistry = new CommandRegistry();

// ── Dispatcher helper ──

export async function CMDdispatcher(context: CommandSessionContext): Promise<void> {
  try {
    const event = context.event || {};
    const cmdName = event.command;
    const rawArgs = event.args || [];

    if (!cmdName) {
      if (context.message) {
        await context.message('请输入有效命令。输入 /help 查看可用命令。');
      }
      return;
    }

    if (cmdName.toLowerCase() === 'help') {
      const userId = event.userId ?? context.userId;
      if (context.message) {
        await context.message(await commandRegistry.generateHelpMenu(userId));
      }
      return;
    }

    const inputString = [cmdName, ...rawArgs].join(' ');
    const result = await commandRegistry.execute(inputString, context);
    if (typeof result === 'string') {
      if (context.message) await context.message(result);
    } else if (result && typeof result === 'object' && 'message' in result) {
      if (context.message) await context.message(result.message);
    }
  } catch (error: any) {
    logger.error(`[Dispatcher Error]: ${error}`);
    if (context.message) {
      await context.message('系统执行命令时遇到错误，请稍后再试。');
    }
  }
}
