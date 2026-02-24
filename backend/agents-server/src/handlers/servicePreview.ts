import { Hono } from 'hono';

const app = new Hono();

/**
 * Service Preview Handler
 *
 * Provides public HTTPS URLs for localhost services without SSH forwarding.
 * URL format: https://{machine-subdomain}.a.ariana.dev/service-preview/{token}/{port}/{path}
 *
 * Validates the secret token and proxies requests to localhost:{port}.
 * For HTML responses, injects a small script that reports navigation and title
 * changes back to the parent frame via postMessage.
 *
 * NOTE: SERVICE_PREVIEW_TOKEN is read from process.env at request time (not module load)
 * because it's set dynamically via /update-environment after the process starts.
 */

// Script injected into HTML responses to communicate with the parent frame
function getInjectedScript(basePath: string): string {
  return `<script data-service-preview>
(function(){
  var bp = ${JSON.stringify(basePath)};
  function notify(){
    var path = location.pathname;
    if(path.indexOf(bp)===0) path = '/' + path.slice(bp.length);
    parent.postMessage({type:'sp-navigate', path: path + location.search, title: document.title},'*');
  }
  // Report on load
  notify();
  // Watch title changes
  new MutationObserver(notify).observe(
    document.querySelector('title') || document.head,
    {subtree:true, childList:true, characterData:true}
  );
  // Intercept pushState/replaceState
  var origPush = history.pushState, origReplace = history.replaceState;
  history.pushState = function(){origPush.apply(this,arguments); notify();};
  history.replaceState = function(){origReplace.apply(this,arguments); notify();};
  window.addEventListener('popstate', notify);
  // Intercept link clicks so non-HTML navigations (e.g. .sh, .json) also report path
  document.addEventListener('click', function(e){
    var a = e.target; while(a && a.tagName !== 'A') a = a.parentElement;
    if(!a || !a.href) return;
    try {
      var url = new URL(a.href, location.href);
      if(url.origin !== location.origin) return;
      var path = url.pathname;
      if(path.indexOf(bp)===0) path = '/' + path.slice(bp.length);
      parent.postMessage({type:'sp-navigate', path: path + url.search, title: document.title},'*');
    } catch(ex){}
  }, true);
})();
</script>`;
}

// Middleware to validate the preview token
function validatePreviewToken(c: any, next: any) {
  const { token } = c.req.param();
  const expectedToken = process.env.SERVICE_PREVIEW_TOKEN || '';

  if (!expectedToken) {
    console.error('[ServicePreview] SERVICE_PREVIEW_TOKEN not set in environment');
    return c.json({ error: 'Service preview not configured' }, 500);
  }

  if (!token || token !== expectedToken) {
    console.warn('[ServicePreview] Invalid token attempt');
    return c.json({ error: 'Invalid or missing preview token' }, 403);
  }

  return next();
}

// Handler function for proxying requests
const handleProxy = async (c: any) => {
  const { token, port } = c.req.param();
  const portNum = parseInt(port, 10);

  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    return c.json({ error: 'Invalid port number' }, 400);
  }

  const fullPath = c.req.path;
  const pathParts = fullPath.split('/').filter(Boolean);
  // pathParts: ['service-preview', token, port, ...rest]
  const remainingPath = pathParts.slice(3).join('/');
  const queryString = new URL(c.req.url).search;
  const targetUrl = `http://127.0.0.1:${portNum}/${remainingPath}${queryString}`;
  const basePath = `/service-preview/${token}/${port}/`;

  try {
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value: string, key: string) => {
      if (key.toLowerCase() !== 'host') {
        headers[key] = value;
      }
    });

    const response = await fetch(targetUrl, {
      method: c.req.method,
      headers,
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? await c.req.raw.clone().arrayBuffer() : undefined,
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value: string, key: string) => {
      responseHeaders[key] = value;
    });

    // Allow iframe embedding
    responseHeaders['Access-Control-Allow-Origin'] = '*';
    responseHeaders['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    responseHeaders['Access-Control-Allow-Headers'] = '*';
    delete responseHeaders['x-frame-options'];
    delete responseHeaders['content-security-policy'];

    const contentType = response.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html');

    if (isHtml && response.body) {
      // For HTML responses: rewrite URLs and inject navigation script
      let html = await response.text();

      // Rewrite absolute paths (href="/...", src="/...", action="/...")
      // so they go through our proxy
      html = html.replace(
        /((?:href|src|action)\s*=\s*["'])\/(?!\/)/gi,
        `$1${basePath}`
      );

      // Inject our navigation script right before </head> or at start of <body>
      const script = getInjectedScript(basePath);
      if (html.includes('</head>')) {
        html = html.replace('</head>', script + '</head>');
      } else if (html.includes('<body')) {
        html = html.replace(/<body([^>]*)>/i, `<body$1>${script}`);
      } else {
        html = script + html;
      }

      // Also inject a <base> tag so relative URLs resolve through the proxy
      const baseTag = `<base href="${basePath}">`;
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>${baseTag}`);
      } else if (html.includes('<head ')) {
        html = html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
      }

      delete responseHeaders['content-length']; // Length changed
      delete responseHeaders['content-encoding']; // We decoded it

      return new Response(html, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }

    // Non-HTML: pass through as-is
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error(`[ServicePreview] Error proxying to port ${portNum}:`, error);

    const errorHtml = `<!DOCTYPE html>
<html>
<head><title>Service Unavailable</title>
<style>
body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
.error-box { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 500px; }
h1 { margin: 0 0 1rem 0; color: #e11d48; }
p { margin: 0.5rem 0; color: #64748b; }
code { background: #f1f5f9; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
</style></head>
<body><div class="error-box">
<h1>Service Unavailable</h1>
<p>Unable to connect to the service on port <code>${portNum}</code>.</p>
<p>The service might not be running, or it might not be listening on <code>0.0.0.0</code>.</p>
</div></body></html>`;

    return new Response(errorHtml, {
      status: 502,
      headers: { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' },
    });
  }
};

// Register routes - both exact and wildcard
app.get('/:token/:port', validatePreviewToken, handleProxy);
app.get('/:token/:port/*', validatePreviewToken, handleProxy);
app.post('/:token/:port', validatePreviewToken, handleProxy);
app.post('/:token/:port/*', validatePreviewToken, handleProxy);
app.put('/:token/:port', validatePreviewToken, handleProxy);
app.put('/:token/:port/*', validatePreviewToken, handleProxy);
app.delete('/:token/:port', validatePreviewToken, handleProxy);
app.delete('/:token/:port/*', validatePreviewToken, handleProxy);
app.patch('/:token/:port', validatePreviewToken, handleProxy);
app.patch('/:token/:port/*', validatePreviewToken, handleProxy);

// CORS preflight
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};
app.options('/:token/:port', (c: any) => new Response(null, { status: 204, headers: corsHeaders }));
app.options('/:token/:port/*', (c: any) => new Response(null, { status: 204, headers: corsHeaders }));

export default app;
