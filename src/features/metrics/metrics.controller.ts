import type { Request, Response } from 'express';

import { getCacheMetrics } from '../../app/cache.js';
import { toCacheMetricsResponseDto } from './metrics.mapper.js';

// HTTP ↔ data mapping only. No service: there are no business rules, only the cache module's counters to map.
export const metricsController = {
    getCache(_req: Request, res: Response): void {
        res.json(toCacheMetricsResponseDto(getCacheMetrics()));
    },
};
