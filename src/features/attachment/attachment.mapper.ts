import { toUserReferenceResponseDto } from '../user/user.mapper.js';
import type { AttachmentRow } from './attachment.repository.js';
import type { AttachmentResponseDto } from './attachment.response.dto.js';

// The only place an attachment row becomes an API response. stored_name never leaves the server.
export function toAttachmentResponseDto(row: AttachmentRow): AttachmentResponseDto {
    return {
        id: row.id,
        fileName: row.original_name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        url: `/api/projects/${row.project_id}/attachments/${row.id}`,
        uploadedBy: toUserReferenceResponseDto(row.uploader_id, row.uploader_first_name, row.uploader_last_name),
        createdAt: row.created_at.toISOString(),
    };
}
