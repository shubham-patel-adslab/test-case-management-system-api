import { z } from 'zod';

import { userReferenceResponseSchema } from '../user/user.response.dto.js';

export const attachmentResponseSchema = z
    .object({
        id: z.number().int(),
        fileName: z.string(),
        // Detected from the content when uploaded.
        mimeType: z.string(),
        sizeBytes: z.number().int(),
        // The authorized download route (relative to the site): GET /api/projects/{projectId}/attachments/{id}.
        url: z.string(),
        uploadedBy: userReferenceResponseSchema.nullable(),
        createdAt: z.iso.datetime(),
    })
    .meta({ id: 'AttachmentResponse' });

export const attachmentListResponseSchema = z.array(attachmentResponseSchema);

export type AttachmentResponseDto = z.infer<typeof attachmentResponseSchema>;
