import type { Request, Response } from 'express';

import { parseRequest } from '../../shared/request/parse-request.js';
import { getAuthUser } from '../authentication/authentication.middleware.js';
import { attachmentExecutionParamsSchema, attachmentIdParamsSchema } from './attachment.request.dto.js';
import { attachmentService } from './attachment.service.js';

// HTTP ↔ service mapping only. Path ids come from the parent path (routers are created with mergeParams).
export const attachmentController = {
    // req.files is set by receiveAttachmentFiles (multer).
    async upload(req: Request, res: Response): Promise<void> {
        const { projectId, executionId } = parseRequest(attachmentExecutionParamsSchema, req.params);
        const files = Array.isArray(req.files) ? req.files : [];
        const uploaded = files.map((file) => ({ originalName: file.originalname, content: file.buffer }));

        res.status(201).json(await attachmentService.upload(getAuthUser(req), projectId, executionId, uploaded));
    },

    // Always a download (Content-Disposition: attachment), with the type detected at upload, never rendered
    // inline by the browser (helmet's X-Content-Type-Options: nosniff stops it guessing another type).
    // private, no-store: an authorized file must not sit in a shared cache.
    async download(req: Request, res: Response): Promise<void> {
        const { projectId, attachmentId } = parseRequest(attachmentIdParamsSchema, req.params);
        const download = await attachmentService.getDownload(getAuthUser(req), projectId, attachmentId);

        res.attachment(download.fileName);
        res.type(download.mimeType);
        res.set('Cache-Control', 'private, no-store');

        await new Promise<void>((resolve, reject) => {
            res.sendFile(download.storedName, { root: download.root }, (error) => (error ? reject(error) : resolve()));
        });
    },
};
