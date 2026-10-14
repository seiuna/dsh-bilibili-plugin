export function createUserMessage(input: any): any {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    ...input,
  };
}
