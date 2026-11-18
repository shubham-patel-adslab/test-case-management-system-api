import { z } from 'zod';

import { idParamSchema } from '../../shared/request/id.schema.js';
import { ATTACHMENT_FIELD_NAME } from './attachment.constant.js';

export const attachmentExecutionParamsSchema = z.object({
    projectId: idParamSchema,
    executionId: idParamSchema,
});

export const attachmentIdParamsSchema = z.object({
    projectId: idParamSchema,
    attachmentId: idParamSchema,
});

// For OpenAPI only: the body is parsed by multer, not zod.
export const attachmentUploadRequestSchema = z
    .object({ [ATTACHMENT_FIELD_NAME]: z.array(z.string().meta({ format: 'binary' })) })
    .meta({ id: 'AttachmentUploadRequest' });

// One uploaded file as the service receives it.
export type UploadedFile = {
    originalName: string;
    content: Buffer;
};
