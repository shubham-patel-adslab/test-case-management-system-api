import type { ErrorDetailDto } from '../response/error.response.dto.js';

export const ERROR_CODE = {
    BAD_REQUEST: 'BAD_REQUEST',
    NOT_FOUND: 'NOT_FOUND',
    PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

type AppErrorOptions = {
    details?: ErrorDetailDto[];
    cause?: unknown;
};

// An expected (operational) error: the central error handler turns it into the error envelope with
// this status. Anything else that reaches the handler is treated as a bug and becomes a 500.
export class AppError extends Error {
    readonly status: number;
    readonly code: ErrorCode;
    readonly details: ErrorDetailDto[] | undefined;

    constructor(status: number, code: ErrorCode, message: string, options: AppErrorOptions = {}) {
        super(message, { cause: options.cause });
        this.name = 'AppError';
        this.status = status;
        this.code = code;
        this.details = options.details;
    }
}
