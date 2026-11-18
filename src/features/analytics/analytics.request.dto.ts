import { z } from 'zod';

import { idParamSchema } from '../../shared/request/id.schema.js';
import { ANALYTICS_DEFAULT_TIME_ZONE, ANALYTICS_RANGE_MAX_DAYS, TIME_ZONE_INVALID_MESSAGE } from './analytics.constant.js';

const MILLISECONDS_PER_DAY = 86_400_000;

// The shape of a region name (Europe/Berlin, UTC), checked here; whether the database knows it (after resolving an
// old alias) is checked by the service, which can ask the database. No offsets: Postgres reads '+05:30' with the
// sign inverted (POSIX).
const TIME_ZONE_NAME_PATTERN = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/;

// Both ends are calendar dates, inclusive. They're days in `timeZone`, so the dashboard's days are the user's days.
function daysInRange(from: string, to: string): number {
    return (Date.parse(to) - Date.parse(from)) / MILLISECONDS_PER_DAY + 1;
}

function hasNoIssues(payload: { issues: readonly unknown[] }): boolean {
    return payload.issues.length === 0;
}

// The dashboard over every project the caller may read, or one of them (`projectId`).
export const analyticsRequestSchema = z
    .object({
        from: z.iso.date(),
        to: z.iso.date(),
        timeZone: z
            .string()
            .regex(TIME_ZONE_NAME_PATTERN, { message: TIME_ZONE_INVALID_MESSAGE })
            .default(ANALYTICS_DEFAULT_TIME_ZONE),
        projectId: idParamSchema.optional(),
    })
    // Range checks only once both dates are valid, so a bad `from` gives one error, not three.
    .refine((request) => request.from <= request.to, { path: ['to'], message: 'Must not be before from', when: hasNoIssues })
    .refine((request) => daysInRange(request.from, request.to) <= ANALYTICS_RANGE_MAX_DAYS, {
        path: ['to'],
        message: `The range must not exceed ${ANALYTICS_RANGE_MAX_DAYS} days`,
        when: hasNoIssues,
    });

export type AnalyticsRequestDto = z.infer<typeof analyticsRequestSchema>;
