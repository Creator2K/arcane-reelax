import { ZodError } from 'zod';

export class AppError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function handleError(e: unknown) {
  if (e instanceof AppError) {
    return {
      status: e.status,
      body: { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } },
    };
  }
  if (e instanceof ZodError) {
    return {
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR', message: '请求参数不合法。', details: e.issues } },
    };
  }
  if (e && typeof e === 'object' && 'statusCode' in e) {
    const status = Number((e as any).statusCode) || 400;
    const code = String((e as any).code || 'REQUEST_ERROR');
    const message = status === 400 && code === 'FST_ERR_CTP_EMPTY_JSON_BODY'
      ? '请求体不能为空。'
      : status < 500
        ? '请求不合法，请检查参数后重试。'
        : '服务器暂时无法处理该请求，请稍后重试。';
    return { status, body: { error: { code, message } } };
  }

  console.error('UNHANDLED ERROR', e);
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: '服务器暂时无法处理该请求，请稍后重试。' } },
  };
}

export const ok = (data: unknown) => data;
