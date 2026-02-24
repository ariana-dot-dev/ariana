import { Download, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useOS } from '@/contexts/OSContext';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const DOWNLOAD_LINKS = {
  mac: 'https://example.com/download/mac',
  windows: 'https://example.com/download/windows',
  linux: 'https://example.com/download/linux',
} as const;

const PLATFORM_NAMES = {
  macos: 'Mac',
  windows: 'Windows',
  linux: 'Linux',
} as const;

export function DownloadDropdown() {
  const { os } = useOS();
  const [isOpen, setIsOpen] = useState(false);

  const currentPlatform = PLATFORM_NAMES[os];
  const currentLink = DOWNLOAD_LINKS[os === 'macos' ? 'mac' : os];

  const platforms = [
    { name: 'Mac', link: DOWNLOAD_LINKS.mac, key: 'mac' as const },
    { name: 'Windows', link: DOWNLOAD_LINKS.windows, key: 'windows' as const },
    { name: 'Linux', link: DOWNLOAD_LINKS.linux, key: 'linux' as const },
  ];

  const handleMainClick = (e: React.MouseEvent) => {
    // Don't navigate if dropdown is being opened
    if (isOpen) {
      return;
    }
    window.open(currentLink, '_blank');
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex w-fit items-stretch rounded-md bg-accent transition-all opacity-90 hover:opacity-100">
        <div className="p-[var(--border-width)] pr-0 rounded-l-md bg-gradient-to-t from-darkest/10 to-lightest/40 dark:from-darkest/40 dark:to-lightest/10">
          <a
            href={currentLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleMainClick}
            className="inline-flex items-center gap-2 rounded-l-md bg-accent text-accent-foreground px-4 py-2 text-sm outline-none whitespace-nowrap transition-all"
          >
            <Download className="size-4" />
            <span>Download Ariana for {currentPlatform}</span>
          </a>
        </div>
        <div className="p-[var(--border-width)] pl-0 rounded-r-md bg-gradient-to-t from-darkest/10 to-lightest/40 dark:from-darkest/40 dark:to-lightest/10">
          <DropdownMenuTrigger asChild>
            <button
              className="inline-flex h-full items-center justify-center rounded-r-md bg-accent text-accent-foreground px-2 py-2 text-sm outline-none transition-all"
              onClick={(e) => e.stopPropagation()}
            >
              <ChevronDown className="size-4" />
            </button>
          </DropdownMenuTrigger>
        </div>
      </div>

      <DropdownMenuContent
        className="bg-accent border-(length:--border-width) border-muted/40 shadow-lg z-50"
        align="end"
      >
        {platforms.map((platform) => (
          <DropdownMenuItem
            key={platform.key}
            variant="transparent"
            hoverVariant="accent"
            className="cursor-pointer text-accent-foreground"
            asChild
          >
            <a
              href={platform.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download className="size-4" />
              <span>{platform.name}</span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
