import { Router } from 'express';

import { errorResponse, jsonContent, openApiRegistry } from '../../app/openapi.js';
import { PERMISSION_CODE, RESOURCE_CODE } from '../authorization/authorization.constant.js';
import { authorize } from '../authorization/authorization.middleware.js';
import { metricsController } from './metrics.controller.js';
import { cacheMetricsResponseSchema } from './metrics.response.dto.js';

// Mounted at /metrics in api.router.ts, behind authenticate. Admins only (METRICS READ).
export const metricsRouter = Router();

metricsRouter.get('/cache', authorize(RESOURCE_CODE.METRICS, PERMISSION_CODE.READ), metricsController.getCache);

openApiRegistry.registerPath({
    method: 'get',
    path: '/metrics/cache',
    tags: ['Metrics'],
    summary: 'Cache effectiveness: hits, misses, hit rate, response times',
    description: 'Per cache (analytics 15 min, test suite lists 30 min, project details 1 hour — PRD Backend Req §1). '
        + 'Counted in this API process since `since` (reset on restart). Each cached response also carries X-Cache.',
    responses: {
        200: { description: 'The counters', content: jsonContent(cacheMetricsResponseSchema) },
        401: errorResponse('Missing, invalid or expired access-token cookie, or inactive account'),
        403: errorResponse('Missing permission METRICS READ (code FORBIDDEN)'),
    },
});
