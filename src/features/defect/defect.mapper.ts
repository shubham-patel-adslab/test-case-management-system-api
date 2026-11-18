import { toUserReferenceResponseDto } from '../user/user.mapper.js';
import type { DefectRow } from './defect.repository.js';
import type { DefectDetailsResponseDto } from './defect.response.dto.js';

// The only place a defect row becomes an API response.
export function toDefectDetailsResponseDto(row: DefectRow): DefectDetailsResponseDto {
    return {
        id: row.id,
        projectId: row.project_id,
        executionId: row.test_execution_id,
        title: row.title,
        description: row.description,
        severity: row.severity,
        createdBy: toUserReferenceResponseDto(row.creator_id, row.creator_first_name, row.creator_last_name),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}
