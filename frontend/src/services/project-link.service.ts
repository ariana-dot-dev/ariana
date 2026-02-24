import { authenticatedFetch } from '@/lib/auth';
import { API_URL } from '@/config';
import { getTauriAPI } from '@/lib/tauri-api';

const tauriAPI = getTauriAPI();

interface CheckAndLinkResult {
  success: boolean;
  accessGranted: boolean;
  merged?: boolean;
  projectId?: string;
  repository?: {
    id: string;
    githubId: number;
    fullName: string;
  };
  branches?: Array<{
    name: string;
    sha: string;
    protected: boolean;
  }>;
  role?: string;
  error?: string;
}

/**
 * Checks if user has GitHub access to repository and links/merges project if access granted
 * This should be called:
 * - When user clicks "Change Permissions" in agent config dropdown
 * - When a project is opened (to catch permission changes)
 */
export async function checkAndLinkRepository(
  projectId: string,
  localPath?: string,
  cloneUrl?: string
): Promise<CheckAndLinkResult> {
  try {
    let body = {};

    if (localPath) {
      // Get GitHub remote URL from local path
      const remoteResult = await tauriAPI.invoke<{ githubUrl: string; relativePath: string } | null>(
        'get_github_remote_url',
        { folderPath: localPath }
      );

      if (!remoteResult || !remoteResult.githubUrl) {
        return {
          success: false,
          accessGranted: false,
          error: 'No GitHub remote found'
        };
      }
      body = { githubUrl: remoteResult.githubUrl };
    } else if (cloneUrl) {
      // Check if it's a GitHub URL
      if (/^https:\/\/github\.com\//.test(cloneUrl)) {
        // It's a GitHub URL - strip .git extension and pass directly
        const githubUrl = cloneUrl.replace(/\.git$/, '');
        body = { githubUrl };
      } else {
        // Not a GitHub URL (GitLab, Bitbucket, Azure DevOps, etc.)
        // Return success without error to avoid showing warning
        return {
          success: true,
          accessGranted: false,
          error: undefined
        };
      }
    }

    // Call backend to check access and link/merge if needed
    const response = await authenticatedFetch(
      `${API_URL}/api/projects/${projectId}/check-and-link-repository`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );

    if (!response.ok) {
      return {
        success: false,
        accessGranted: false,
        error: `HTTP ${response.status}`
      };
    }

    const data = await response.json();
    return data;

  } catch (error) {
    console.error('Failed to check and link repository:', error);
    return {
      success: false,
      accessGranted: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
