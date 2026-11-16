import type { ErrorRequestHandler, RequestHandler } from 'express';

import type { ErrorResponseDto } from '../response/error.response.dto.js';
import { AppError, ERROR_CODE } from './app.error.js';

const HTTP_STATUS_INTERNAL_ERROR = 500;

// Shape of the errors express.json() (body-parser) throws: http-errors with a `type` discriminator.
type BodyParserError = Error & { type: string; status: number };

function isBodyParserError(error: unknown): error is BodyParserError {
    return error instanceof Error
        && 'type' in error && typeof error.type === 'string'
        && 'status' in error && typeof error.status === 'number';
}

function toAppError(error: unknown): AppError {
    if (error instanceof AppError) {
        return error;
    }

    if (isBodyParserError(error)) {
        if (error.type === 'entity.parse.failed') {
            return new AppError(400, ERROR_CODE.BAD_REQUEST, 'Request body is not valid JSON', { cause: error });
        }

        if (error.type === 'entity.too.large') {
            return new AppError(413, ERROR_CODE.PAYLOAD_TOO_LARGE, 'Request body is too large', { cause: error });
        }

        if (error.status < HTTP_STATUS_INTERNAL_ERROR) {
            return new AppError(error.status, ERROR_CODE.BAD_REQUEST, error.message, { cause: error });
        }
    }

    // Unknown error = bug. The client gets a generic message; details stay in the server log.
    return new AppError(HTTP_STATUS_INTERNAL_ERROR, ERROR_CODE.INTERNAL_ERROR, 'Internal server error', { cause: error });
}

function toErrorResponse(error: AppError): ErrorResponseDto {
    return {
        error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
        },
    };
}

export const notFoundHandler: RequestHandler = (req) => {
    throw new AppError(404, ERROR_CODE.NOT_FOUND, `Route ${req.method} ${req.path} not found`);
};

// Registered last. Express 5 forwards errors thrown or rejected in async handlers here automatically.
export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    // Response already partly streamed: only Express's default handler can still close it correctly.
    if (res.headersSent) {
        next(error);
        return;
    }

    const appError = toAppError(error);

    if (appError.status >= HTTP_STATUS_INTERNAL_ERROR) {
        console.error(appError.cause ?? appError);
    }

    res.status(appError.status).json(toErrorResponse(appError));
};
