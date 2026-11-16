import { z } from 'zod';

export const errorDetailSchema = z.object({
    field: z.string(),
    message: z.string(),
});

// Error envelope shared with the UI (ui-requirements §6.2) — every non-2xx response has this shape.
export const errorResponseSchema = z
    .object({
        error: z.object({
            code: z.string(),
            message: z.string(),
            details: z.array(errorDetailSchema).optional(),
        }),
    })
    .meta({ id: 'ErrorResponse' });

export type ErrorDetailDto = z.infer<typeof errorDetailSchema>;
export type ErrorResponseDto = z.infer<typeof errorResponseSchema>;
