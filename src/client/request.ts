/** All client HTTP calls share error handling; a 404 alone never proves a restart is needed. */
export class BiliRequestError extends Error {
  constructor(
    message: string,
    readonly kind: 'http' | 'business' | 'invalid-response' | 'network',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BiliRequestError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown, fallback = '请求失败，请重试'): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

interface JsonRequestOptions<T> {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
  label: string;
  validate: (value: unknown) => value is T;
  requireSuccess?: boolean;
}

export async function requestJson<T>(path: string, options: JsonRequestOptions<T>): Promise<T> {
  const { signal, label } = options;
  signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(`/api/bilibili${path}`, {
      method: options.method ?? 'GET',
      ...(options.body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options.body),
      }),
      signal,
    });
  } catch (error) {
    signal?.throwIfAborted();
    if (isAbortError(error)) throw error;
    throw new BiliRequestError(`${label}：网络请求失败，请检查连接后重试`, 'network');
  }
  signal?.throwIfAborted();

  let value: unknown;
  try {
    value = await response.json();
  } catch (error) {
    signal?.throwIfAborted();
    if (isAbortError(error)) throw error;
    // HTML error pages must not hide the HTTP error or leak their body into the UI.
    if (response.ok) {
      throw new BiliRequestError(`${label}：服务返回了无效的 JSON`, 'invalid-response', response.status);
    }
  }
  signal?.throwIfAborted();
  const serverError = isRecord(value) && typeof value.error === 'string' && value.error.trim()
    ? value.error : undefined;
  if (!response.ok) {
    throw new BiliRequestError(
      serverError || `${label}：${response.status === 404 ? '资源或接口不存在，' : ''}HTTP ${response.status}`,
      'http', response.status,
    );
  }
  if (isRecord(value) && value.success === false) {
    throw new BiliRequestError(serverError || `${label}失败`, 'business', response.status);
  }
  if ((options.requireSuccess && (!isRecord(value) || value.success !== true)) || !options.validate(value)) {
    throw new BiliRequestError(`${label}：服务响应缺少必要字段或格式不正确`, 'invalid-response', response.status);
  }
  return value;
}
