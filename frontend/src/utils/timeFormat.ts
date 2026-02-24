export function formatUptime(createdAt: Date | string): string {
  const now = Date.now();
  const created = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  const diffSeconds = Math.floor((now - created) / 1000);

  if (diffSeconds < 60) {
    return `${Math.max(diffSeconds, 0)}s ago`;
  }

  if (diffSeconds < 3600) {
    const mins = Math.floor(diffSeconds / 60);
    const secs = diffSeconds % 60;
    return `${mins}m ${secs}s ago`;
  }

  if (diffSeconds < 86400) {
    const hours = Math.floor(diffSeconds / 3600);
    const mins = Math.floor((diffSeconds % 3600) / 60);
    return `${hours}h ${mins}m ago`;
  }

  if (diffSeconds < 604800) {
    const days = Math.floor(diffSeconds / 86400);
    const hours = Math.floor((diffSeconds % 86400) / 3600);
    return `${days}d ${hours}h ago`;
  }

  const weeks = Math.floor(diffSeconds / 604800);
  if (weeks === 1) {
    const days = Math.floor((diffSeconds % 604800) / 86400);
    return `${weeks}w ${days}d ago`;
  }

  return `${weeks}w ago`;
}
