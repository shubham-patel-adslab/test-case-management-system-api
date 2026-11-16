import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { toPageResponseDto } from '../../shared/response/page.response.dto.js';
import { toProjectDetailsResponseDto } from './project.mapper.js';
import { projectRepository } from './project.repository.js';
import type { ProjectCreateRequestDto, ProjectPageRequestDto, ProjectUpdateRequestDto } from './project.request.dto.js';
import type { ProjectDetailsResponseDto, ProjectPageResponseDto } from './project.response.dto.js';

function projectNotFound(): AppError {
    return new AppError(404, ERROR_CODE.NOT_FOUND, 'Project not found');
}

export const projectService = {
    async getPage(request: ProjectPageRequestDto): Promise<ProjectPageResponseDto> {
        const offset = (request.page - 1) * request.pageSize;

        const [rows, totalItems] = await Promise.all([
            projectRepository.selectPage(request.pageSize, offset),
            projectRepository.countAll(),
        ]);

        return toPageResponseDto(rows.map(toProjectDetailsResponseDto), request, totalItems);
    },

    async getById(projectId: number): Promise<ProjectDetailsResponseDto> {
        const row = await projectRepository.selectById(projectId);

        if (!row) {
            throw projectNotFound();
        }

        return toProjectDetailsResponseDto(row);
    },

    async create(request: ProjectCreateRequestDto): Promise<ProjectDetailsResponseDto> {
        const row = await projectRepository.insert(request);

        return toProjectDetailsResponseDto(row);
    },

    async update(projectId: number, request: ProjectUpdateRequestDto): Promise<ProjectDetailsResponseDto> {
        const row = await projectRepository.updateById(projectId, request);

        if (!row) {
            throw projectNotFound();
        }

        return toProjectDetailsResponseDto(row);
    },
};
