import { useState, useEffect } from 'react';
import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';

export interface UserSubscription {
  planId: string;
  subscriptionCancelAt?: string;
}

export interface UseUserSubscriptionReturn {
  subscription: UserSubscription | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useUserSubscription(): UseUserSubscriptionReturn {
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSubscription = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await authenticatedFetch(`${API_URL}/api/subscription/current-plan`);
      const data = await response.json();

      if (data.success) {
        setSubscription({
          planId: data.planId,
          subscriptionCancelAt: data.subscriptionCancelAt
        });
      } else {
        throw new Error(data.error || 'Failed to fetch subscription');
      }
    } catch (err) {
      console.error('[useUserSubscription] Failed to fetch subscription:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch subscription'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubscription();
  }, []);

  return {
    subscription,
    loading,
    error,
    refetch: fetchSubscription,
  };
}
