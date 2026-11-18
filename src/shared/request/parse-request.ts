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

// C0 and C1 control characters and DEL, except tab, line feed and carriage return (multi-line text keeps its
// layout). Invisible, never meaningful in this app's text, and PostgreSQL rejects NUL in text outright.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

// Every string in the input, at any depth, without control characters. A copy: the request's own objects are
// left alone (req.query is read-only in Express 5).
function stripControlCharacters(value: unknown): unknown {
    if (typeof value === 'string') {
        return value.replace(CONTROL_CHARACTERS, '');
    }

    if (Array.isArray(value)) {
        return value.map(stripControlCharacters);
    }

    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripControlCharacters(item)]));
    }

    return value;
}

// Validates one part of a request (body, query, or params) and returns the parsed, typed value.
// Called at the top of a controller handler: unlike a middleware writing to res.locals, the return type
// is inferred from the schema, so handlers need no type assertions.
// Sanitizing is only the control-character strip above, for every field at once (a new field can't miss it).
// Text is otherwise kept as written, HTML included — testers write XSS test cases. XSS is prevented on output:
// the API returns JSON only (helmet's nosniff and CSP), and the UI renders text, never HTML.
export function parseRequest<TSchema extends z.ZodType>(schema: TSchema, input: unknown): z.output<TSchema> {
    const result = schema.safeParse(stripControlCharacters(input));

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
