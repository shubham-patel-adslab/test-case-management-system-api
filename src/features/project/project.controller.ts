import type { Request, Response } from 'express';

import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { parseRequest } from '../../shared/request/parse-request.js';
import {
    projectCreateRequestSchema,
    projectIdParamsSchema,
    projectPageRequestSchema,
    projectUpdateRequestSchema,
} from './project.request.dto.js';
import { projectService } from './project.service.js';

// HTTP ↔ service mapping only: parse the request, call the service, choose the status code.
export const projectController = {
    async getPage(req: Request, res: Response): Promise<void> {
        const request = parseRequest(projectPageRequestSchema, req.query);

        res.json(await projectService.getPage(request));
    },

    async getById(req: Request, res: Response): Promise<void> {
        const { projectId } = parseRequest(projectIdParamsSchema, req.params);

        res.json(await projectService.getById(projectId));
    },

    async create(req: Request, res: Response): Promise<void> {
        const request = parseRequest(projectCreateRequestSchema, req.body);
        const project = await projectService.create(request);

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

        res.json(await projectService.update(projectId, request));
    },
};
