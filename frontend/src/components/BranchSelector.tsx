import { useState } from 'react';
import { ChevronDown, GitBranch, Search, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';
import { Button } from './ui/button';

interface Branch {
  name: string;
  sha: string;
  protected: boolean;
}

interface BranchSelectorProps {
  currentBranch: string;
  onBranchSelect: (branch: string) => void;
  repositoryId: string;
  className?: string;
  disabled?: boolean;
}

export function BranchSelector({ currentBranch, onBranchSelect, repositoryId, className, disabled }: BranchSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [displayBranches, setDisplayBranches] = useState<Branch[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  // Fetch cached top 100 branches — called once when dropdown opens
  const fetchBranches = async (repo: string) => {
    if (hasFetched) return;
    setLoading(true);
    try {
      const response = await authenticatedFetch(`${API_URL}/api/repositories/${repo}/branches`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.branches) {
          setBranches(data.branches);
          setDisplayBranches(data.branches);
        }
      }
    } catch (error) {
      console.error('Failed to fetch branches:', error);
    } finally {
      setLoading(false);
      setHasFetched(true);
    }
  };

  // Search branches — queries GitHub directly via backend
  const doSearch = async () => {
    const term = searchTerm.trim();
    if (!term) {
      setDisplayBranches(branches);
      return;
    }
    setLoading(true);
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/repositories/${repositoryId}/branches/search?q=${encodeURIComponent(term)}`
      );
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.branches) {
          setDisplayBranches(data.branches);
        }
      }
    } catch (error) {
      console.error('Failed to search branches:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleBranchSelect = (branch: string) => {
    onBranchSelect(branch);
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setSearchTerm('');
      setDisplayBranches(branches);
    } else {
      fetchBranches(repositoryId);
    }
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button variant="transparent" wFull size="sm" disabled={disabled} className={cn(
            "group flex items-center gap-2 px-3 transition-colors justify-between",
            disabled && "opacity-50 cursor-not-allowed pointer-events-none"
          )}>
            <div className="flex items-center gap-2">
              <GitBranch className="h-2 w-2 transition-colors opacity-80" />
              <span className="truncate">{currentBranch.substring(0, 14) + (currentBranch.length > 14 ? '...' : '')}</span>
            </div>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
            )}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          className="w-[280px] max-h-[300px] bg-background border-(length:--border-width) border-muted/30 p-2 gap-2"
          align="start"
          side="bottom"
        >
          {/* Search Input */}
          <div onClick={(e) => e.stopPropagation()}>
            <div className="flex gap-1">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search branches..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    if (!e.target.value.trim()) setDisplayBranches(branches);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') doSearch();
                    if (e.key === 'Escape') setIsOpen(false);
                    e.stopPropagation();
                  }}
                  className="pl-9 h-8 text-sm"
                  autoFocus
                />
              </div>
              <Button
                onClick={doSearch}
                disabled={!searchTerm.trim() || loading}
                variant="default"
                size="sm"
                className="h-8 px-2"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          {/* Branch List */}
          <div className="max-h-[200px] overflow-y-auto flex flex-col gap-1">
            {displayBranches.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground text-center">
                {loading ? 'Loading...' : 'No branches found'}
              </div>
            ) : (
              displayBranches.map((branch) => (
                <DropdownMenuItem
                  key={branch.name}
                  className="flex items-center gap-2 p-3 cursor-pointer"
                  onClick={() => handleBranchSelect(branch.name)}
                >
                  <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1 truncate">{branch.name}</span>
                  <div className="flex items-center gap-2">
                    {branch.protected && (
                      <Badge variant="default" className="text-xs">
                        Protected
                      </Badge>
                    )}
                    {branch.name === currentBranch && (
                      <Badge variant="default" className="text-xs">
                        Current
                      </Badge>
                    )}
                  </div>
                </DropdownMenuItem>
              ))
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
