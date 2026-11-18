// api-requirements §8 (matches the UI's client-side check): ≤ 10 MB per file, same limit as the attachments
// table's ck_attachments_size_bytes.
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
// Files per upload request. With in-memory parsing a request holds at most this × 10 MB.
export const ATTACHMENT_MAX_FILES = 5;
// The multipart field the UI sends files in (ui-requirements §6.3).
export const ATTACHMENT_FIELD_NAME = 'files';
// attachments.original_name.
export const ATTACHMENT_NAME_MAX_LENGTH = 255;

// Allowed binary types, as detected from the file's content (magic bytes) — never from the client's
// Content-Type or file name.
export const ATTACHMENT_BINARY_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'application/pdf'] as const;

// Text formats have no magic bytes: allowed by extension, but only if the content really is text (UTF-8, no
// NUL bytes). Extension → the type the file is served with.
export const ATTACHMENT_TEXT_TYPES: Readonly<Record<string, string>> = {
    '.txt': 'text/plain',
    '.log': 'text/plain',
    '.csv': 'text/csv',
};
