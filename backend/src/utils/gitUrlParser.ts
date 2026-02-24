/**
 * Utility functions for parsing Git clone URLs and constructing commit URLs
 * Supports: GitHub, GitLab, Bitbucket, Azure DevOps
 */

export interface GitUrlInfo {
  platform: 'github' | 'gitlab' | 'bitbucket' | 'azure-devops' | 'unknown';
  baseUrl: string;
  owner?: string;
  repo?: string;
  organization?: string;
  project?: string;
}

/**
 * Parse a Git clone URL to extract platform and repository information
 *
 * @param cloneUrl - Git clone URL (e.g., https://github.com/owner/repo.git)
 * @returns Parsed Git URL information
 */
export function parseGitCloneUrl(cloneUrl: string): GitUrlInfo {
  try {
    // Remove .git suffix if present
    const cleanUrl = cloneUrl.replace(/\.git$/, '');

    // GitHub: https://github.com/owner/repo
    const githubMatch = cleanUrl.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)/);
    if (githubMatch) {
      return {
        platform: 'github',
        baseUrl: cleanUrl,
        owner: githubMatch[1],
        repo: githubMatch[2]
      };
    }

    // GitLab: https://gitlab.com/owner/repo or https://gitlab.example.com/owner/repo
    const gitlabMatch = cleanUrl.match(/^https?:\/\/(gitlab\.[^\/]+|[^\/]*gitlab[^\/]*)\/([^\/]+)\/([^\/]+)/);
    if (gitlabMatch) {
      return {
        platform: 'gitlab',
        baseUrl: cleanUrl,
        owner: gitlabMatch[2],
        repo: gitlabMatch[3]
      };
    }

    // Bitbucket: https://bitbucket.org/owner/repo
    const bitbucketMatch = cleanUrl.match(/^https?:\/\/bitbucket\.org\/([^\/]+)\/([^\/]+)/);
    if (bitbucketMatch) {
      return {
        platform: 'bitbucket',
        baseUrl: cleanUrl,
        owner: bitbucketMatch[1],
        repo: bitbucketMatch[2]
      };
    }

    // Azure DevOps: https://dev.azure.com/organization/project/_git/repo
    const azureMatch = cleanUrl.match(/^https?:\/\/dev\.azure\.com\/([^\/]+)\/([^\/]+)\/_git\/([^\/]+)/);
    if (azureMatch) {
      return {
        platform: 'azure-devops',
        baseUrl: cleanUrl,
        organization: azureMatch[1],
        project: azureMatch[2],
        repo: azureMatch[3]
      };
    }

    // Unknown platform - return base URL
    return {
      platform: 'unknown',
      baseUrl: cleanUrl
    };
  } catch (error) {
    return {
      platform: 'unknown',
      baseUrl: cloneUrl
    };
  }
}

/**
 * Construct a commit URL from a Git clone URL and commit SHA
 *
 * @param cloneUrl - Git clone URL
 * @param commitSha - Git commit SHA
 * @returns Commit URL, or empty string if cannot be constructed
 */
export function constructCommitUrl(cloneUrl: string, commitSha: string): string {
  const info = parseGitCloneUrl(cloneUrl);

  switch (info.platform) {
    case 'github':
      // https://github.com/owner/repo/commit/sha
      return `${info.baseUrl}/commit/${commitSha}`;

    case 'gitlab':
      // https://gitlab.com/owner/repo/-/commit/sha
      return `${info.baseUrl}/-/commit/${commitSha}`;

    case 'bitbucket':
      // https://bitbucket.org/owner/repo/commits/sha
      return `${info.baseUrl}/commits/${commitSha}`;

    case 'azure-devops':
      // https://dev.azure.com/org/project/_git/repo/commit/sha
      return `${info.baseUrl}/commit/${commitSha}`;

    default:
      // Unknown platform - cannot construct URL
      return '';
  }
}

/**
 * Construct a branch URL from a Git clone URL and branch name
 *
 * @param cloneUrl - Git clone URL
 * @param branchName - Git branch name
 * @returns Branch URL, or empty string if cannot be constructed
 */
export function constructBranchUrl(cloneUrl: string, branchName: string): string {
  const info = parseGitCloneUrl(cloneUrl);

  switch (info.platform) {
    case 'github':
      // https://github.com/owner/repo/tree/branch
      return `${info.baseUrl}/tree/${encodeURIComponent(branchName)}`;

    case 'gitlab':
      // https://gitlab.com/owner/repo/-/tree/branch
      return `${info.baseUrl}/-/tree/${encodeURIComponent(branchName)}`;

    case 'bitbucket':
      // https://bitbucket.org/owner/repo/src/branch
      return `${info.baseUrl}/src/${encodeURIComponent(branchName)}`;

    case 'azure-devops':
      // https://dev.azure.com/org/project/_git/repo?version=GBbranch
      return `${info.baseUrl}?version=GB${encodeURIComponent(branchName)}`;

    default:
      // Unknown platform - cannot construct URL
      return '';
  }
}

/**
 * Construct a branch URL from GitHub repository full name and branch name
 *
 * @param fullName - GitHub repository full name (e.g., "owner/repo")
 * @param branchName - Git branch name
 * @returns Branch URL
 */
export function constructGithubBranchUrl(fullName: string, branchName: string): string {
  return `https://github.com/${fullName}/tree/${encodeURIComponent(branchName)}`;
}

/**
 * Check if a clone URL is from a known Git platform
 *
 * @param cloneUrl - Git clone URL
 * @returns True if platform is recognized
 */
export function isKnownGitPlatform(cloneUrl: string): boolean {
  const info = parseGitCloneUrl(cloneUrl);
  return info.platform !== 'unknown';
}
