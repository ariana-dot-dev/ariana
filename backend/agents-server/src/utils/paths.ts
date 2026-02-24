/**
 * Path utilities for handling differences between Hetzner and custom machines
 *
 * Hetzner machines:
 * - Have an "ariana" user with HOME=/home/ariana
 * - Service runs as User=ariana
 *
 * Custom machines:
 * - No "ariana" user
 * - Service runs as User=root with HOME=/root
 *
 * This module provides functions that work on both machine types.
 */

/**
 * Get the home directory for the current user.
 * On Hetzner: /home/ariana
 * On Custom: /root
 */
export function getHomeDir(): string {
  return process.env.HOME || '/root';
}

/**
 * Get the .bashrc path for the current user
 */
export function getBashrcPath(): string {
  return `${getHomeDir()}/.bashrc`;
}

/**
 * Get the .ssh directory for the current user
 */
export function getSshDir(): string {
  return `${getHomeDir()}/.ssh`;
}

/**
 * Get the .claude directory for the current user
 */
export function getClaudeDir(): string {
  return `${getHomeDir()}/.claude`;
}

/**
 * Get the base working directory (NOT the project directory).
 * This is where the project subdirectory lives.
 * On Hetzner: /home/ariana (from WORK_DIR)
 * On Custom: /root (from HOME)
 */
export function getBaseDir(): string {
  return process.env.WORK_DIR || getHomeDir();
}

/**
 * Get the default project directory.
 * Project is always at ${baseDir}/project.
 * On Hetzner: /home/ariana/project
 * On Custom: /root/project
 */
export function getDefaultProjectDir(): string {
  return `${getBaseDir()}/project`;
}
