import CONFIG from "./config.js"

// Extract path prefix from pathname for reverse proxy support
function getPathPrefix(): string {
    const pathname = window.location.pathname;
    // If pathname has multiple parts like /proxy/1234/stream.html, extract /proxy/1234
    const parts = pathname.split('/').filter(p => p);
    if (parts.length > 1) {
        // Remove the last part (e.g., stream.html or api endpoint)
        parts.pop();
        return '/' + parts.join('/');
    }
    return CONFIG?.path_prefix ?? "";
}

const pathPrefix = getPathPrefix();
console.log('[Config] Using path prefix:', pathPrefix);

export function buildUrl(path: string): string {
    return `${window.location.origin}${pathPrefix}${path}`
}
