/* eslint-disable max-classes-per-file */

export enum ErrorCode {
  Normal = 0,
  RELEASE_IDENTICAL = 1,
  PARAMS_INVALID = 2,
  PUBLISH_FAILED = 3,
  UPDATE_ERROR = 4,
  QUERY_ERROR = 5,
  LOG_ERROR = 6,
  NOT_FOUND = 404,
}

export class AppError extends Error {
  constructor(
    message: string | Error,
    public code: ErrorCode = ErrorCode.Normal,
    public status = 200,
  ) {
    super(message instanceof Error ? message.message : message)
    this.name = 'AppError'
  }

  public getMetaData() {
    return {
      code: this.code,
      message: this.message,
    }
  }
}

export class NotFound extends AppError {
  constructor(message?: string | Error) {
    super(message || 'Not Found')
    this.name = 'NotFoundError'
  }

  public status = 404
}

export class Unauthorized extends AppError {
  constructor(message?: string | Error) {
    super(message || 'Unauthorized')
    this.name = 'UnauthorizedError'
  }

  public status = 401
}
