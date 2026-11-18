import type { Request, Response } from 'express';

import { CACHE_STATUS_HEADER } from '../../app/cache.js';
import { parseRequest } from '../../shared/request/parse-request.js';
import { getAuthUser } from '../authentication/authentication.middleware.js';
import { analyticsRequestSchema } from './analytics.request.dto.js';
import { analyticsService } from './analytics.service.js';

// HTTP ↔ service mapping only.
export const analyticsController = {
    async get(req: Request, res: Response): Promise<void> {
        const request = parseRequest(analyticsRequestSchema, req.query);

        const { value, cacheStatus } = await analyticsService.get(getAuthUser(req), request);

        res.set(CACHE_STATUS_HEADER, cacheStatus).json(value);
    },
};
