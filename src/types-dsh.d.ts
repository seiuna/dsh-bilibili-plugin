declare module '@deepseek-ai/dsh-session' {
  export function SessionId(id: string): string;
}

declare module '@deepseek-ai/dsh-llm' {
  export function createUserMessage(input: {
    content: Array<{ type: string; [key: string]: any }>;
    source: { kind: string; [key: string]: any };
  }): any;
}
