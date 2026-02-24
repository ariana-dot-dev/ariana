import type { ServiceContainer } from '../services';
import type { AuthenticatedRequest } from './auth';
import { requireAuthAsync } from './auth';
import { getLogger } from '../utils/logger';

const logger = getLogger(['admin', 'middleware']);

/**
 * Middleware to require admin privileges
 * Checks that user is authenticated AND has GitHub account linked AND is in the admin list
 */
export async function requireAdminAsync(
  req: Request,
  services: ServiceContainer
): Promise<AuthenticatedRequest> {
  // First, require authentication
  const auth = await requireAuthAsync(req, services);

  // Get admin logins from environment
  const adminLoginsEnv = process.env.ADMIN_GITHUB_LOGINS;
  if (!adminLoginsEnv) {
    logger.error`Admin check failed: ADMIN_GITHUB_LOGINS not configured`;
    throw new Error('AUTHORIZATION_FAILED: Admin access not configured');
  }

  const adminLogins = adminLoginsEnv.split(',').map(login => login.trim().toLowerCase());

  // Check if user has GitHub account linked and get login from database
  // This avoids making a GitHub API call on every admin request
  const githubProfile = await services.github.getUserGithubProfile(auth.user.id);
  if (!githubProfile) {
    logger.warn`Admin check failed: User has no GitHub account linked - userId: ${auth.user.id}`;
    throw new Error('AUTHORIZATION_FAILED: GitHub account required for admin access');
  }

  // GitHub login is stored in the 'name' field during OAuth
  const githubLogin = githubProfile.name;
  if (!githubLogin) {
    logger.warn`Admin check failed: GitHub profile missing login - userId: ${auth.user.id}`;
    throw new Error('AUTHORIZATION_FAILED: GitHub account required for admin access');
  }

  // Check if user's GitHub login is in the admin list
  if (!adminLogins.includes(githubLogin.toLowerCase())) {
    logger.warn`Admin check failed: User not in admin list - userId: ${auth.user.id}, githubLogin: ${githubLogin}`;
    throw new Error('AUTHORIZATION_FAILED: Insufficient permissions');
  }

  logger.info`Admin access granted - userId: ${auth.user.id}, githubLogin: ${githubLogin}`;
  return auth;
}
