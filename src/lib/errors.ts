import { ERROR_CODES, type ErrorCode } from '@/config/constants';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly fields?: Record<string, string>;

  constructor(code: ErrorCode, message?: string, fields?: Record<string, string>) {
    const spec = ERROR_CODES[code];
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = spec.http;
    this.fields = fields;
  }

  static fromCode(code: ErrorCode, message?: string, fields?: Record<string, string>): AppError {
    return new AppError(code, message, fields);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
