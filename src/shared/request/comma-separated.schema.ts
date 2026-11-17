import { z } from 'zod';

// A multi-value query-string filter: "HIGH,CRITICAL" → ['HIGH', 'CRITICAL']. Optional; when present it needs at
// least one value. An invalid entry fails as e.g. priority[1]. `description` documents it in OpenAPI.
export function commaSeparatedSchema<TItem extends z.ZodType<unknown, string>>(item: TItem, description: string) {
    return z
        .string()
        .meta({ description })
        .transform((value) => value.split(',').map((part) => part.trim()).filter((part) => part !== ''))
        .pipe(z.array(item).min(1))
        .optional();
}
