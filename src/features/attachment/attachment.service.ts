import path from 'node:path';

import { withTransaction } from '../../app/database.js';
import { createStoredName, deleteFile, saveFile, storedFileLocation } from '../../app/file-storage.js';
import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import type { AuthUser } from '../authentication/authentication.middleware.js';
import { projectService } from '../project/project.service.js';
import { EXECUTION_AUDIT_ACTION, EXECUTION_STATUS } from '../test-execution/test-execution.constant.js';
import { testExecutionRepository } from '../test-execution/test-execution.repository.js';
import { ATTACHMENT_FIELD_NAME, ATTACHMENT_NAME_MAX_LENGTH } from './attachment.constant.js';
import { detectAllowedMimeType } from './attachment.file-type.js';
import { toAttachmentResponseDto } from './attachment.mapper.js';
import { attachmentRepository, type AttachmentFields } from './attachment.repository.js';
import type { UploadedFile } from './attachment.request.dto.js';
import type { AttachmentResponseDto } from './attachment.response.dto.js';

const FALLBACK_FILE_NAME = 'file';
const UNSUPPORTED_TYPE_MESSAGE = 'Unsupported file type: allowed are PNG, JPEG, GIF, PDF and text (.txt, .log, .csv)';

// The client's file name is only for display and the download's Content-Disposition: no directories, no
// control characters, at most 255 characters (keeping the extension).
function toDisplayName(originalName: string): string {
    const baseName = (originalName.split(/[\\/]/).pop() ?? '').replace(/\p{Cc}/gu, '').trim() || FALLBACK_FILE_NAME;

    if (baseName.length <= ATTACHMENT_NAME_MAX_LENGTH) {
        return baseName;
    }

    const extension = path.extname(baseName).slice(0, ATTACHMENT_NAME_MAX_LENGTH);

    return baseName.slice(0, ATTACHMENT_NAME_MAX_LENGTH - extension.length) + extension;
}

function validationError(details: { field: string; message: string }[]): AppError {
    return new AppError(400, ERROR_CODE.VALIDATION_ERROR, 'Request validation failed', { details });
}

// What the download route serves.
export type AttachmentDownload = {
    fileName: string;
    mimeType: string;
    root: string;
    storedName: string;
};

// PRD "Add comments and attachments to test runs" + "Secure file upload for test attachments".
export const attachmentService = {
    // All-or-nothing: every file must be an allowed type (400 on files[i], nothing saved). Only on a recorded
    // execution (attachments document what happened). Files are written before the rows; if anything after
    // that fails, the written files are removed again, so a failed upload leaves nothing behind.
    async upload(authUser: AuthUser, projectId: number, executionId: number, files: UploadedFile[]): Promise<AttachmentResponseDto[]> {
        if (files.length === 0) {
            throw validationError([{ field: ATTACHMENT_FIELD_NAME, message: 'Attach at least one file' }]);
        }

        return withTransaction(async (client) => {
            await projectService.assertWritable(authUser, projectId, client);

            const execution = await testExecutionRepository.selectById(projectId, executionId, client);

            if (!execution) {
                throw new AppError(404, ERROR_CODE.NOT_FOUND, 'Test execution not found');
            }

            if (execution.status === EXECUTION_STATUS.PENDING) {
                throw new AppError(409, ERROR_CODE.CONFLICT, 'Attachments can be added once the result is recorded');
            }

            // Every file checked before anything is written.
            const accepted: { content: Buffer; fields: AttachmentFields }[] = [];
            const details: { field: string; message: string }[] = [];

            for (const [index, file] of files.entries()) {
                const mimeType = await detectAllowedMimeType(file.content, file.originalName);

                if (mimeType === undefined) {
                    details.push({ field: `${ATTACHMENT_FIELD_NAME}[${index}]`, message: UNSUPPORTED_TYPE_MESSAGE });
                } else {
                    const fields = { originalName: toDisplayName(file.originalName), storedName: createStoredName(), mimeType, sizeBytes: file.content.length };

                    accepted.push({ content: file.content, fields });
                }
            }

            if (details.length > 0) {
                throw validationError(details);
            }

            const fields = accepted.map((file) => file.fields);
            const saved: string[] = [];

            try {
                for (const file of accepted) {
                    await saveFile(file.fields.storedName, file.content);
                    saved.push(file.fields.storedName);
                }

                const attachmentIds = await attachmentRepository.insertMany(executionId, fields, authUser.id, client);

                await testExecutionRepository.insertAuditLogs(
                    [executionId],
                    EXECUTION_AUDIT_ACTION.ATTACHMENT_ADDED,
                    authUser.id,
                    { attachmentIds, fileNames: fields.map((field) => field.originalName) },
                    client,
                );

                const created = new Set(attachmentIds);

                return (await attachmentRepository.selectByExecution(executionId, client))
                    .filter((row) => created.has(row.id))
                    .map(toAttachmentResponseDto);
            } catch (error) {
                await Promise.all(saved.map((storedName) => deleteFile(storedName)));

                throw error;
            }
        });
    },

    // Authorized download: the caller must reach the execution's project (404 otherwise, as everywhere).
    async getDownload(authUser: AuthUser, projectId: number, attachmentId: number): Promise<AttachmentDownload> {
        await projectService.assertReadable(authUser, projectId);

        const row = await attachmentRepository.selectByIdInProject(projectId, attachmentId);

        if (!row) {
            throw new AppError(404, ERROR_CODE.NOT_FOUND, 'Attachment not found');
        }

        const { root, fileName } = storedFileLocation(row.stored_name);

        return { fileName: row.original_name, mimeType: row.mime_type, root, storedName: fileName };
    },
};
