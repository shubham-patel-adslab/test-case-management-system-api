import { z } from 'zod';

import { createPageResponseSchema, type PageResponseDto } from '../../shared/response/page.response.dto.js';
import { TEST_CASE_PRIORITIES, TEST_CASE_TYPES } from '../test-case/test-case.constant.js';

// A test case as listed inside a suite, at its position.
export const testSuiteCaseResponseSchema = z
    .object({
        // The test case's id.
        id: z.number().int(),
        // 1-based position in the suite, without gaps.
        order: z.number().int(),
        title: z.string(),
        priority: z.enum(TEST_CASE_PRIORITIES),
        type: z.enum(TEST_CASE_TYPES),
    })
    .meta({ id: 'TestSuiteCaseResponse' });

// One row of the suite list.
export const testSuiteSummaryResponseSchema = z
    .object({
        id: z.number().int(),
        projectId: z.number().int(),
        name: z.string(),
        description: z.string(),
        testCaseCount: z.number().int(),
        // The creator's user id; null once that user row is removed.
        createdBy: z.uuid().nullable(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
    })
    .meta({ id: 'TestSuiteSummaryResponse' });

export const testSuiteDetailsResponseSchema = testSuiteSummaryResponseSchema
    .extend({ testCases: z.array(testSuiteCaseResponseSchema) })
    .meta({ id: 'TestSuiteDetailsResponse' });

export const testSuitePageResponseSchema = createPageResponseSchema(testSuiteSummaryResponseSchema)
    .meta({ id: 'TestSuitePageResponse' });

export type TestSuiteCaseResponseDto = z.infer<typeof testSuiteCaseResponseSchema>;
export type TestSuiteSummaryResponseDto = z.infer<typeof testSuiteSummaryResponseSchema>;
export type TestSuiteDetailsResponseDto = z.infer<typeof testSuiteDetailsResponseSchema>;
export type TestSuitePageResponseDto = PageResponseDto<TestSuiteSummaryResponseDto>;
