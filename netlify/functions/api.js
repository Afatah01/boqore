// Netlify Function wrapper — runs the Express app on a local socket and
// forwards each incoming request to it. Zero extra dependencies.
//
// Supports both Netlify event shapes:
//  - legacy event: { httpMethod, path, rawQueryString, headers, body }
//  - web request:  Request object with .url/.method/.headers
import http from 'node:http';
import app from '../../server.js';

let serverPromise = null;
function getServer() {
  if (!serverPromise) {
    serverPromise = new Promise((resolve) => {
      const s = http.createServer(app);
      // Reused for the whole lifetime of a warm function container.
      s.listen(0, '127.0.0.1', () => resolve(s));
    });
  }
  return serverPromise;
}

function forward(server, { method, path, headers, body }) {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    delete h['host'];
    delete h['connection'];
    if (body != null) h['content-length'] = Buffer.byteLength(body);
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: h },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('base64'),
            isBase64Encoded: true,
          });
        });
      }
    );
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

export default async (event) => {
  const server = await getServer();

  // Web Request shape (newer runtimes)
  if (event && typeof event.url === 'string' && typeof event.method === 'string' && event.headers) {
    const headers = {};
    event.headers.forEach((v, k) => (headers[k] = v));
    let body = null;
    if (event.method !== 'GET' && event.method !== 'HEAD') {
      const raw = await event.text();
      if (raw) body = raw;
    }
    const u = new URL(event.url);
    const res = await forward(server, { method: event.method, path: u.pathname + (u.search || ''), headers, body });
    return new Response(res.body ? Buffer.from(res.body, 'base64') : null, {
      status: res.statusCode,
      headers: res.headers,
    });
  }

  // Legacy event shape (classic Node runtime)
  let body = event.body ?? null;
  if (body != null && event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
  const res = await forward(server, {
    method: event.httpMethod || 'GET',
    path: (event.path || '/') + (event.rawQueryString ? `?${event.rawQueryString}` : ''),
    headers: event.headers || {},
    body,
  });
  return res;
};
