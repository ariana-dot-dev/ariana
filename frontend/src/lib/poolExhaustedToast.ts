/**
 * Common utility for showing machine pool exhaustion toast notification.
 * Centralized so the message can be updated in one place.
 */

export interface ToastFunction {
  (props: {
    title: string;
    description: string;
    variant?: 'default' | 'destructive';
    duration?: number;
  }): void;
}

export function showPoolExhaustedToast(toast: ToastFunction): void {
  toast({
    title: "Server at Capacity",
    description: "All machines are currently in use. Please try again in a few minutes. Your usage quota was not affected.",
    variant: "default",
    duration: 6000
  });
}
