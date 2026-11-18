import type { RequestHandler } from 'express';
import multer from 'multer';

import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { ATTACHMENT_FIELD_NAME, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES } from './attachment.constant.js';

// multipart/form-data parsing for attachment uploads. In memory: the content must be inspected (type
// detection) before anything is written, and the limits cap a request at ATTACHMENT_MAX_FILES × 10 MB.
// multer stops reading as soon as a limit is hit. defParamCharset utf8: browsers send UTF-8 file names
// (multer's default, latin1, garbles "résumé.pdf").
const parseFiles = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ATTACHMENT_MAX_BYTES, files: ATTACHMENT_MAX_FILES, fields: 0 },
    defParamCharset: 'utf8',
}).array(ATTACHMENT_FIELD_NAME, ATTACHMENT_MAX_FILES);

// multer's errors in the API's error envelope: too large → 413, anything else about the form → 400.
function toUploadError(error: unknown): unknown {
    if (!(error instanceof multer.MulterError)) {
        return error;
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
        return new AppError(413, ERROR_CODE.PAYLOAD_TOO_LARGE, 'A file is larger than 10 MB', {
            details: [{ field: ATTACHMENT_FIELD_NAME, message: 'Each file must be at most 10 MB' }],
            cause: error,
        });
    }

    return new AppError(400, ERROR_CODE.VALIDATION_ERROR, 'Request validation failed', {
        details: [{ field: ATTACHMENT_FIELD_NAME, message: `Send 1–${ATTACHMENT_MAX_FILES} files in the "${ATTACHMENT_FIELD_NAME}" field only` }],
        cause: error,
    });
}

// Sets req.files. Runs after authorize, so files are only read for callers allowed to upload at all.
export const receiveAttachmentFiles: RequestHandler = (req, res, next) => {
    parseFiles(req, res, (error?: unknown) => next(error === undefined ? undefined : toUploadError(error)));
};
