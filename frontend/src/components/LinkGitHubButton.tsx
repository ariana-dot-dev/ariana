import { Github, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useGitHubLinking } from '@/hooks/useGitHubLinking';
import type { ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import GithubLogo from './ui/icons/GithubLogo';

interface LinkGitHubButtonProps extends Omit<ButtonProps, 'onClick' | 'disabled'> {
  children?: React.ReactNode;
  showIcon?: boolean;
}

/**
 * Reusable button for linking GitHub account
 * Can be placed anywhere in the app
 */
export function LinkGitHubButton({
  children = 'Link GitHub Account',
  showIcon = true,
  variant = 'accent',
  ...props
}: LinkGitHubButtonProps) {
  const {
    linkGitHub,
    isLinking,
    showTokenInput,
    token,
    setToken,
    tokenError,
    submitToken,
    cancelTokenInput,
  } = useGitHubLinking();

  if (showTokenInput) {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-sm text-muted-foreground mb-2">
            After signing in with GitHub, copy the token from the browser and paste it below:
          </p>
          <Input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your authentication token here"
            disabled={isLinking}
          />
          {tokenError && (
            <p className="text-destructive-foreground text-sm mt-2">{tokenError}</p>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            variant="default"
            onClick={cancelTokenInput}
            disabled={isLinking}
            className="flex-1"
          >
            Back
          </Button>
          <Button
            variant="default"
            onClick={submitToken}
            disabled={isLinking || !token.trim()}
            className="flex-1"
          >
            {isLinking ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying...
              </>
            ) : (
              'Complete Sign In'
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      variant={variant}
      onClick={linkGitHub}
      disabled={isLinking}
      className={cn(
        props.className
      )}
      {...props}
    >
      {isLinking ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Opening GitHub...
        </>
      ) : (
        <>
          {showIcon && (
            <div className="h-4 w-4">
              <GithubLogo className='max-h-full max-w-full text-inherit' />
            </div>
          )}
          {children}
        </>
      )}
    </Button>
  );
}
