/**
 * Port domain registration client (proxies through backend API).
 * Registers/unregisters subdomains like {machine-subdomain}-{port}.on.ariana.dev
 * so user services get HTTPS URLs instead of raw IP:port.
 *
 * SECURITY: Uses backend as proxy to cert-gateway. Agent doesn't have CERT_GATEWAY_KEY.
 */

// Cache registered port URLs from backend responses
const portUrls = new Map<number, string>();

export function isConfigured(): boolean {
  return !!(process.env.ARIANA_TOKEN && process.env.ARIANA_BACKEND_URL);
}

export function getPortUrl(port: number): string | null {
  return portUrls.get(port) ?? null;
}

export async function registerPortSubdomain(port: number): Promise<boolean> {
  if (!isConfigured()) return false;

  try {
    const response = await fetch(`${process.env.ARIANA_BACKEND_URL}/api/internal/agent/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ARIANA_TOKEN}`,
      },
      body: JSON.stringify({
        action: 'registerPortDomain',
        params: { port },
      }),
    });

    if (!response.ok) {
      console.error(`[PortDomain] Failed to register port ${port}: ${response.status}`);
      return false;
    }

    const data = await response.json();
    if (!data.success) {
      console.error(`[PortDomain] Backend error registering port ${port}: ${data.error}`);
      return false;
    }

    const url = data.data?.url;
    if (url) {
      portUrls.set(port, url);
    }

    console.log(`[PortDomain] Registered port ${port} -> ${url || '(no url in response)'}`);
    return true;
  } catch (error) {
    console.error(`[PortDomain] Error registering port ${port}:`, error);
    return false;
  }
}

export async function unregisterPortSubdomain(port: number): Promise<boolean> {
  if (!isConfigured()) return false;

  try {
    const response = await fetch(`${process.env.ARIANA_BACKEND_URL}/api/internal/agent/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ARIANA_TOKEN}`,
      },
      body: JSON.stringify({
        action: 'unregisterPortDomain',
        params: { port },
      }),
    });

    if (!response.ok) {
      console.error(`[PortDomain] Failed to unregister port ${port}: ${response.status}`);
      return false;
    }

    const data = await response.json();
    if (!data.success) {
      console.error(`[PortDomain] Backend error unregistering port ${port}: ${data.error}`);
      return false;
    }

    portUrls.delete(port);
    console.log(`[PortDomain] Unregistered port ${port}`);
    return true;
  } catch (error) {
    console.error(`[PortDomain] Error unregistering port ${port}:`, error);
    return false;
  }
}
