import { z } from 'zod';

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;

export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export type Sort<TField extends string> = { field: TField; direction: SortDirection };

// The list query parameter `sort=<field>:<asc|desc>` → { field, direction }. Missing → `defaultSort`, so a
// client that doesn't send it still gets the documented order; anything else → 400. Each list maps its
// fields to fixed SQL expressions (toOrderBy in database.ts), so the value never reaches SQL.
export function sortSchema<const TFields extends readonly [string, ...string[]]>(
    fields: TFields,
    defaultSort: `${TFields[number]}:${SortDirection}`,
) {
    const pattern = new RegExp(`^(${fields.join('|')}):(${SORT_DIRECTIONS.join('|')})$`);
    const description = `<field>:<asc|desc>, field one of ${fields.join(', ')}. Default ${defaultSort}.`;

    return z
        .string()
        .regex(pattern, { message: `Must be ${description}` })
        .meta({ description })
        .default(defaultSort)
        // The regex above guarantees both parts, so the assertion only names what was already checked.
        .transform((value): Sort<TFields[number]> => {
            const [field, direction] = value.split(':') as [TFields[number], SortDirection];

            return { field, direction };
        });
}
