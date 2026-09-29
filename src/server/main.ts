import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { SqliteRoomStore } from './sqlite-room-store.ts';
import { GameService } from './game-service.ts';
import { RealtimeServer } from './websocket-server.ts';

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || 'data/game.sqlite';
const CLIENT_DIR = resolve(process.cwd(), 'dist/client');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export function handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
  // Simple health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  // If production client build does not exist, serve an informative development notice
  if (!existsSync(CLIENT_DIR)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Beer Distribution Game Server</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 3rem; line-height: 1.6; }
      .card { background: #1e293b; max-width: 600px; margin: 0 auto; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
      h1 { color: #f59e0b; margin-top: 0; }
      code { background: #334155; padding: 0.2rem 0.4rem; border-radius: 4px; color: #38bdf8; }
      a { color: #38bdf8; text-decoration: none; }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Beer Distribution Game Server</h1>
      <p>The backend and WebSocket server are active on port <strong>${PORT}</strong>.</p>
      <p>For development: run <code>npm run dev</code> and navigate to <a href="http://localhost:5173">http://localhost:5173</a>.</p>
      <p>For production: run <code>npm run build</code> first, then run <code>npm start</code>.</p>
    </div>
  </body>
</html>`);
    return;
  }

  const urlPath = req.url ? req.url.split('?')[0] : '/';
  let safePath = join(CLIENT_DIR, urlPath);

  // Security check: ensure path stays within CLIENT_DIR
  if (!safePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  if (existsSync(safePath) && statSync(safePath).isDirectory()) {
    safePath = join(safePath, 'index.html');
  }

  // SPA fallback: any non-asset route serves index.html
  if (!existsSync(safePath)) {
    safePath = join(CLIENT_DIR, 'index.html');
  }

  if (!existsSync(safePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  const ext = extname(safePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': contentType });
  createReadStream(safePath).pipe(res);
}

export async function bootstrap(options: { port?: number; dbPath?: string } = {}): Promise<{
  server: RealtimeServer;
  store: SqliteRoomStore;
  port: number;
  httpServer: import('node:http').Server;
  close: () => Promise<void>;
}> {
  const port = options.port ?? PORT;
  const dbPath = options.dbPath ?? DB_PATH;

  const store = new SqliteRoomStore(dbPath);
  const gameService = new GameService(store);
  const httpServer = createServer(handleHttpRequest);

  const server = new RealtimeServer({
    gameService,
    server: httpServer,
    port,
  });

  const listeningPort = await server.start();
  console.log(`[BeerGame] Server listening on http://localhost:${listeningPort}`);
  console.log(`[BeerGame] WebSocket endpoint active at ws://localhost:${listeningPort}/ws`);
  console.log(`[BeerGame] SQLite database initialized at "${dbPath}"`);

  const close = async () => {
    await server.close();
    httpServer.closeAllConnections?.();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    store.close();
  };

  return { server, store, port: listeningPort, httpServer, close };
}

// Auto-start if run directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('main.ts') ||
    process.argv[1].endsWith('main.js') ||
    process.argv[1].includes('src/server/main') ||
    process.argv[1].includes('src\\server\\main'));

if (isDirectRun) {
  bootstrap().then(({ close }) => {
    const handleShutdown = async () => {
      console.log('\n[BeerGame] Shutting down gracefully...');
      await close();
      process.exit(0);
    };

    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);
  }).catch((err) => {
    console.error('[BeerGame] Fatal error during startup:', err);
    process.exit(1);
  });
}
