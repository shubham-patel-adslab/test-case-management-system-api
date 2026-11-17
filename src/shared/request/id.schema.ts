import { z } from 'zod';

// Most primary keys are Postgres `integer`. A larger id would make Postgres throw "out of range" (a 500), so
// it is rejected as a 400 here instead.
export const PG_INTEGER_MAX = 2_147_483_647;

// For ids inside a JSON body: must already be a number.
export const idSchema = z.number().int().positive().max(PG_INTEGER_MAX);

// For ids in the URL path or query string, which always arrive as strings.
export const idParamSchema = z.coerce.number().int().positive().max(PG_INTEGER_MAX);

// For UUID ids (users), in a body or the URL. Lowercased first so an id can be compared as a string with
// the lowercase form Postgres returns (e.g. "is this my own account?"); an invalid UUID is a 400 here
// rather than a Postgres "invalid input syntax for type uuid" 500.
export const uuidSchema = z.string().trim().toLowerCase().pipe(z.uuid()).meta({ format: 'uuid' });

// A list of ids in a JSON body (team members, suites, selected test cases). Duplicates are rejected rather
// than merged, so an error's field[i] points at what the client sent.
export function idListSchema(length: { min?: number; max: number }) {
    return z
        .array(idSchema)
        .min(length.min ?? 0)
        .max(length.max)
        .refine((ids) => new Set(ids).size === ids.length, { message: 'Must not contain duplicates' });
}

