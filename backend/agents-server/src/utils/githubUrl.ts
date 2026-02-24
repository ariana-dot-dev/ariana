/**
 * Extract repository fullName (owner/repo) from any GitHub URL
 * Returns null if not a GitHub URL
 */
export function extractGitHubRepository(url: string): string | null {
    if (!url.includes('github.com')) {
        return null;
    }

    let ownerRepo: string;

    if (url.startsWith('git@github.com:')) {
        // SSH: git@github.com:owner/repo.git or git@github.com:owner/repo
        ownerRepo = url.replace('git@github.com:', '');
    } else if (url.includes('github.com/')) {
        // HTTPS: https://github.com/owner/repo.git or http://github.com/owner/repo
        ownerRepo = url.split('github.com/')[1];
    } else {
        return null;
    }

    // Remove .git suffix if present
    ownerRepo = ownerRepo.replace(/\.git$/, '');

    return ownerRepo;
}

/**
 * Convert any GitHub URL to HTTPS clone URL with optional token
 */
export function toHttpsCloneUrl(url: string, token?: string): string {
    // Extract owner/repo from any GitHub URL format
    const ownerRepo = extractGitHubRepository(url);

    if (!ownerRepo) {
        throw new Error(`Unsupported URL format: ${url}`);
    }

    // Build HTTPS URL with optional token
    if (token) {
        return `https://${token}@github.com/${ownerRepo}.git`;
    } else {
        return `https://github.com/${ownerRepo}.git`;
    }
}
