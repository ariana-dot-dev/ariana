import { toast } from '@/hooks/use-toast';
import type { LimitExceededInfo, LimitExceededResponse } from '@/types/UsageLimits';

export interface LimitHandlerCallbacks {
  onMonthlyAgentLimit: (limitInfo: LimitExceededInfo) => void;
}

/**
 * Checks if a response is a limit exceeded error
 */
export function isLimitExceededResponse(response: any): response is LimitExceededResponse {
  return (
    response &&
    response.success === false &&
    response.code === 'LIMIT_EXCEEDED' &&
    response.limitInfo !== undefined
  );
}

/**
 * Handles limit exceeded errors by showing appropriate feedback
 * - Monthly agent limits: Triggers dialog callback
 * - All other limits: Shows toast notification
 */
export function handleLimitExceeded(
  limitInfo: LimitExceededInfo,
  callbacks: LimitHandlerCallbacks
): void {
  console.log('[LimitHandler] handleLimitExceeded called with:', limitInfo);
  console.log('[LimitHandler] Callbacks object:', callbacks);

  // Check if this is a monthly agent limit - should show dialog
  // Use isMonthlyLimit flag which is explicitly provided by backend
  if (limitInfo.resourceType === 'agent' && limitInfo.isMonthlyLimit) {
    console.log('[LimitHandler] Monthly agent limit detected, calling onMonthlyAgentLimit callback');
    callbacks.onMonthlyAgentLimit(limitInfo);
    return;
  }

  console.log('[LimitHandler] Not a monthly agent limit, showing toast instead');
  // For all other limits, show toast
  showLimitToast(limitInfo);
}

/**
 * Shows a toast notification for limit exceeded errors
 */
export function showLimitToast(limitInfo: LimitExceededInfo): void {
  const resourceName = getResourceName(limitInfo.resourceType);
  const limitDescription = getLimitDescription(limitInfo);
  const resetMessage = getResetMessage(limitInfo.limitType);

  toast({
    title: 'Usage Limit Reached',
    description: `${limitDescription}${resetMessage ? ` ${resetMessage}` : ''}`,
    variant: 'destructive',
  });
}

/**
 * Processes API response and handles limit errors
 * Returns true if limit was exceeded, false otherwise
 */
export async function processApiResponse(
  response: Response,
  callbacks: LimitHandlerCallbacks
): Promise<boolean> {
  if (response.status === 429) {
    try {
      console.log('[LimitHandler] Processing 429 response');
      const data = await response.json();
      console.log('[LimitHandler] Parsed response data:', data);
      if (isLimitExceededResponse(data)) {
        console.log('[LimitHandler] Valid limit exceeded response, calling handleLimitExceeded');
        handleLimitExceeded(data.limitInfo, callbacks);
        return true;
      } else {
        console.warn('[LimitHandler] 429 response does not match limit exceeded format:', data);
      }
    } catch (error) {
      console.error('[LimitHandler] Failed to parse limit exceeded response:', error);
    }
  }
  return false;
}

// Helper functions

function getResourceName(resourceType: string): string {
  switch (resourceType) {
    case 'agent':
      return 'agents';
    case 'project':
      return 'projects';
    case 'specification':
      return 'specifications';
    case 'prompt':
      return 'prompts';
    default:
      return 'resources';
  }
}

function getLimitDescription(limitInfo: LimitExceededInfo): string {
  const resourceName = getResourceName(limitInfo.resourceType);
  const { current, max, limitType } = limitInfo;

  if (limitType === 'per_month') {
    return `Monthly limit reached: ${current}/${max} ${resourceName}.`;
  } else if (limitType === 'total') {
    return `Total limit reached: ${current}/${max} ${resourceName}.`;
  } else if (limitType === 'per_day') {
    return `Daily limit reached: ${current}/${max} ${resourceName}.`;
  } else if (limitType === 'per_minute') {
    return `Rate limit reached: ${current}/${max} ${resourceName} per minute.`;
  }

  return `Rate limit of ${current}/${max} ${limitType} reached for ${resourceName}.`;
}

function getResetMessage(limitType: string): string {
  switch (limitType) {
    case 'minute':
      return 'Wait a minute before trying again.';
    case 'day':
      return 'Limit will reset in 24 hours.';
    case 'month':
      return 'Limit will reset next month.';
    case 'total':
      return 'Consider linking a GitHub account for higher limits.';
    default:
      return '';
  }
}
