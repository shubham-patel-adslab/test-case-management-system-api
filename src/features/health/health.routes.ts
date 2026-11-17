import { Router } from 'express';

import { checkDatabaseConnection } from '../../app/database.js';
import { jsonContent, openApiRegistry } from '../../app/openapi.js';
import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { errorResponseSchema } from '../../shared/response/error.response.dto.js';
import { healthResponseSchema, type HealthResponseDto } from './health.response.dto.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
    try {
        await checkDatabaseConnection();
    } catch (error) {
        throw new AppError(503, ERROR_CODE.SERVICE_UNAVAILABLE, 'Database is unavailable', { cause: error });
    }

    const response: HealthResponseDto = { status: 'ok' };

    res.json(response);
});

openApiRegistry.registerPath({
    method: 'get',
    path: '/health',
    tags: ['Health'],
    summary: 'Health check',
    description: 'Reports whether the API is running and can reach the database.',
    security: [],
    responses: {
        200: { description: 'API and database are up', content: jsonContent(healthResponseSchema) },
        503: { description: 'Database is unreachable', content: jsonContent(errorResponseSchema) },
    },
});
