export type ResourceType = 'project' | 'agent' | 'specification' | 'prompt';
export type LimitType = 'per_minute' | 'per_day' | 'per_month' | 'total';

export interface LimitExceededInfo {
  resourceType: ResourceType;
  limitType: LimitType;
  current: number;
  max: number;
  isMonthlyLimit: boolean;
  message?: string;
}

export interface LimitExceededResponse {
  success: false;
  error: string;
  code: 'LIMIT_EXCEEDED';
  limitInfo: LimitExceededInfo;
}
