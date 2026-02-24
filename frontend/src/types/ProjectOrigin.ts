import type { GithubRepository } from './github';

export type ProjectOrigin =
  | { type: 'local'; localPath: string }
  | { type: 'repository'; repository: GithubRepository; branch: string }
  | { type: 'cloneUrl'; url: string; branch: string; name: string };

export function getProjectOriginDisplay(origin: ProjectOrigin): {
  icon: 'folder' | 'github' | 'git';
  text: string;
} {
  switch (origin.type) {
    case 'local':
      const truncatedPath = origin.localPath.length > 30
        ? '...' + origin.localPath.slice(-27)
        : origin.localPath;
      return { icon: 'folder', text: truncatedPath };

    case 'repository':
      return { icon: 'github', text: origin.repository.fullName };

    case 'cloneUrl':
      return { icon: 'git', text: origin.url };
  }
}
