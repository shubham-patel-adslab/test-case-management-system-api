import type { Request, Response } from 'express';

import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { parseRequest } from '../../shared/request/parse-request.js';
import { getAuthUser } from '../authentication/authentication.middleware.js';
import {
    testSuiteCaseParamsSchema,
    testSuiteCasesAddRequestSchema,
    testSuiteCasesReorderRequestSchema,
    testSuiteCreateRequestSchema,
    testSuiteIdParamsSchema,
    testSuitePageRequestSchema,
    testSuiteProjectParamsSchema,
    testSuiteUpdateRequestSchema,
} from './test-suite.request.dto.js';
import { testSuiteService } from './test-suite.service.js';

// HTTP ↔ service mapping only: parse the request, call the service, choose the status code. `projectId`
// comes from the parent path (the router is created with mergeParams).
export const testSuiteController = {
    async getPage(req: Request, res: Response): Promise<void> {
        const { projectId } = parseRequest(testSuiteProjectParamsSchema, req.params);
        const request = parseRequest(testSuitePageRequestSchema, req.query);

        res.json(await testSuiteService.getPage(getAuthUser(req), projectId, request));
    },

    async getById(req: Request, res: Response): Promise<void> {
        const { projectId, suiteId } = parseRequest(testSuiteIdParamsSchema, req.params);

        res.json(await testSuiteService.getById(getAuthUser(req), projectId, suiteId));
    },

    async create(req: Request, res: Response): Promise<void> {
        const { projectId } = parseRequest(testSuiteProjectParamsSchema, req.params);
        const request = parseRequest(testSuiteCreateRequestSchema, req.body);
        const suite = await testSuiteService.create(getAuthUser(req), projectId, request);

        res.status(201).location(`${req.baseUrl}/${suite.id}`).json(suite);
    },

    async update(req: Request, res: Response): Promise<void> {
        const { projectId, suiteId } = parseRequest(testSuiteIdParamsSchema, req.params);
        const request = parseRequest(testSuiteUpdateRequestSchema, req.body);

        if (request.id !== suiteId) {
            throw new AppError(400, ERROR_CODE.VALIDATION_ERROR, 'Request validation failed', {
                details: [{ field: 'id', message: 'Must match the test suite id in the URL' }],
            });
        }

        res.json(await testSuiteService.update(getAuthUser(req), projectId, suiteId, request));
    },

    async delete(req: Request, res: Response): Promise<void> {
        const { projectId, suiteId } = parseRequest(testSuiteIdParamsSchema, req.params);

        await testSuiteService.delete(getAuthUser(req), projectId, suiteId);
        res.status(204).end();
    },

    async addTestCases(req: Request, res: Response): Promise<void> {
        const { projectId, suiteId } = parseRequest(testSuiteIdParamsSchema, req.params);
        const request = parseRequest(testSuiteCasesAddRequestSchema, req.body);

        res.json(await testSuiteService.addTestCases(getAuthUser(req), projectId, suiteId, request));
    },

    async removeTestCase(req: Request, res: Response): Promise<void> {
        const { projectId, suiteId, testCaseId } = parseRequest(testSuiteCaseParamsSchema, req.params);

        await testSuiteService.removeTestCase(getAuthUser(req), projectId, suiteId, testCaseId);
        res.status(204).end();
    },

    async reorderTestCases(req: Request, res: Response): Promise<void> {
        const { projectId, suiteId } = parseRequest(testSuiteIdParamsSchema, req.params);
        const request = parseRequest(testSuiteCasesReorderRequestSchema, req.body);

        res.json(await testSuiteService.reorderTestCases(getAuthUser(req), projectId, suiteId, request));
    },
};
