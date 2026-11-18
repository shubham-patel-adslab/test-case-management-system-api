import { Router } from 'express';

import { cacheStatusHeaders, errorResponse, jsonContent, openApiRegistry, tooManyRequestsResponse } from '../../app/openapi.js';
import { RATE_LIMIT } from '../../app/rate-limit.js';
import { PERMISSION_CODE, RESOURCE_CODE } from '../authorization/authorization.constant.js';
import { authorize } from '../authorization/authorization.middleware.js';
import { analyticsController } from './analytics.controller.js';
import { analyticsRequestSchema } from './analytics.request.dto.js';
import { analyticsResponseSchema } from './analytics.response.dto.js';

const rateLimitedResponse = tooManyRequestsResponse(RATE_LIMIT.ANALYTICS, 'user', 'analytics');

// Every role may view analytics (PRD Features §5); which projects it covers is membership, in the service.
// Mounted at /analytics in api.router.ts, behind authenticate.
export const analyticsRouter = Router();

analyticsRouter.get('/', authorize(RESOURCE_CODE.ANALYTICS, PERMISSION_CODE.READ), analyticsController.get);

openApiRegistry.registerPath({
    method: 'get',
    path: '/analytics',
    tags: ['Analytics'],
    summary: 'Dashboard: execution summary, trend, by priority/type/tester, coverage, defects',
    description: 'Across every project the caller may read (ADMIN: all; others: the projects they are a member of), '
        + 'or one of them with `projectId`. `from`/`to` are calendar days in `timeZone` (default UTC), inclusive, at most '
        + '366 days. `timeZone` is an IANA name — old names browsers still report (Asia/Calcutta, US/Eastern) are '
        + 'accepted and mean their current zone; offsets such as +05:30 are not; `range.timeZone` echoes the name sent. '
        + 'Results (passed, failed, blocked, skipped) count when they were recorded in the range; `pending` is '
        + 'the current backlog, whatever the range. Counts only — the client computes ratios (pass rate, coverage %, '
        + 'defect density = defects.total / coverage.executedCases).',
    request: { query: analyticsRequestSchema },
    responses: {
        200: { description: 'The dashboard data', headers: cacheStatusHeaders, content: jsonContent(analyticsResponseSchema) },
        400: errorResponse('Invalid request (e.g. `to` before `from`, range over 366 days, unknown time zone)'),
        401: errorResponse('Missing, invalid or expired access-token cookie, or inactive account'),
        429: rateLimitedResponse,
        403: errorResponse('Missing permission ANALYTICS READ (code FORBIDDEN)'),
        404: errorResponse('`projectId` not found, or the caller is not a member of it'),
    },
});
