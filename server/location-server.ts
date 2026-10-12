import http from 'node:http';
import { Pool } from 'pg';
import {
  FailureLimiter,
  parseBasicAuth,
  parseOwnTracksMessage,
  verifyLocationPassword,
} from '../lib/location-ingest';

/*
 * Receives positions from the family's phones (OwnTracks in HTTP mode, or any
 * app speaking the same format) on its own port, so it can sit on its own
 * domain while the rest of hyperion stays behind your login.
 *
 *   POST /pub   Basic auth with the member's username and password, JSON body
 *   GET  /health
 *
 * Everything else is 404. Only the last position of each member is stored.
 */

const MAX_BODY_BYTES = 16 * 1024;
const limiter = new FailureLimiter(10, 15 * 60 * 1000);

function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}) {
  console[level === 'info' ? 'log' : level](JSON.stringify({ level, module: 'location-server', msg, ...extra }));
}

type Env = Record<string, string | undefined>;

export function databaseUrlFromEnv(env: Env = process.env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = env;
  if (!DB_HOST || !DB_PORT || !DB_NAME || !DB_USER) {
    throw new Error('Set DATABASE_URL or DB_HOST, DB_PORT, DB_NAME and DB_USER');
  }
  const auth = DB_PASSWORD ? `${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}` : encodeURIComponent(DB_USER);
  return `postgresql://${auth}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

/** The body as text, or null when it is larger than MAX_BODY_BYTES. */
function readBody(req: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Stop keeping it and answer now; the rest is drained and the
        // connection closed after the reply (Connection: close).
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export interface MemberStore {
  findByUsername(username: string): Promise<{ id: string; passwordHash: string | null } | null>;
  saveLastPosition(id: string, p: { lat: number; lon: number; acc: number | null; batt: number | null; at: Date }): Promise<void>;
}

export function pgMemberStore(pool: Pool): MemberStore {
  return {
    async findByUsername(username) {
      const r = await pool.query<{ id: string; passwordHash: string | null }>(
        'SELECT "id", "passwordHash" FROM "family_members" WHERE "username" = $1',
        [username]
      );
      return r.rows[0] ?? null;
    },
    async saveLastPosition(id, p) {
      // Ignore a position older than the one we have (phones resend queued fixes).
      // The column has no time zone and Prisma reads it as UTC, so send UTC
      // text: pg would otherwise send the Date in the server's local zone.
      await pool.query(
        `UPDATE "family_members"
            SET "lastLat" = $2, "lastLon" = $3, "lastAcc" = $4, "lastBatt" = $5, "lastAt" = $6, "updatedAt" = NOW()
          WHERE "id" = $1 AND ("lastAt" IS NULL OR "lastAt" <= $6::timestamp)`,
        [id, p.lat, p.lon, p.acc, p.batt, p.at.toISOString()]
      );
    },
  };
}

export function createLocationHandler(store: MemberStore) {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      const path = (req.url ?? '/').split('?')[0];

      if (req.method === 'GET' && path === '/health') return send(res, 200, { status: 'ok' });
      if (path !== '/pub') return send(res, 404, { error: 'Not found' });
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });

      const credentials = parseBasicAuth(req.headers.authorization);
      const unauthorized = () => send(res, 401, { error: 'Unauthorized' }, { 'WWW-Authenticate': 'Basic realm="hyperion"' });
      if (!credentials) return unauthorized();

      const key = credentials.username;
      if (limiter.isBlocked(key)) return send(res, 429, { error: 'Too many failed logins, try again later' });

      const member = await store.findByUsername(credentials.username);
      const ok = member?.passwordHash ? await verifyLocationPassword(credentials.password, member.passwordHash) : false;
      if (!member || !ok) {
        limiter.fail(key);
        log('warn', 'Rejected login', { username: credentials.username });
        return unauthorized();
      }
      limiter.succeed(key);

      const raw = await readBody(req);
      if (raw === null) return send(res, 413, { error: 'Body too large' }, { Connection: 'close' });
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: 'Body must be JSON' });
      }

      const position = parseOwnTracksMessage(body);
      if (position === 'invalid') return send(res, 400, { error: 'Invalid location' });
      if (position) await store.saveLastPosition(member.id, position);

      // OwnTracks expects a JSON array in reply (messages for the phone; none).
      return send(res, 200, []);
    } catch (error) {
      log('error', 'Request failed', { err: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) send(res, 500, { error: 'Internal error' });
    }
  };
}

/** Starts the server when LOCATION_PORT is set. Returns null otherwise. */
export function startLocationServer(env: Env = process.env): http.Server | null {
  const port = Number(env.LOCATION_PORT);
  if (!env.LOCATION_PORT) return null;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    log('error', 'LOCATION_PORT is not a valid port; location sharing is off', { value: env.LOCATION_PORT });
    return null;
  }
  const pool = new Pool({ connectionString: databaseUrlFromEnv(env), max: 3 });
  const server = http.createServer(createLocationHandler(pgMemberStore(pool)));
  server.requestTimeout = 15_000;
  server.on('error', (err) => log('error', 'Location server stopped', { err: err.message }));
  server.listen(port, env.HOSTNAME || '0.0.0.0', () => log('info', 'Listening for locations', { port }));
  return server;
}
