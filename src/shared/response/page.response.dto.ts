import { z } from 'zod';

import type { PageRequestDto } from '../request/page.request.dto.js';

// Paginated list envelope shared with the UI (ui-requirements §6.2).
export type PageResponseDto<T> = {
    items: T[];
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
};

// OpenAPI schema for one feature's page, e.g. createPageResponseSchema(projectDetailsResponseSchema).
export function createPageResponseSchema<TItem extends z.ZodType>(itemSchema: TItem) {
    return z.object({
        items: z.array(itemSchema),
        page: z.number().int(),
        pageSize: z.number().int(),
        totalItems: z.number().int(),
        totalPages: z.number().int(),
    });
}

export function toPageResponseDto<T>(items: T[], request: PageRequestDto, totalItems: number): PageResponseDto<T> {
    return {
        items,
        page: request.page,
        pageSize: request.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / request.pageSize),
    };
}
