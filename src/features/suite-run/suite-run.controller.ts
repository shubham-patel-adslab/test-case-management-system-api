import type { Request, Response } from 'express';

import { parseRequest } from '../../shared/request/parse-request.js';
import { getAuthUser } from '../authentication/authentication.middleware.js';
import {
    suiteRunCreateRequestSchema,
    suiteRunIdParamsSchema,
    suiteRunPageRequestSchema,
    suiteRunSuiteParamsSchema,
} from './suite-run.request.dto.js';
import { suiteRunService } from './suite-run.service.js';

// HTTP ↔ service mapping only. Path ids come from the parent path (routers are created with mergeParams).
export const suiteRunController = {
    async create(req: Request, res: Response): Promise<void> {
        const { projectId, suiteId } = parseRequest(suiteRunSuiteParamsSchema, req.params);
        // Express leaves req.body undefined when the request has no body; the body is optional here.
        const request = parseRequest(suiteRunCreateRequestSchema, req.body ?? {});
        const run = await suiteRunService.create(getAuthUser(req), projectId, suiteId, request);

        res.status(201).location(`/api/projects/${projectId}/suite-runs/${run.id}`).json(run);
    },

    async getPageBySuite(req: Request, res: Response): Promise<void> {
        const { projectId, suiteId } = parseRequest(suiteRunSuiteParamsSchema, req.params);
        const request = parseRequest(suiteRunPageRequestSchema, req.query);

        res.json(await suiteRunService.getPageBySuite(getAuthUser(req), projectId, suiteId, request));
    },

    async getById(req: Request, res: Response): Promise<void> {
        const { projectId, runId } = parseRequest(suiteRunIdParamsSchema, req.params);

        res.json(await suiteRunService.getById(getAuthUser(req), projectId, runId));
    },
};
