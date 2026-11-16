import type { z } from 'zod';

import { AppError, ERROR_CODE } from '../error/app.error.js';

// ['steps', 0, 'expectedResult'] → 'steps[0].expectedResult' — the field format the UI maps back onto
// its form fields (ui-requirements §6.2). An error on the whole input has an empty path → ''.
function toFieldPath(path: PropertyKey[]): string {
    return path.reduce<string>((field, segment) => {
        if (typeof segment === 'number') {
            return `${field}[${segment}]`;
        }

        return field ? `${field}.${String(segment)}` : String(segment);
    }, '');
}

// Validates one part of a request (body, query, or params) and returns the parsed, typed value.
// Called at the top of a controller handler: unlike a middleware writing to res.locals, the return type
// is inferred from the schema, so handlers need no type assertions.
export function parseRequest<TSchema extends z.ZodType>(schema: TSchema, input: unknown): z.output<TSchema> {
    const result = schema.safeParse(input);

    if (!result.success) {
        throw new AppError(400, ERROR_CODE.VALIDATION_ERROR, 'Request validation failed', {
            details: result.error.issues.map((issue) => ({
                field: toFieldPath(issue.path),
                message: issue.message,
            })),
        });
    }

    return result.data;
}
