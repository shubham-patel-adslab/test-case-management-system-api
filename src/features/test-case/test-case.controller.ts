import type { Request, Response } from 'express';

import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { parseRequest } from '../../shared/request/parse-request.js';
import { getAuthUser } from '../authentication/authentication.middleware.js';
import {
    testCaseBulkRequestSchema,
    testCaseCreateRequestSchema,
    testCaseIdParamsSchema,
    testCasePageRequestSchema,
    testCaseProjectParamsSchema,
    testCaseUpdateRequestSchema,
} from './test-case.request.dto.js';
import { testCaseService } from './test-case.service.js';

// HTTP ↔ service mapping only: parse the request, call the service, choose the status code. `projectId`
// comes from the parent path (the router is created with mergeParams).
export const testCaseController = {
    async getPage(req: Request, res: Response): Promise<void> {
        const { projectId } = parseRequest(testCaseProjectParamsSchema, req.params);
        const request = parseRequest(testCasePageRequestSchema, req.query);

        res.json(await testCaseService.getPage(getAuthUser(req), projectId, request));
    },

    async bulk(req: Request, res: Response): Promise<void> {
        const { projectId } = parseRequest(testCaseProjectParamsSchema, req.params);
        const request = parseRequest(testCaseBulkRequestSchema, req.body);

        res.json(await testCaseService.bulk(getAuthUser(req), projectId, request));
    },

    async getById(req: Request, res: Response): Promise<void> {
        const { projectId, testCaseId } = parseRequest(testCaseIdParamsSchema, req.params);

        res.json(await testCaseService.getById(getAuthUser(req), projectId, testCaseId));
    },

    async create(req: Request, res: Response): Promise<void> {
        const { projectId } = parseRequest(testCaseProjectParamsSchema, req.params);
        const request = parseRequest(testCaseCreateRequestSchema, req.body);
        const testCase = await testCaseService.create(getAuthUser(req), projectId, request);

        res.status(201).location(`${req.baseUrl}/${testCase.id}`).json(testCase);
    },

    async update(req: Request, res: Response): Promise<void> {
        const { projectId, testCaseId } = parseRequest(testCaseIdParamsSchema, req.params);
        const request = parseRequest(testCaseUpdateRequestSchema, req.body);

        if (request.id !== testCaseId) {
            throw new AppError(400, ERROR_CODE.VALIDATION_ERROR, 'Request validation failed', {
                details: [{ field: 'id', message: 'Must match the test case id in the URL' }],
            });
        }

        res.json(await testCaseService.update(getAuthUser(req), projectId, testCaseId, request));
    },

    async delete(req: Request, res: Response): Promise<void> {
        const { projectId, testCaseId } = parseRequest(testCaseIdParamsSchema, req.params);

        await testCaseService.delete(getAuthUser(req), projectId, testCaseId);
        res.status(204).end();
    },
};
