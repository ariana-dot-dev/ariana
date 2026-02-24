import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import LinkSquare from '../ui/icons/LinkSquare';
import { useIsBrowser } from '@/hooks/useIsBrowser';
import { openUrl } from '@tauri-apps/plugin-opener';

interface PRHeaderProps {
    prUrl: string;
    prBaseBranch?: string;
}

export function PRHeader({ prUrl, prBaseBranch }: PRHeaderProps) {
    const isBrowser = useIsBrowser();

    const handleViewPR = async () => {
        if (prUrl) {
          if (isBrowser) {
            window.open(prUrl, '_blank');
          } else {
            await openUrl(prUrl);
          }
        }
    };

    return (
        <div className="w-fit my-1 md:my-0 px-4 py-1 md:px-6 md:py-2 flex items-center justify-center">
            <p className="text-xs md:text-sm text-foreground/80">
                <button
                    onClick={handleViewPR}
                    className={cn(
                        "text-accent underline-offset-4 hover:underline inline-flex items-center gap-1 mr-1"
                    )}
                >
                    PR opened
                    <div className="h-3 w-3 md:h-4 md:w-4"><LinkSquare className="max-w-full max-h-full text-inherit"/></div>
                </button>
                {' '} to merge this {prBaseBranch ? ` into ${prBaseBranch}` : ''}
            </p>
        </div>
    );
}
