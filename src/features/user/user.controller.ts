import type { Request, Response } from 'express';

import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { parseRequest } from '../../shared/request/parse-request.js';
import { getAuthUser } from '../authentication/authentication.middleware.js';
import {
    userCreateRequestSchema,
    userIdParamsSchema,
    userPageRequestSchema,
    userStatusUpdateRequestSchema,
    userUpdateRequestSchema,
} from './user.request.dto.js';
import { userService } from './user.service.js';

// HTTP ↔ service mapping only: parse the request, call the service, choose the status code.
export const userController = {
    async getPage(req: Request, res: Response): Promise<void> {
        const request = parseRequest(userPageRequestSchema, req.query);

        res.json(await userService.getPage(request));
    },

    async getById(req: Request, res: Response): Promise<void> {
        const { userId } = parseRequest(userIdParamsSchema, req.params);

        res.json(await userService.getById(userId));
    },

    async create(req: Request, res: Response): Promise<void> {
        const request = parseRequest(userCreateRequestSchema, req.body);
        const user = await userService.create(request, getAuthUser(req).id);

        res.status(201).location(`${req.baseUrl}/${user.id}`).json(user);
    },

    async update(req: Request, res: Response): Promise<void> {
        const { userId } = parseRequest(userIdParamsSchema, req.params);
        const request = parseRequest(userUpdateRequestSchema, req.body);

        if (request.id !== userId) {
            throw new AppError(400, ERROR_CODE.VALIDATION_ERROR, 'Request validation failed', {
                details: [{ field: 'id', message: 'Must match the user id in the URL' }],
            });
        }

        res.json(await userService.update(getAuthUser(req), userId, request));
    },

    async updateStatus(req: Request, res: Response): Promise<void> {
        const { userId } = parseRequest(userIdParamsSchema, req.params);
        const { status } = parseRequest(userStatusUpdateRequestSchema, req.body);

        res.json(await userService.updateStatus(getAuthUser(req), userId, status));
    },

    async resendInvitation(req: Request, res: Response): Promise<void> {
        const { userId } = parseRequest(userIdParamsSchema, req.params);

        await userService.resendInvitation(getAuthUser(req), userId);

        res.status(204).end();
    },
};
