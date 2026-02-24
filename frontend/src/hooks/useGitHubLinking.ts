import { useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { useIsBrowser } from './useIsBrowser';
import { openUrl } from '@tauri-apps/plugin-opener';
import { API_URL, USE_DEEP_LINK } from '@/config';

/**
 * Hook for linking GitHub account from anywhere in the app
 * Initiates OAuth flow - App.tsx handles the callback
 */
export function useGitHubLinking() {
  const setUser = useAppStore(state => state.setUser);
  const setSessionToken = useAppStore(state => state.setSessionToken);
  const isBrowser = useIsBrowser();
  const [isLinking, setIsLinking] = useState(false);
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [token, setToken] = useState('');
  const [tokenError, setTokenError] = useState('');


  let isDeepLinkCompatible = USE_DEEP_LINK;
  if (isBrowser) {
    isDeepLinkCompatible = false;
  }

  const linkGitHub = async () => {
    if (isLinking) return;

    setIsLinking(true);
    try {
      const params = new URLSearchParams();

      if (isBrowser) {
        params.set('redirect', '/app/auth');
      } else {
        if (isDeepLinkCompatible) {
          params.set('deep_link', 'true');
        } else {
          params.set('deep_link', 'false');
        }
      }

      const url = `${API_URL}/api/auth/sign-in/github?${params.toString()}`;
      const response = await fetch(url);

      // console.log('[GitHubLinking] Fetching OAuth URL:', url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.url) {
        if (isBrowser) {
          // In browser, redirect to OAuth (callback handled by App.tsx)
          window.location.href = data.url;
        } else {
          // In Tauri, open browser
          await openUrl(data.url);
          // If deep link is disabled, show token input immediately
          if (!isDeepLinkCompatible) {
            setShowTokenInput(true);
            setIsLinking(false);
          }
          // If deep link is enabled, the deep link handler will handle the callback
        }
      }
    } catch (error) {
      console.error('[GitHubLinking] Failed to initiate GitHub linking:', error);
      setIsLinking(false);
    }
  };

  const submitToken = async () => {
    if (!token.trim()) {
      setTokenError('Please enter a token');
      return;
    }

    setIsLinking(true);
    setTokenError('');

    try {
      const sessionResponse = await fetch(`${API_URL}/api/auth/session`, {
        headers: {
          'Authorization': `Bearer ${token.trim()}`
        }
      });

      if (sessionResponse.ok) {
        const session = await sessionResponse.json();
        if (session.user) {
          setUser(session.user);
          setSessionToken(token.trim());
          setShowTokenInput(false);
          setToken('');
          return;
        }
      }

      setTokenError('Invalid token. Please try again.');
    } catch (error) {
      console.error('[GitHubLinking] Token verification failed:', error);
      setTokenError('Failed to verify token. Please try again.');
    } finally {
      setIsLinking(false);
    }
  };

  const cancelTokenInput = () => {
    setShowTokenInput(false);
    setToken('');
    setTokenError('');
  };

  return {
    linkGitHub,
    isLinking,
    showTokenInput,
    token,
    setToken,
    tokenError,
    submitToken,
    cancelTokenInput,
  };
}
