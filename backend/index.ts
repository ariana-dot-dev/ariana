import "dotenv/config";
import { serve } from "bun";
import { createRepositoryContainer } from './src/data/repositories';
import { createServiceContainer } from './src/services';
import { handleApiRequest } from './src/api';
import { handleAuthRoutes } from './src/api/auth/routes';
import { addCorsHeaders, isOriginAllowed } from './src/middleware/auth';
import { configureLogging, getLogger } from './src/utils/logger';
import { initWebSocketManager, type WSData } from './src/websocket/server';
import { pgPubSub } from './src/events/pg-pubsub';
import { eventBus } from './src/events/emitter';

// Initialize logging
await configureLogging();
const logger = getLogger(['server']);
const healthLogger = getLogger(['server', 'health']);

// Start PG pub/sub for cross-worker event delivery (must be before WS manager)
await pgPubSub.start();
eventBus.setPgNotify((event, data) => pgPubSub.notify(event, data));

const repositories = createRepositoryContainer();
const services = createServiceContainer(repositories);
const wsManager = initWebSocketManager(services);

const workerId = process.env.WORKER_ID || '0';

async function handleRequest(req: Request, server: any): Promise<Response> {
  const origin = req.headers.get('Origin');
  const allowedOrigin = isOriginAllowed(origin) ? origin : null;

  try {
    const url = new URL(req.url);

    // Handle WebSocket upgrade requests
    if (url.pathname === '/ws') {
      const connectionId = wsManager.generateConnectionId();
      const upgraded = server.upgrade(req, {
        data: {
          connectionId,
          userId: null,
          authenticated: false,
          lastPong: Date.now(),
        } satisfies WSData,
      });
      if (upgraded) {
        return undefined as any; // Bun handles the response for upgrades
      }
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    const apiResponse = await handleApiRequest(req, services, allowedOrigin);
    if (apiResponse) {
      return apiResponse;
    }
    
    // Handle non-API auth routes (like old backend)
    if (url.pathname.startsWith('/auth/')) {
      const authResponse = await handleAuthRoutes(req, url, services, allowedOrigin);
      if (authResponse) {
        return authResponse;
      }
    }

    if (url.pathname === '/health') {
      return addCorsHeaders(Response.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.APP_VERSION || 'development'
      }), allowedOrigin);
    }

    // Serve the frontend SPA under /app
    if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
      // In dev mode, redirect to Vite dev server on client side
      if (process.env.VITE_DEV_SERVER) {
        const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Redirecting to Dev Server...</title>
</head>
<body>
  <script>
    // Redirect to Vite dev server - keep /app prefix
    const viteUrl = 'http://localhost:1420' + window.location.pathname + window.location.search;
    window.location.replace(viteUrl);
  </script>
  <p>Redirecting to dev server...</p>
</body>
</html>`;
        return new Response(html, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
          },
        });
      }

      // Production: serve static files
      try {
        // Helper to determine content type
        const getContentType = (path: string): string => {
          if (path.endsWith('.js')) return 'application/javascript';
          if (path.endsWith('.css')) return 'text/css';
          if (path.endsWith('.json')) return 'application/json';
          if (path.endsWith('.svg')) return 'image/svg+xml';
          if (path.endsWith('.png')) return 'image/png';
          if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
          if (path.endsWith('.webp')) return 'image/webp';
          if (path.endsWith('.woff')) return 'font/woff';
          if (path.endsWith('.woff2')) return 'font/woff2';
          return 'application/octet-stream';
        };

        // If requesting a bundled asset (JS, CSS)
        if (url.pathname.startsWith('/app/assets/')) {
          const assetPath = url.pathname.replace('/app/assets/', '');
          const filePath = new URL(`./static/app/assets/${assetPath}`, import.meta.url);
          const file = Bun.file(filePath);

          if (await file.exists()) {
            return new Response(file, {
              headers: {
                'Content-Type': getContentType(assetPath),
                'Cache-Control': 'public, max-age=31536000, immutable',
              },
            });
          }
        }

        // If requesting a public file (background images, icons, etc.)
        // These are in dist root, served at /app/filename.ext
        const publicFileMatch = url.pathname.match(/^\/app\/([^/]+\.(jpg|jpeg|png|svg|ico|webp))$/i);
        if (publicFileMatch) {
          const fileName = publicFileMatch[1];
          const filePath = new URL(`./static/app/${fileName}`, import.meta.url);
          const file = Bun.file(filePath);

          if (await file.exists()) {
            return new Response(file, {
              headers: {
                'Content-Type': getContentType(fileName),
                'Cache-Control': 'public, max-age=31536000, immutable',
              },
            });
          }
        }

        // For all other /app routes, serve the SPA's index.html
        // This enables client-side routing
        const indexPath = new URL('./static/app/index.html', import.meta.url);
        const indexFile = Bun.file(indexPath);

        if (await indexFile.exists()) {
          return new Response(indexFile, {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-cache',
            },
          });
        }
      } catch (error) {
        logger.error `Failed to serve frontend SPA: ${error}`;
      }

      return new Response('Frontend not found', { status: 404 });
    }

    // Serve the dashboard SPA under /dashboard
    if (url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/')) {
      // Production: serve static files
      try {
        // Helper to determine content type
        const getContentType = (path: string): string => {
          if (path.endsWith('.js')) return 'application/javascript';
          if (path.endsWith('.css')) return 'text/css';
          if (path.endsWith('.json')) return 'application/json';
          if (path.endsWith('.svg')) return 'image/svg+xml';
          if (path.endsWith('.png')) return 'image/png';
          if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
          if (path.endsWith('.webp')) return 'image/webp';
          if (path.endsWith('.woff')) return 'font/woff';
          if (path.endsWith('.woff2')) return 'font/woff2';
          return 'application/octet-stream';
        };

        // If requesting a bundled asset (JS, CSS)
        if (url.pathname.startsWith('/dashboard/assets/')) {
          const assetPath = url.pathname.replace('/dashboard/assets/', '');
          const filePath = new URL(`./static/dashboard/assets/${assetPath}`, import.meta.url);
          const file = Bun.file(filePath);

          if (await file.exists()) {
            return new Response(file, {
              headers: {
                'Content-Type': getContentType(assetPath),
                'Cache-Control': 'public, max-age=31536000, immutable',
              },
            });
          }
        }

        // If requesting a public file
        const publicFileMatch = url.pathname.match(/^\/dashboard\/([^/]+\.(jpg|jpeg|png|svg|ico|webp))$/i);
        if (publicFileMatch) {
          const fileName = publicFileMatch[1];
          const filePath = new URL(`./static/dashboard/${fileName}`, import.meta.url);
          const file = Bun.file(filePath);

          if (await file.exists()) {
            return new Response(file, {
              headers: {
                'Content-Type': getContentType(fileName),
                'Cache-Control': 'public, max-age=31536000, immutable',
              },
            });
          }
        }

        // For all other /dashboard routes, serve the SPA's index.html
        const indexPath = new URL('./static/dashboard/index.html', import.meta.url);
        const indexFile = Bun.file(indexPath);

        if (await indexFile.exists()) {
          return new Response(indexFile, {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-cache',
            },
          });
        }
      } catch (error) {
        logger.error `Failed to serve dashboard SPA: ${error}`;
      }

      return new Response('Dashboard not found', { status: 404 });
    }

    return addCorsHeaders(Response.json({
      error: 'Not Found',
      path: url.pathname
    }, { status: 404 }), allowedOrigin);
    
  } catch (error) {
    logger.error `Server error: ${error}`;
    
    return addCorsHeaders(Response.json({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'development' 
        ? (error instanceof Error ? error.message : 'Unknown error')
        : 'Something went wrong'
    }, { status: 500 }), allowedOrigin);
  }
}

const port = parseInt(process.env.PORT || '3000');
const hostname = '0.0.0.0';

logger.info(`Worker ${workerId}: Server starting on http://${hostname}:${port}`);
logger.info(`Worker ${workerId}: Environment: ${process.env.NODE_ENV || 'development'}`);
logger.info(`Worker ${workerId}: Database: ${process.env.DATABASE_URL || './data/app.db'}`);

// Debug environment variables
logger.debug `FLY_AGENTS_APP_NAME: ${process.env.FLY_AGENTS_APP_NAME || 'NOT SET'}`;
logger.debug `FLY_API_TOKEN: ${process.env.FLY_API_TOKEN ? process.env.FLY_API_TOKEN.substring(0, 3) + '... (length: ' + process.env.FLY_API_TOKEN.length + ')' : 'NOT SET'}`;
logger.debug `SERVER_URL: ${process.env.SERVER_URL || 'NOT SET'}`;
logger.debug `GITHUB_CLIENT_ID: ${process.env.GITHUB_CLIENT_ID || 'NOT SET'}`;

// Validate admin configuration
const adminLogins = process.env.ADMIN_GITHUB_LOGINS;
if (!adminLogins || adminLogins.trim() === '') {
  logger.warn `ADMIN_GITHUB_LOGINS environment variable is not set. Admin endpoints will be inaccessible.`;
} else {
  const logins = adminLogins.split(',').map(login => login.trim()).filter(login => login.length > 0);
  if (logins.length === 0) {
    logger.warn `ADMIN_GITHUB_LOGINS is set but contains no valid logins. Admin endpoints will be inaccessible.`;
  } else {
    logger.info `Admin access configured for ${logins.length} GitHub user(s): ${logins.join(', ')}`;
  }
}

// Run startup procedure for agent service (only on primary worker)
if (workerId === '0') {
  (async () => {
    try {
      logger.info `Worker ${workerId}: Running agent service startup procedure...`;
      await services.agents.startupProcedure();
      logger.info `Worker ${workerId}: Agent service startup completed`;

      // Auto-restore ERROR agents (< 2 days old, max 1 per user per day, no usage limits)
      logger.info `Worker ${workerId}: Running ERROR agent auto-restore...`;
      await services.agentMovements.restartErrorAgents();
      logger.info `Worker ${workerId}: ERROR agent auto-restore completed`;
    } catch (error) {
      logger.error `Worker ${workerId}: Failed to run agent service startup procedure: ${error}`;
    }
  })();
} else {
  logger.info `Worker ${workerId}: Skipping startup procedure (only worker 0 runs it)`;
}

serve({
  hostname,
  port,
  reusePort: true, // Enable multi-core load balancing on Linux
  idleTimeout: 255, // 255 seconds timeout (max allowed by Bun)
  fetch: (req, server) => handleRequest(req, server),
  websocket: {
    data: undefined as unknown as WSData,
    open(ws) {
      wsManager.onOpen(ws);
    },
    message(ws, message) {
      wsManager.onMessage(ws, message);
    },
    close(ws) {
      wsManager.onClose(ws);
    },
    idleTimeout: 120, // 2 minutes idle timeout for WebSocket connections
  },
});


logger.info `Worker ${workerId}: Server running on http://${hostname}:${port}`;


// Machine reservation queue processor (every 2 seconds)
// Only run on primary worker to avoid duplicate processing
if (workerId === '0') {
  logger.info `Worker ${workerId}: Starting machine reservation queue processor`;
  setInterval(async () => {
    try {
      const assignments = await services.machineReservationQueue.processQueue();
      if (assignments > 0) {
        logger.info `Processed ${assignments} machine assignment(s)`;
      }
    } catch (error) {
      logger.error `Queue processor error: ${error}`;
    }
  }, 2000); // Every 2 seconds
}

// Health check system to keep agent machines alive (every 10 seconds)
// Only run on primary worker to avoid duplicate health checks
if (workerId === '0') {
  logger.info `Worker ${workerId}: Starting health check system`;
  setInterval(async () => {
    try {
      const agents = await services.agents.getAllAgents();
      const agentsWithMachines = agents.filter(agent =>
        agent.machineId
      );

      // Ping all machines in parallel
      const healthChecks = agentsWithMachines.map(async (agent) => {
        if (!agent.machineIpv4) {
          healthLogger.warn `Agent ${agent.id} machine ${agent.machineId} has no IP address`;
          return;
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);

          const response = await services.agents.healthCheckMachine(agent.machineIpv4);

          clearTimeout(timeoutId);

          if (response.ok) {
            // Record success in database
            await services.healthCheck.recordSuccess(agent.id, agent.machineId!);
          } else {
            // Record failure in database
            const shouldDelete = await services.healthCheck.recordFailure(agent.id, agent.machineId!);

            healthLogger.warn `Agent ${agent.id} machine ${agent.machineId} health check failed: ${response.status}`;

            if (shouldDelete) {
              healthLogger.error `Agent ${agent.id} machine ${agent.machineId} has failed too many times, clearing machine...`;
              // Clear machineId and set to ERROR state if not already ARCHIVED
              const currentAgent = await services.agents.getAgent(agent.id);
              if (currentAgent && currentAgent.state !== 'archived') {
                await services.agents.updateAgentState(agent.id, 'error');
              }
              await services.agents.clearAgentMachine(agent.id);
            }
          }
        } catch (error) {
          // Record failure in database
          const shouldDelete = await services.healthCheck.recordFailure(agent.id, agent.machineId!);

          healthLogger.warn `Agent ${agent.id} machine ${agent.machineId} health check error: ${error}`;

          if (shouldDelete) {
            healthLogger.error `Agent ${agent.id} machine ${agent.machineId} has failed too many times, clearing machine...`;
            // Clear machineId and set to ERROR state if not already ARCHIVED
            const currentAgent = await services.agents.getAgent(agent.id);
            if (currentAgent && currentAgent.state !== 'archived') {
              await services.agents.updateAgentState(agent.id, 'error');
            }
            await services.agents.clearAgentMachine(agent.id);
          }
        }
      });

      await Promise.allSettled(healthChecks);
    } catch (error) {
      healthLogger.warn `System error: ${error}`;
    }
  }, 10000);

  // Agent upload progress cleanup system (every 10 minutes)
  logger.info `Worker ${workerId}: Starting agent upload progress cleanup system`;
  setInterval(async () => {
    try {
      const result = await services.agentUploads.cleanupOldProgress();
      if (result.progressDeleted > 0) {
        logger.info `Cleaned up old upload progress: ${result.progressDeleted} records`;
      }
    } catch (error) {
      logger.warn `Upload progress cleanup error: ${error}`;
    }
  }, 10 * 60 * 1000); // Every 10 minutes

  // Periodic machine snapshots for active agents (every 1 minute)
  // With the new delta-based system, snapshots are fast (<5 sec for typical changes)
  logger.info `Worker ${workerId}: Starting periodic machine snapshot system`;
  setInterval(async () => {
    try {
      await services.agents.processSnapshotQueue();
    } catch (error) {
      logger.warn `Snapshot queue error: ${error}`;
    }
  }, 60 * 1000); // Every 1 minute
} else {
  logger.info `Worker ${workerId}: Skipping health check system (only worker 0 runs it)`;
}

// Graceful shutdown handlers
const shutdown = async () => {
  logger.info `Shutting down gracefully...`;

  try {
    // Close PG pub/sub connections
    logger.info `Closing PG pub/sub...`;
    await pgPubSub.stop();

    // Clean up WebSocket connections
    logger.info `Closing WebSocket connections...`;
    wsManager.cleanup();
    logger.info `WebSocket cleanup completed`;

    // Clean up all machines before shutdown
    logger.info `Cleaning up machines before shutdown...`;
    await services.agents.cleanupAllMachines();
    logger.info `Machine cleanup completed`;

    process.exit(0);
  } catch (error) {
    logger.error `Error during shutdown: ${error}`;
    process.exit(1);
  }
};

// Handle various shutdown signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);  // Ctrl+C
process.on('SIGUSR1', shutdown); // PM2 graceful shutdown
process.on('SIGUSR2', shutdown); // PM2 graceful shutdown

