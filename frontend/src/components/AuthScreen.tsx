import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Github, Loader2 } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { API_URL, USE_DEEP_LINK } from '@/config';
import { initializeDeepLinkHandler } from '@/lib/deepLinkHandler';
import { useAppStore } from '@/stores/useAppStore';
import Logo from '@/components/ui/logo';
import { useIsBrowser } from '@/hooks/useIsBrowser';
import { completeGitHubLogin } from '@/lib/auth';
import GithubLogo from './ui/icons/GithubLogo';
import Background from './ui/BackgroundNew';
import { cn } from '@/lib/utils';

export function AuthScreen() {
  const setUser = useAppStore(state => state.setUser);
  const setSessionToken = useAppStore(state => state.setSessionToken);
  const isBrowser = useIsBrowser();

  const [githubLoading, setGithubLoading] = useState(false);
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [token, setToken] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [waitingForDeepLink, setWaitingForDeepLink] = useState(false);

  const [currentBg, setCurrentBg] = useState(Math.round(Math.random() * 11));
  const [previousBg, setPreviousBg] = useState<number | null>(null);
  const [fadeClass, setFadeClass] = useState('');

  useEffect(() => {
    // Set up the interval only once
    const interval = setInterval(() => {
      setCurrentBg((old) => {
        const next = (old + 1) % 17;
        
        // Store the previous background for fade-out
        setPreviousBg(old);
        
        // Alternate between fade classes
        setFadeClass(old % 2 === 0 ? 'fade-out-a' : 'fade-out-b');
        
        // Clear the previous background after animation completes
        setTimeout(() => {
          setPreviousBg(null);
        }, 2000); // Match your CSS animation duration
        
        return next;
      });
    }, 10000); // Change background every 5 seconds

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isBrowser) return;
    initializeDeepLinkHandler();
  }, [setUser, setSessionToken, isBrowser]);

  const handleGitHubLogin = async () => {
    if (githubLoading) return;

    setGithubLoading(true);
    try {
      // Determine if we should use deep link
      const shouldUseDeepLink = !isBrowser && USE_DEEP_LINK;

      // Build OAuth URL
      // Browser: use redirect to /app/auth
      // Tauri with deep link: use deep_link=true
      // Tauri without deep link: use deep_link=false (backend redirects to /auth/success page)
      let url: string;
      if (isBrowser) {
        url = `${API_URL}/api/auth/sign-in/github?redirect=${encodeURIComponent('/app/auth')}`;
      } else if (shouldUseDeepLink) {
        url = `${API_URL}/api/auth/sign-in/github?deep_link=true`;
      } else {
        url = `${API_URL}/api/auth/sign-in/github?deep_link=false`;
      }

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.url) {
        if (isBrowser) {
          // In browser, navigate to OAuth in same window
          // Will redirect back to /app/auth?token=... after auth
          window.location.href = data.url;
        } else if (shouldUseDeepLink) {
          // In Tauri with deep link enabled, open in external browser and wait for deep link
          await openUrl(data.url);
          setWaitingForDeepLink(true);
          setGithubLoading(false);
          setTimeout(() => {
            if (waitingForDeepLink) {
              setShowTokenInput(true);
              setWaitingForDeepLink(false);
            }
          }, 10000);
        } else {
          // In Tauri with deep link disabled, open browser and show token input immediately
          await openUrl(data.url);
          setShowTokenInput(true);
          setGithubLoading(false);
        }
      } else {
        setGithubLoading(false);
      }
    } catch (error) {
      console.error('Failed to initiate GitHub login:', error);
      setGithubLoading(false);
    }
  };

  const handleTokenSubmit = async () => {
    if (!token.trim()) {
      setTokenError('Please enter a token');
      return;
    }

    console.log('[AuthScreen] Submitting token...');
    setGithubLoading(true);
    setTokenError('');

    try {
      // Use completeGitHubLogin which handles navigation after auth
      await completeGitHubLogin(token.trim());
    } catch (error) {
      setTokenError('Failed to verify token. Please try again.');
      setGithubLoading(false);
    }
  };

  return (
    <div className="relative h-full w-full">
      <div className="flex flex-col justify-center items-center gap-6 md:px-10 h-full w-full md:w-[45ch] lg:w-[55ch] xl:w-[65ch] max-w-full bg-gradient-to-b from-background-darker via-background/70 to-transparent dark:md:bg-black not-dark:md:bg-background rounded-none px-9 py-12">
        <div className="text-center flex flex-col gap-4 items-center w-[45ch] max-w-full">
          <div className="flex items-center gap-1 mb-3">
            <Logo className=" h-16 w-16 text-accent"/>
            <div className="flex flex-col items-center">
              <h2 className="
                text-4xl mb-3 pr-5 text-accent font-bold">ARIANA</h2>
            </div>
          </div>
          <div className="text-xl w-fit">Welcome</div>
          <div className='max-w-[40ch] text-sm text-muted-foreground'>
            Please, link your GitHub account for Ariana's collaborative magic to work
          </div>
        </div>
        <div className="space-y-6 flex flex-col justify-between h-full md:h-fit md:pb-44 w-[45ch] max-w-full">
          {waitingForDeepLink ? (
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
              <div className="flex flex-col mb-3 mt-6">
                <p className="text-sm text-muted-foreground">
                  Waiting for authentication to complete...
                </p>
                <p className="text-xs text-muted-foreground">
                  Complete the sign-in process in your browser
                </p>
              </div>
              <Button
                variant="default"
                wFull
                onClick={() => {
                  setWaitingForDeepLink(false);
                  setShowTokenInput(true);
                }}
              >
                Enter Token Manually
              </Button>
            </div>
          ) : !showTokenInput ? (
            <>
              <Button
                variant="accent"
                wFull
                onClick={handleGitHubLogin}
                disabled={githubLoading}
              >
                {githubLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Opening GitHub...
                  </>
                ) : (
                  <>
                    <div className="h-5 w-5">
                      <GithubLogo className="mr-2 text-inherit" />
                    </div>
                    <div>Continue with GitHub</div>
                  </>
                )}
              </Button>

              <p className="md:bg-transparent bg-background rounded-md self-end md:self-center py-3 px-4 md:p-0 text-xs text-left md:text-center text-muted-foreground">
                By continuing, you agree to our
                <a
                  href="https://ariana.dev/terms/terms.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline px-1 hover:text-accent"
                >
                  Terms of Service
                </a>
                <span>and our</span>
                <a
                  href="https://ariana.dev/terms/privacy.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline px-1 hover:text-accent"
                >
                  Privacy Policy
                </a>
              </p>
            </>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-center text-muted-foreground mb-4 px-1 py-0.5 backdrop-blur-lg rounded-md">
                  After signing in with GitHub, copy the token from the browser and paste it below:
                </p>
                <Input
                  type="text"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste your authentication token here"
                  disabled={githubLoading}
                />
                {tokenError && (
                  <p className="text-destructive-foreground text-sm mt-2">{tokenError}</p>
                )}
              </div>

              <div className="flex gap-2 justify-between w-full">
                <Button
                  variant="default"
                  className="w-full"
                  onClick={() => {
                    setShowTokenInput(false);
                    setToken('');
                    setTokenError('');
                  }}
                  disabled={githubLoading}
                >
                  Back
                </Button>
                <Button
                  className="w-full"
                  variant="default"
                  hoverVariant='accent'
                  onClick={handleTokenSubmit}
                  disabled={githubLoading || !token.trim()}
                >
                  {githubLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    'Complete Sign In'
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fading out background - only render when we have a previous background */}
      {previousBg !== null && (
        <div className={cn(
          "absolute top-0 left-0 w-full h-full -z-10",
          fadeClass
        )}>
          <Background background={{
            type: 'image',
            imageId: `${previousBg + 1}`
          }}/>
        </div>
      )}

      {/* Current background */}
      <div className="absolute top-0 left-0 w-full h-full -z-20">
        <Background background={{
          type: 'image',
          imageId: `${currentBg + 1}`
        }}/>
      </div>
    </div>
  );
}
