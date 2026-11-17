import type { Request, Response } from 'express';

import { parseRequest } from '../../shared/request/parse-request.js';
import { getAuthUser } from '../authentication/authentication.middleware.js';
import {
    testExecutionAssignRequestSchema,
    testExecutionCreateRequestSchema,
    testExecutionIdParamsSchema,
    testExecutionPageRequestSchema,
    testExecutionProgressRequestSchema,
    testExecutionProjectParamsSchema,
    testExecutionResultRequestSchema,
} from './test-execution.request.dto.js';
import { testExecutionService } from './test-execution.service.js';

// HTTP ↔ service mapping only: parse the request, call the service, choose the status code. `projectId`
// comes from the parent path (the router is created with mergeParams).
export const testExecutionController = {
    async getPage(req: Request, res: Response): Promise<void> {
        const { projectId } = parseRequest(testExecutionProjectParamsSchema, req.params);
        const request = parseRequest(testExecutionPageRequestSchema, req.query);

        res.json(await testExecutionService.getPage(getAuthUser(req), projectId, request));
    },

    async getProgress(req: Request, res: Response): Promise<void> {
        const { projectId } = parseRequest(testExecutionProjectParamsSchema, req.params);
        const request = parseRequest(testExecutionProgressRequestSchema, req.query);

        res.json(await testExecutionService.getProgress(getAuthUser(req), projectId, request));
    },

    async getById(req: Request, res: Response): Promise<void> {
        const { projectId, executionId } = parseRequest(testExecutionIdParamsSchema, req.params);

        res.json(await testExecutionService.getById(getAuthUser(req), projectId, executionId));
    },

    async getAuditLogs(req: Request, res: Response): Promise<void> {
        const { projectId, executionId } = parseRequest(testExecutionIdParamsSchema, req.params);

        res.json(await testExecutionService.getAuditLogs(getAuthUser(req), projectId, executionId));
    },

    async assign(req: Request, res: Response): Promise<void> {
        const { projectId } = parseRequest(testExecutionProjectParamsSchema, req.params);
        const request = parseRequest(testExecutionAssignRequestSchema, req.body);

        res.status(201).json(await testExecutionService.assign(getAuthUser(req), projectId, request));
    },

    async create(req: Request, res: Response): Promise<void> {
        const { projectId } = parseRequest(testExecutionProjectParamsSchema, req.params);
        const request = parseRequest(testExecutionCreateRequestSchema, req.body);
        const execution = await testExecutionService.create(getAuthUser(req), projectId, request);

        res.status(201).location(`${req.baseUrl}/${execution.id}`).json(execution);
    },

    async recordResult(req: Request, res: Response): Promise<void> {
        const { projectId, executionId } = parseRequest(testExecutionIdParamsSchema, req.params);
        const request = parseRequest(testExecutionResultRequestSchema, req.body);

        res.json(await testExecutionService.recordResult(getAuthUser(req), projectId, executionId, request));
    },
};
