import posthog from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST;

export function initializePostHog() {
  // Don't initialize PostHog on localhost
  const isLocalhost = window.location.hostname === 'localhost' ||
                      window.location.hostname === '127.0.0.1' ||
                      window.location.hostname.includes('localhost');

  if (isLocalhost) {
    if (import.meta.env.DEV) {
      console.log('[PostHog] Skipping initialization on localhost');
    }
    return;
  }

  if (POSTHOG_KEY && POSTHOG_HOST) {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      autocapture: false, // Disable autocapture, use manual events
      capture_pageview: false, // Manual pageview tracking
      persistence: 'localStorage',
      session_recording: {
        recordCrossOriginIframes: false,
      },
      loaded: (posthog) => {
        if (import.meta.env.DEV) {
          console.log('[PostHog] Initialized successfully');
        }
      },
    });
  } else {
    console.warn('[PostHog] Missing POSTHOG_KEY or POSTHOG_HOST environment variables');
  }
}

export { posthog };
