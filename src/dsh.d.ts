declare module '@deepseek-ai/cordis' {
  export interface Context {
    tools: {
      register(tool: any): void;
    };
    webServer: {
      register(options: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: any, res: any) => Promise<void> | void;
      }): () => void;
    };
    effect(fn: () => void | (() => void), name?: string): void;
    [key: string]: any;
  }
}

declare module '@deepseek-ai/dsh-tools' {
  export interface ToolDefinition<P = any, R = any> {
    name: string;
    description: string;
    parameters?: Record<string, any>;
    output?: {
      schema?: Record<string, any>;
      render?: (args: P, result: R) => Array<{ type: string; text?: string; [key: string]: any }>;
    };
    execute: (args: P, exec?: any) => Promise<R> | R;
  }

  export function defineTool<P = any, R = any>(def: ToolDefinition<P, R>): ToolDefinition<P, R>;
}

declare module '@deepseek-ai/schemastery' {
  export interface Schema<T = any> {
    description(desc: string): this;
    default(val: T): this;
    [key: string]: any;
  }

  const z: {
    object(shape: Record<string, any>): Schema<any>;
    string(): Schema<string>;
    number(): Schema<number>;
    boolean(): Schema<boolean>;
    array(inner: any): Schema<any[]>;
    [key: string]: any;
  };

  export default z;
}
