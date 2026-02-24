/**
 * GitHub access level types
 * Used across frontend and backend to represent repository access permissions
 */

export type AccessLevel = 'none' | 'read' | 'write';

export interface CheckAccessResult {
  success: boolean;
  accessLevel: AccessLevel;
  repositoryFullName: string | null;
  repositoryId?: string;
  merged?: boolean;
  newProjectId?: string;
}
