import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base application exception that extends NestJS's HttpException.
 * Ensures all custom errors map directly to proper HTTP status codes and response formats.
 */
export class BaseAppException extends HttpException {
  constructor(
    message: string,
    status: HttpStatus,
    public readonly errorCode?: string,
  ) {
    super(
      {
        success: false,
        statusCode: status,
        message,
        errorCode: errorCode || 'INTERNAL_ERROR',
      },
      status,
    );
  }
}

export class DatabaseError extends BaseAppException {
  constructor(
    message = 'A database error occurred',
    errorCode = 'DATABASE_ERROR',
  ) {
    super(message, HttpStatus.INTERNAL_SERVER_ERROR, errorCode);
  }
}

export class NotFoundError extends BaseAppException {
  constructor(resource = 'Resource', errorCode = 'NOT_FOUND') {
    super(`${resource} not found`, HttpStatus.NOT_FOUND, errorCode);
  }
}

export class BadRequestError extends BaseAppException {
  constructor(message = 'Bad request', errorCode = 'BAD_REQUEST') {
    super(message, HttpStatus.BAD_REQUEST, errorCode);
  }
}

export class ConflictError extends BaseAppException {
  constructor(message = 'Resource already exists', errorCode = 'CONFLICT') {
    super(message, HttpStatus.CONFLICT, errorCode);
  }
}

export class UnauthorizedError extends BaseAppException {
  constructor(message = 'Unauthorized access', errorCode = 'UNAUTHORIZED') {
    super(message, HttpStatus.UNAUTHORIZED, errorCode);
  }
}
