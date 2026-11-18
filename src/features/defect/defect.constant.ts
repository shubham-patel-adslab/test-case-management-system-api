// Same values and limits as the defects constraints. UPPER_SNAKE_CASE in the database, TypeScript and JSON.
export const DEFECT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];

export const DEFECT_TITLE_MAX_LENGTH = 255;
export const DEFECT_DESCRIPTION_MAX_LENGTH = 5000;
