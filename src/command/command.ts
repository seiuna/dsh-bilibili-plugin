import type {
  ActionCallback,
  ArgsType,
  CmdResult,
  ParsedScopeRules,
  ValidatorFn,
} from './types.js';

// ── Command Node ──

export class Command {
  public name: string;
  public isArg: boolean;
  public description: string = '';
  public defaultValue: any = undefined;
  public validator: ValidatorFn | null = null;

  /** Children routing table (literal name -> child) */
  public children: Map<string, Command> = new Map();
  /** Dynamic argument child */
  public argChild: Command | null = null;

  /** Redirect target pointer */
  public redirectTarget: Command | null = null;

  /** Action callback to execute when this node is the final match */
  public actionCallback: ActionCallback | null = null;
  /** Permissions or tags required to execute this node */
  public requiredPermissions: string[] = [];
  /** Optional adapter scope rules (e.g. ["qq"], ["all", "!qq"]) */
  public scopeRules: string[] = [];

  constructor(name: string, isArg = false) {
    this.name = name;
    this.isArg = isArg;
  }

  /** Create a successful command result. */
  static ok(message: string): CmdResult {
    return { ok: true, message };
  }

  /** Create a failed command result. */
  static fail(type: string, message: string): CmdResult {
    return { ok: false, type, message };
  }

  /**
   * Create an argument node
   */
  static argument<K extends string>(name: K): Command {
    return new Command(name, true);
  }

  /**
   * Set description for this command node
   */
  desc(description: string): this {
    this.description = description;
    return this;
  }

  /**
   * Add a literal child node with optional aliases
   * @param name - Primary name
   * @param aliases - Alternative names for the same node
   */
  literal(name: string, aliases: string[] = []): Command {
    const child = new Command(name, false);

    // Map primary name and all aliases to the same child instance (lowercase for case-insensitive matching)
    this.children.set(name.toLowerCase(), child);
    for (const alias of aliases) {
      this.children.set(alias.toLowerCase(), child);
    }
    return child;
  }

  /**
   * Add an argument child node
   */
  argument(nextCommandNode: Command): Command {
    if (nextCommandNode.isArg) {
      this.argChild = nextCommandNode;
    } else {
      this.children.set(nextCommandNode.name, nextCommandNode);
    }
    return nextCommandNode;
  }

  /**
   * Attach a validator to an argument node
   */
  validate(validator: ValidatorFn): this {
    this.validator = validator;
    return this;
  }

  /**
   * Set redirect target for this node
   */
  redirect(targetNode: Command): this {
    this.redirectTarget = targetNode;
    return this;
  }

  /**
   * Set default value for argument nodes
   */
  default(value: string): this {
    this.defaultValue = value;
    return this;
  }

  /**
   * Set action callback for this command node
   */
  action(callback: ActionCallback): this {
    this.actionCallback = callback;
    return this;
  }

  /**
   * Require one or more permissions or labels to execute this command node.
   */
  require(...permissions: string[]): this {
    this.requiredPermissions.push(...permissions);
    return this;
  }

  /**
   * Restrict this command node to specific adapters.
   *
   * Scope rule syntax:
   *   - "qq"        → only the "qq" adapter
   *   - "!qq"       → any adapter except "qq"
   *   - "all" / "*" → all adapters (useful with exclusions)
   */
  scope(...rules: string[]): this {
    this.scopeRules.push(...rules.map((r) => r.trim()));
    return this;
  }

  /**
   * Get help text for this command tree
   */
  getHelp(prefix: string = ''): string {
    const lines: string[] = [];
    const currentPath = prefix
      ? this.isArg
        ? prefix
        : `${prefix} ${this.name}`
      : this.isArg
      ? `<${this.name}>`
      : this.name;

    if (this.actionCallback) {
      const desc = this.description || '无描述';
      lines.push(`/${currentPath} - ${desc}`);
    }

    for (const [name, child] of this.children) {
      // Only show primary names (not aliases)
      if (child.name === name) {
        lines.push(...child.getHelp(currentPath).split('\n').filter(Boolean));
      }
    }

    if (this.argChild) {
      lines.push(
        ...this.argChild
          .getHelp(`${currentPath} <${this.argChild.name}>`)
          .split('\n')
          .filter(Boolean),
      );
    }

    return lines.join('\n');
  }

  /**
   * Get help text filtered by custom access predicate
   */
  async getHelpFiltered(
    prefix: string,
    canAccess: (path: string, node: Command) => Promise<boolean>,
  ): Promise<string> {
    const lines: string[] = [];
    const currentPath = prefix
      ? this.isArg
        ? prefix
        : `${prefix} ${this.name}`
      : this.isArg
      ? `<${this.name}>`
      : this.name;

    // If this node itself is not accessible, hide the entire subtree
    if (!(await canAccess(currentPath, this))) {
      return '';
    }

    if (this.actionCallback) {
      const desc = this.description || '无描述';
      lines.push(`/${currentPath} - ${desc}`);
    }

    for (const [name, child] of this.children) {
      if (child.name === name) {
        const childHelp = await child.getHelpFiltered(currentPath, canAccess);
        if (childHelp) {
          lines.push(childHelp);
        }
      }
    }

    if (this.argChild) {
      const argHelp = await this.argChild.getHelpFiltered(
        `${currentPath} <${this.argChild.name}>`,
        canAccess,
      );
      if (argHelp) {
        lines.push(argHelp);
      }
    }

    return lines.join('\n');
  }
}

// ── Scope helpers ──

/**
 * Parse a list of scope rules.
 *   - "all" / "*" → positive "all"
 *   - "!qq"       → negative "qq"
 *   - "qq"        → positive "qq"
 */
export function parseScopeRules(rules: string[]): ParsedScopeRules {
  const positive: string[] = [];
  const negative: string[] = [];

  for (const rule of rules) {
    const trimmed = rule.trim();
    if (!trimmed) continue;

    if (trimmed === 'all' || trimmed === '*') {
      positive.push('all');
    } else if (trimmed.startsWith('!')) {
      const name = trimmed.slice(1).trim();
      if (name) negative.push(name);
    } else {
      positive.push(trimmed);
    }
  }

  return { positive, negative };
}

/**
 * Check whether the current adapter satisfies the scope rules.
 *   - Exclusions are checked first.
 *   - If a positive "all" exists, everything else is allowed (except excluded).
 *   - Otherwise the adapter must match one of the positive names.
 *   - No rules means allowed.
 */
export function checkScope(rules: string[], adapter: string): boolean {
  const parsed = parseScopeRules(rules);

  if (parsed.negative.includes(adapter)) {
    return false;
  }

  if (parsed.positive.includes('all')) {
    return true;
  }

  if (parsed.positive.length === 0) {
    // Only negative rules: allow everything except excluded adapters.
    return true;
  }

  return parsed.positive.includes(adapter);
}
