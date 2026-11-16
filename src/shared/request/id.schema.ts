import { z } from 'zod';

// Primary keys are Postgres `integer`. A larger id would make Postgres throw "out of range" (a 500), so
// it is rejected as a 400 here instead.
export const PG_INTEGER_MAX = 2_147_483_647;

// For ids inside a JSON body: must already be a number.
export const idSchema = z.number().int().positive().max(PG_INTEGER_MAX);

// For ids in the URL path or query string, which always arrive as strings.
export const idParamSchema = z.coerce.number().int().positive().max(PG_INTEGER_MAX);
