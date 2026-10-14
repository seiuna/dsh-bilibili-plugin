export type ArgsType = Record<string, any>;

/** Standardized command execution result. */
export interface CmdResult {
  ok: boolean;
  /** Failure type (e.g. "permission_denied", "invalid_args", "not_found") */
  type?: string;
  /** Human-readable message */
  message: string;
}

export interface CommandSessionContext {
  userId?: string;
  adapter?: string;
  sessionType?: string;
  event?: {
    userId?: string;
    adapter?: string;
    command?: string;
    args?: string[];
    [key: string]: any;
  };
  message?: (msg: string | CmdResult) => Promise<any> | any;
  [key: string]: any;
}

export type ActionCallback<C = CommandSessionContext> = (
  context: C,
  args: ArgsType,
) => Promise<CmdResult | string | void> | CmdResult | string | void;

export type ValidatorFn = (value: string) => true | string;

export interface ParsedScopeRules {
  /** Positive matchers: concrete adapter names or "all" */
  positive: string[];
  /** Negative matchers: concrete adapter names to exclude */
  negative: string[];
}
