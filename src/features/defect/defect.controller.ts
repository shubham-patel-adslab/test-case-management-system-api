import type { Request, Response } from 'express';

import { parseRequest } from '../../shared/request/parse-request.js';
import { getAuthUser } from '../authentication/authentication.middleware.js';
import { defectCreateRequestSchema, defectExecutionParamsSchema } from './defect.request.dto.js';
import { defectService } from './defect.service.js';

// HTTP ↔ service mapping only. Path ids come from the parent path (the router is created with mergeParams).
export const defectController = {
    // 201 without Location: a defect is read through its execution (GET …/test-executions/:executionId).
    async create(req: Request, res: Response): Promise<void> {
        const { projectId, executionId } = parseRequest(defectExecutionParamsSchema, req.params);
        const request = parseRequest(defectCreateRequestSchema, req.body);

        res.status(201).json(await defectService.create(getAuthUser(req), projectId, executionId, request));
    },
};
