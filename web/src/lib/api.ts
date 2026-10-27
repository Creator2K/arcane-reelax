const BASE = '';

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function api<T = any>(path: string, options: RequestInit & { body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    ...options,
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body as any) : undefined,
  });
  if (!res.ok) {
    let data: any = null;
    try { data = await res.json(); } catch {}
    if (res.status === 401 && data?.error?.code === 'UNAUTHENTICATED') {
      window.dispatchEvent(new CustomEvent('arcane:unauthenticated'));
    }
    throw new ApiError(data?.error?.code ?? 'REQUEST_FAILED', data?.error?.message ?? '请求失败，请稍后重试。', res.status, data?.error?.details);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiGet = <T = any>(path: string) => api<T>(path);
export const apiPost = <T = any>(path: string, body?: any) => api<T>(path, { method: 'POST', body });
export const apiPut = <T = any>(path: string, body?: any) => api<T>(path, { method: 'PUT', body });
