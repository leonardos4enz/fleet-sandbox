import type { IncomingMessage, ServerResponse } from 'node:http';

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export type Todo = {
  id: number;
  title: string;
  done: boolean;
};

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const todos: Todo[] = [];
let nextTodoId = 1;

const readBody = async (req: IncomingMessage): Promise<string> => {
  req.setEncoding('utf8');
  let body = '';
  for await (const chunk of req) {
    body += String(chunk);
  }
  return body;
};

// Devuelve el title si el body es un JSON válido con un title no vacío,
// o null en cualquier otro caso (body inválido, ausente, vacío o no string).
const parseTitle = async (req: IncomingMessage): Promise<string | null> => {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const { title } = parsed as Record<string, unknown>;
  if (typeof title !== 'string') return null;

  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const createTodo = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const title = await parseTitle(req);
  if (title === null) {
    json(res, 400, { error: 'invalid_title' });
    return;
  }

  const todo: Todo = { id: nextTodoId, title, done: false };
  nextTodoId += 1;
  todos.push(todo);
  json(res, 201, todo);
};

const routes: Record<string, Handler> = {
  'GET /health': (_req, res) => json(res, 200, { status: 'ok' }),
  'GET /todos': (_req, res) => json(res, 200, todos),
  'POST /todos': (req, res) => {
    void createTodo(req, res);
  },
};

export const app: Handler = (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const route = routes[`${req.method ?? 'GET'} ${path}`];
  if (route) route(req, res);
  else json(res, 404, { error: 'not_found' });
};
