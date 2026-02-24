import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as certGateway from '../certGateway';
import { markPortRegistered, markPortUnregistered } from '../portMonitor';

const execAsync = promisify(exec);

const app = new Hono();

interface SetPortVisibilityRequest {
  port: number;
  visibility: 'private' | 'public';
}

app.post('/', async (c) => {
  const body = await c.req.json();
  const { valid, data, error } = await encryption.decryptAndValidate<SetPortVisibilityRequest>(body);

  if (!valid || !data) {
    console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error);
    return c.json({ error }, 400);
  }

  try {
    const { port, visibility } = data;

    if (!port || !visibility) {
      const errorResponse = {
        success: false,
        error: 'Missing required fields: port and visibility'
      };
      const encryptedResponse = encryption.encrypt(errorResponse);
      return c.json({ encrypted: encryptedResponse }, 400);
    }

    if (visibility === 'public') {
      // Open port in firewall (ufw for non-Docker, iptables DOCKER-USER for Docker)
      await execAsync(`sudo ufw allow ${port}`, { timeout: 5000 });
      await execAsync(`sudo iptables -I DOCKER-USER 1 -p tcp -m conntrack --ctorigdstport ${port} --ctstate NEW -j RETURN`, { timeout: 5000 }).catch(() => {});
      await execAsync(`sudo iptables -I DOCKER-USER 1 -p udp -m conntrack --ctorigdstport ${port} --ctstate NEW -j RETURN`, { timeout: 5000 }).catch(() => {});
      console.log(`[PortVisibility] Opened port ${port} in firewall`);

      // Register HTTPS subdomain with cert-gateway
      const registered = await certGateway.registerPortSubdomain(port);
      if (registered) markPortRegistered(port);
    } else {
      // Close port in firewall
      await execAsync(`sudo ufw delete allow ${port}`, { timeout: 5000 });
      await execAsync(`sudo iptables -D DOCKER-USER -p tcp -m conntrack --ctorigdstport ${port} --ctstate NEW -j RETURN`, { timeout: 5000 }).catch(() => {});
      await execAsync(`sudo iptables -D DOCKER-USER -p udp -m conntrack --ctorigdstport ${port} --ctstate NEW -j RETURN`, { timeout: 5000 }).catch(() => {});
      console.log(`[PortVisibility] Closed port ${port} in firewall`);

      // Unregister HTTPS subdomain from cert-gateway
      const unregistered = await certGateway.unregisterPortSubdomain(port);
      if (unregistered) markPortUnregistered(port);
    }

    const response = {
      success: true,
      port,
      visibility
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });

  } catch (error) {
    console.error('Error setting port visibility:', error);

    const errorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to set port visibility'
    };

    const encryptedResponse = encryption.encrypt(errorResponse);
    return c.json({ encrypted: encryptedResponse }, 500);
  }
});

export default app;
