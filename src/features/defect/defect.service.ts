import { CACHE_POLICY, withProjectWrite } from '../../app/cache.js';
import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import type { AuthUser } from '../authentication/authentication.middleware.js';
import { projectService } from '../project/project.service.js';
import { EXECUTION_AUDIT_ACTION, EXECUTION_STATUS } from '../test-execution/test-execution.constant.js';
import { testExecutionRepository } from '../test-execution/test-execution.repository.js';
import { toDefectDetailsResponseDto } from './defect.mapper.js';
import { defectRepository } from './defect.repository.js';
import type { DefectCreateRequestDto } from './defect.request.dto.js';
import type { DefectDetailsResponseDto } from './defect.response.dto.js';

// Defects are counted on the dashboard.
const DEFECT_CACHES = [CACHE_POLICY.ANALYTICS];

// PRD Features §4 "Create defects/bugs directly from failed tests".
export const defectService = {
    // Only from a FAIL (a recorded result never changes, so no lock is needed to keep it FAIL), one per
    // execution (atomic ON CONFLICT). The defect and its audit entry are one transaction.
    async create(authUser: AuthUser, projectId: number, executionId: number, request: DefectCreateRequestDto): Promise<DefectDetailsResponseDto> {
        return withProjectWrite(projectId, DEFECT_CACHES, async (client) => {
            await projectService.assertWritable(authUser, projectId, client);

            const execution = await testExecutionRepository.selectById(projectId, executionId, client);

            if (!execution) {
                throw new AppError(404, ERROR_CODE.NOT_FOUND, 'Test execution not found');
            }

            if (execution.status !== EXECUTION_STATUS.FAIL) {
                throw new AppError(409, ERROR_CODE.CONFLICT, 'A defect can only be created from a failed execution');
            }

            const defectId = await defectRepository.insert(projectId, executionId, request, authUser.id, client);

            if (defectId === undefined) {
                throw new AppError(409, ERROR_CODE.CONFLICT, 'This execution already has a defect');
            }

            await testExecutionRepository.insertAuditLogs([executionId], EXECUTION_AUDIT_ACTION.DEFECT_CREATED, authUser.id, { defectId }, client);

            const defect = await defectRepository.selectByExecution(executionId, client);

            if (!defect) {
                throw new Error(`Defect ${defectId} missing right after its insert`);
            }

            return toDefectDetailsResponseDto(defect);
        });
    },
};
