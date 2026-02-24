/**
 * Extract the real client IP address from a request
 * Handles proxies, load balancers, and Cloudflare
 */
export function extractIPAddress(req: Request): string {
  const headers = req.headers;

  // Try various headers in order of preference
  const possibleHeaders = [
    'cf-connecting-ip',        // Cloudflare
    'x-real-ip',              // Nginx
    'x-forwarded-for',        // Standard proxy header
    'x-client-ip',            // Alternative
    'x-cluster-client-ip',    // Rackspace LB
    'forwarded-for',          // RFC 7239
    'forwarded',              // RFC 7239
  ];

  for (const header of possibleHeaders) {
    const value = headers.get(header);
    if (value) {
      // X-Forwarded-For can contain multiple IPs (client, proxy1, proxy2, ...)
      // Take the first one (actual client)
      const ip = value.split(',')[0].trim();
      if (ip && isValidIP(ip)) {
        return ip;
      }
    }
  }

  // Fallback: use a placeholder if we can't determine the IP
  // In production with proper infrastructure, this shouldn't happen
  return 'unknown';
}

/**
 * Basic IP address validation
 */
function isValidIP(ip: string): boolean {
  // IPv4 pattern
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(ip)) {
    const parts = ip.split('.');
    return parts.every(part => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }

  // IPv6 pattern (simplified)
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv6Pattern.test(ip);
}
