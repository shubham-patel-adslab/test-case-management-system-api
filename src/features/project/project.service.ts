import { isForeignKeyViolation, withTransaction, type Queryable } from '../../app/database.js';
import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { toPageResponseDto } from '../../shared/response/page.response.dto.js';
import type { AuthUser } from '../authentication/authentication.middleware.js';
import { PERMISSION_CODE, RESOURCE_CODE, type PermissionCode } from '../authorization/authorization.constant.js';
import { authorizationService } from '../authorization/authorization.service.js';
import { USER_STATUS } from '../user/user.constant.js';
import { userRepository } from '../user/user.repository.js';
import type { UserSort } from '../user/user.request.dto.js';
import { toProjectDetailsResponseDto, toProjectMemberResponseDto } from './project.mapper.js';
import { PROJECT_CONTENT_FOREIGN_KEYS, projectRepository, type ProjectRow, type ProjectScope } from './project.repository.js';
import type {
    ProjectCreateRequestDto,
    ProjectMemberCandidatePageRequestDto,
    ProjectPageRequestDto,
    ProjectUpdateRequestDto,
} from './project.request.dto.js';
import type {
    ProjectDetailsResponseDto,
    ProjectMemberCandidatePageResponseDto,
    ProjectPageResponseDto,
} from './project.response.dto.js';

// Users who can be added to a team. INVITED users can: they join the project before their first sign-in.
const MEMBER_CANDIDATE_STATUSES = [USER_STATUS.ACTIVE, USER_STATUS.INVITED];
// The picker lists people by name, so the one you're looking for is easy to find.
const MEMBER_CANDIDATE_SORT: UserSort = { field: 'name', direction: 'asc' };

// A project outside the caller's scope is a 404 like a missing one, so non-members can't probe which
// project ids exist.
function projectNotFound(): AppError {
    return new AppError(404, ERROR_CODE.NOT_FOUND, 'Project not found');
}

// The route already checked the PROJECT permission (may the role do this at all?). This decides on which
// projects: every project with the matching ALL_PROJECTS grant, otherwise only the caller's own.
async function scopeOf(authUser: AuthUser, permission: PermissionCode): Promise<ProjectScope> {
    const isUnscoped = await authorizationService.hasPermission(authUser.id, RESOURCE_CODE.ALL_PROJECTS, permission);

    return isUnscoped ? null : authUser.id;
}

// Sets the whole team. A scoped caller is always kept on it: creating or editing a project can't lock
// them out of it. Unknown or (newly added) inactive users are a 400 on the exact memberIds[i].
async function setMembers(projectId: number, memberIds: string[], scope: ProjectScope, actor: AuthUser, db: Queryable): Promise<void> {
    const assignable = new Set(await projectRepository.selectAssignableUserIds(projectId, memberIds, db));
    const details = memberIds.flatMap((userId, index) =>
        assignable.has(userId) ? [] : [{ field: `memberIds[${index}]`, message: 'Unknown or inactive user' }],
    );

    if (details.length > 0) {
        throw new AppError(400, ERROR_CODE.VALIDATION_ERROR, 'Request validation failed', { details });
    }

    const team = scope === null || memberIds.includes(scope) ? memberIds : [...memberIds, scope];

    await projectRepository.replaceMembers(projectId, team, actor.id, db);
}

async function toDetails(row: ProjectRow, db?: Queryable): Promise<ProjectDetailsResponseDto> {
    return toProjectDetailsResponseDto(row, await projectRepository.selectMembers([row.id], db));
}

export const projectService = {
    async getPage(authUser: AuthUser, request: ProjectPageRequestDto): Promise<ProjectPageResponseDto> {
        const scope = await scopeOf(authUser, PERMISSION_CODE.READ);
        const offset = (request.page - 1) * request.pageSize;

        const [rows, totalItems] = await Promise.all([
            projectRepository.selectPage(scope, request.sort, request.pageSize, offset),
            projectRepository.count(scope),
        ]);

        // Two queries per page, however many projects it holds.
        const membersByProjectId = Map.groupBy(
            await projectRepository.selectMembers(rows.map((row) => row.id)),
            (member) => member.project_id,
        );
        const items = rows.map((row) => toProjectDetailsResponseDto(row, membersByProjectId.get(row.id) ?? []));

        return toPageResponseDto(items, request, totalItems);
    },

    async getById(authUser: AuthUser, projectId: number): Promise<ProjectDetailsResponseDto> {
        const row = await projectRepository.selectById(projectId, await scopeOf(authUser, PERMISSION_CODE.READ));

        if (!row) {
            throw projectNotFound();
        }

        return toDetails(row);
    },

    // The project and its team in one transaction: an invalid member id leaves no half-created project.
    // The creator's READ scope decides whether they must join the team to see the project afterwards.
    async create(authUser: AuthUser, request: ProjectCreateRequestDto): Promise<ProjectDetailsResponseDto> {
        const scope = await scopeOf(authUser, PERMISSION_CODE.READ);

        return withTransaction(async (client) => {
            const row = await projectRepository.insert(request, authUser.id, client);

            await setMembers(row.id, request.memberIds, scope, authUser, client);

            return toDetails(row, client);
        });
    },

    async update(authUser: AuthUser, projectId: number, request: ProjectUpdateRequestDto): Promise<ProjectDetailsResponseDto> {
        const scope = await scopeOf(authUser, PERMISSION_CODE.UPDATE);

        return withTransaction(async (client) => {
            const row = await projectRepository.updateById(projectId, request, scope, client);

            if (!row) {
                throw projectNotFound();
            }

            await setMembers(projectId, request.memberIds, scope, authUser, client);

            return toDetails(row, client);
        });
    },

    // The database refuses to delete a project that still has test cases, suites or execution history (ON
    // DELETE RESTRICT), so a delete can't silently wipe them; checking in the same statement leaves no
    // check-then-delete race. A project with execution history can only be archived (status ARCHIVED).
    async delete(authUser: AuthUser, projectId: number): Promise<void> {
        const scope = await scopeOf(authUser, PERMISSION_CODE.DELETE);
        let isDeleted: boolean;

        try {
            isDeleted = await projectRepository.deleteById(projectId, scope);
        } catch (error) {
            if (isForeignKeyViolation(error, PROJECT_CONTENT_FOREIGN_KEYS)) {
                throw new AppError(409, ERROR_CODE.CONFLICT, 'The project has test cases, test suites or execution history. Delete its test cases and suites first; a project with execution history can only be archived', { cause: error });
            }

            throw error;
        }

        if (!isDeleted) {
            throw projectNotFound();
        }
    },

    // The projects the caller may read: null = every project, else only their own. For queries across
    // projects (analytics) that filter by scope in SQL.
    async getReadScope(authUser: AuthUser): Promise<ProjectScope> {
        return scopeOf(authUser, PERMISSION_CODE.READ);
    },

    // Whether a given user (not necessarily the caller) may act on the project with `permission` — e.g.
    // whether a test case can be assigned to them.
    async canAccess(userId: string, projectId: number, permission: PermissionCode): Promise<boolean> {
        return projectRepository.existsInScope(projectId, await scopeOf({ id: userId }, permission));
    },

    // Gates for features inside a project (test cases, suites). 404 unless the project exists and the caller
    // may act on it: every project with the matching ALL_PROJECTS grant, otherwise only their own. The
    // route has already checked the feature's own permission (e.g. TEST_CASE READ).
    async assertReadable(authUser: AuthUser, projectId: number): Promise<void> {
        if (!(await projectRepository.existsInScope(projectId, await scopeOf(authUser, PERMISSION_CODE.READ)))) {
            throw projectNotFound();
        }
    },

    // Changing a project's content is acting on the project, so the scope is ALL_PROJECTS UPDATE. Call it
    // first inside the write's transaction: it locks the project row so it can't be deleted halfway.
    async assertWritable(authUser: AuthUser, projectId: number, client: Queryable): Promise<void> {
        const scope = await scopeOf(authUser, PERMISSION_CODE.UPDATE);

        if (!(await projectRepository.existsInScope(projectId, scope, client, true))) {
            throw projectNotFound();
        }
    },

    // The member picker. Not scoped to a project: it serves the create form too, before a project exists.
    async getMemberCandidatePage(request: ProjectMemberCandidatePageRequestDto): Promise<ProjectMemberCandidatePageResponseDto> {
        const filter = { search: request.search, statuses: MEMBER_CANDIDATE_STATUSES };
        const offset = (request.page - 1) * request.pageSize;

        const [rows, totalItems] = await Promise.all([
            userRepository.selectPage(filter, MEMBER_CANDIDATE_SORT, request.pageSize, offset),
            userRepository.count(filter),
        ]);

        return toPageResponseDto(rows.map(toProjectMemberResponseDto), request, totalItems);
    },
};
