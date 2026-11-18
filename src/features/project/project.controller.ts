import type { Request, Response } from 'express';

import { CACHE_STATUS_HEADER } from '../../app/cache.js';
import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { parseRequest } from '../../shared/request/parse-request.js';
import { getAuthUser } from '../authentication/authentication.middleware.js';
import {
    projectCreateRequestSchema,
    projectIdParamsSchema,
    projectMemberCandidatePageRequestSchema,
    projectPageRequestSchema,
    projectUpdateRequestSchema,
} from './project.request.dto.js';
import { projectService } from './project.service.js';

// HTTP ↔ service mapping only: parse the request, call the service, choose the status code.
export const projectController = {
    async getPage(req: Request, res: Response): Promise<void> {
        const request = parseRequest(projectPageRequestSchema, req.query);

        res.json(await projectService.getPage(getAuthUser(req), request));
    },

    async getById(req: Request, res: Response): Promise<void> {
        const { projectId } = parseRequest(projectIdParamsSchema, req.params);

        const { value, cacheStatus } = await projectService.getById(getAuthUser(req), projectId);

        res.set(CACHE_STATUS_HEADER, cacheStatus).json(value);
    },

    async create(req: Request, res: Response): Promise<void> {
        const request = parseRequest(projectCreateRequestSchema, req.body);
        const project = await projectService.create(getAuthUser(req), request);

        res.status(201).location(`${req.baseUrl}/${project.id}`).json(project);
    },

    async update(req: Request, res: Response): Promise<void> {
        const { projectId } = parseRequest(projectIdParamsSchema, req.params);
        const request = parseRequest(projectUpdateRequestSchema, req.body);

        if (request.id !== projectId) {
            throw new AppError(400, ERROR_CODE.VALIDATION_ERROR, 'Request validation failed', {
                details: [{ field: 'id', message: 'Must match the project id in the URL' }],
            });
        }

        res.json(await projectService.update(getAuthUser(req), projectId, request));
    },

    async delete(req: Request, res: Response): Promise<void> {
        const { projectId } = parseRequest(projectIdParamsSchema, req.params);

        await projectService.delete(getAuthUser(req), projectId);
        res.status(204).end();
    },

    async getMemberCandidatePage(req: Request, res: Response): Promise<void> {
        const request = parseRequest(projectMemberCandidatePageRequestSchema, req.query);

        res.json(await projectService.getMemberCandidatePage(request));
    },
};
