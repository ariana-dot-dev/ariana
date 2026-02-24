import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Github } from 'lucide-react';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (projectName: string) => void;
  loading: boolean;
  userGitHubLogin?: string;
}

export function CreateProjectModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  loading, 
  userGitHubLogin = 'your-username' 
}: CreateProjectModalProps) {
  const [projectName, setProjectName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (projectName.trim()) {
      onConfirm(projectName.trim());
    }
  };

  const handleClose = () => {
    if (!loading) {
      setProjectName('');
      onClose();
    }
  };

  const isValidProjectName = (name: string) => {
    // GitHub repository name rules: alphanumeric, hyphens, underscores, periods
    const regex = /^[a-zA-Z0-9._-]+$/;
    return name.length > 0 && name.length <= 100 && regex.test(name);
  };

  const isValid = isValidProjectName(projectName);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[75ch]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            Create New Project
          </DialogTitle>
          <DialogDescription>
            Ariana will create a GitHub repository in your account.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-name">Project Name</Label>
            <Input
              id="project-name"
              placeholder="my-awesome-project"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>
          
          {projectName && (
            <div className="p-3 bg-muted rounded-md">
              <div className="text-sm text-muted-foreground mb-1">GitHub Repository:</div>
              <div className="font-mono text-sm flex items-center gap-1">
                <Github className="h-4 w-4" />
                {userGitHubLogin}/{projectName}
              </div>
            </div>
          )}
          
          <DialogFooter className="gap-2">
            <Button 
              type="button" 
              variant="default" 
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={!isValid || loading}
              style={{ 
                backgroundColor: 'var(--accent)', 
                color: 'var(--accent-foreground)' 
              }}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Repository'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}