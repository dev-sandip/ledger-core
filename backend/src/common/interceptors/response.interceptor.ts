import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Response as ExpressResponse } from 'express';

/**
 * Standardized structure for all outgoing API responses.
 */
type ApiResponse<T = unknown> = {
  statusCode: number;
  message: string;
  data?: T;
  error?: unknown;
};

/**
 * Helper function to check if an object is empty.
 */
function isEmptyObject(obj: unknown): boolean {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    !Array.isArray(obj) &&
    Object.keys(obj).length === 0
  );
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor<unknown, unknown> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const responseObj = ctx.getResponse<ExpressResponse>();

    return next.handle().pipe(
      map((data: any) => {
        const contentType = responseObj.getHeader?.('content-type') as string;
        if (contentType && !contentType.includes('application/json')) {
          return data;
        }

        const statusCode = responseObj.statusCode ?? 200;

        const response: ApiResponse = {
          message: data?.message || responseObj.statusMessage || 'OK',
          statusCode,
          data: data?.data,
        };

        if (typeof data !== 'object' || data === null) {
          response.data = data;
          return response;
        }

        if ('data' in data || 'error' in data || 'message' in data) {
          if ('meta' in data) {
            response.data = data;
          } else if ('data' in data) {
            response.data = data.data;
          } else {
            response.data = data;
          }

          if ('message' in data && data.message) {
            response.message = data.message;
          }
        } else {
          response.data = data;
        }

        if (isEmptyObject(response.data)) {
          response.data = null;
        }

        return response;
      }),

      catchError((err) => {
        const statusCode = err instanceof HttpException ? err.getStatus() : 500;
        responseObj.status(statusCode);

        const message: string =
          err?.message ??
          err?.response?.message ??
          'Whoops! Something went wrong.';

        const errorResponse: ApiResponse = {
          message,
          statusCode,
          error: err?.response?.error || null,
        };

        return of(errorResponse);
      }),
    );
  }
}
