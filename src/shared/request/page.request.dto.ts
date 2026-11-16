import { z } from 'zod';

import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constant/page.constant.js';
import { PG_INTEGER_MAX } from './id.schema.js';

// Query-string values arrive as strings, hence coerce. Missing → default; out of range → 400.
export const pageRequestSchema = z.object({
    page: z.coerce.number().int().min(1).max(PG_INTEGER_MAX).default(DEFAULT_PAGE),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PageRequestDto = z.infer<typeof pageRequestSchema>;
