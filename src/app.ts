import type { IncomingMessage, ServerResponse } from 'node:http';

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const routes: Record<string, Handler> = {
  'GET /health': (_req, res) => json(res, 200, { status: 'ok' }),
};

export const app: Handler = (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const route = routes[`${req.method ?? 'GET'} ${path}`];
  if (route) route(req, res);
  else json(res, 404, { error: 'not_found' });
};
