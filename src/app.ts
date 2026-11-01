import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export type Todo = {
  id: number;
  title: string;
  done: boolean;
};

// La versión viene del package.json real: `<raíz>/package.json`, que es un
// nivel por encima tanto de `src/` (código fuente) como de `dist/` (build).
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

const version: string = packageJson.version;

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const todos: Todo[] = [];
let nextTodoId = 1;

export const addTodo = (title: string, done = false): Todo => {
  const todo: Todo = { id: nextTodoId, title, done };
  nextTodoId += 1;
  todos.push(todo);
  return todo;
};

// Vacía el estado en memoria y reinicia la numeración de ids.
// Solo para tests: cada test debe partir de un estado limpio.
export const resetTodos = (): void => {
  todos.length = 0;
  nextTodoId = 1;
};

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

  const todo = addTodo(title);
  json(res, 201, todo);
};

// Devuelve undefined si no viene el parámetro `done`, el booleano a filtrar
// si vale "true" o "false", y 'invalid' en cualquier otro caso.
const parseDone = (url: URL): boolean | 'invalid' | undefined => {
  const raw = url.searchParams.get('done');
  if (raw === null) return undefined;
  if (raw !== 'true' && raw !== 'false') return 'invalid';
  return raw === 'true';
};

// Devuelve undefined si no viene el parámetro `q` o viene vacío (solo
// espacios), y el texto de búsqueda en minúsculas en cualquier otro caso.
const parseQuery = (url: URL): string | undefined => {
  const raw = url.searchParams.get('q');
  if (raw === null) return undefined;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
};

// Máximo de tareas que se pueden pedir con `limit`.
const MAX_LIMIT = 100;

type Pagination = {
  limit: number | null;
  offset: number;
};

// Devuelve el número si el texto es un entero >= 0, y null en cualquier
// otro caso (no numérico, con decimales, negativo o fuera del rango seguro).
const parseNonNegativeInt = (raw: string): number | null => {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
};

// Devuelve 'invalid' si `limit` o `offset` no son enteros >= 0 (o si `limit`
// supera el máximo permitido); si no, los valores ya validados.
const parsePagination = (url: URL): Pagination | 'invalid' => {
  const limitRaw = url.searchParams.get('limit');
  const offsetRaw = url.searchParams.get('offset');

  let limit: number | null = null;
  if (limitRaw !== null) {
    const parsed = parseNonNegativeInt(limitRaw);
    if (parsed === null || parsed > MAX_LIMIT) return 'invalid';
    limit = parsed;
  }

  let offset = 0;
  if (offsetRaw !== null) {
    const parsed = parseNonNegativeInt(offsetRaw);
    if (parsed === null) return 'invalid';
    offset = parsed;
  }

  return { limit, offset };
};

const listTodos = (req: IncomingMessage, res: ServerResponse): void => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const done = parseDone(url);
  const q = parseQuery(url);

  if (done === 'invalid') {
    json(res, 400, { error: 'invalid_done' });
    return;
  }

  const pagination = parsePagination(url);

  if (pagination === 'invalid') {
    json(res, 400, { error: 'invalid_pagination' });
    return;
  }

  let result = todos;
  if (done !== undefined) {
    result = result.filter((todo) => todo.done === done);
  }
  if (q !== undefined) {
    result = result.filter((todo) => todo.title.toLowerCase().includes(q));
  }

  const { limit, offset } = pagination;
  const end = limit === null ? undefined : offset + limit;

  json(res, 200, result.slice(offset, end));
};

const deleteAllTodos = (_req: IncomingMessage, res: ServerResponse): void => {
  const deleted = todos.length;
  todos.length = 0;
  json(res, 200, { deleted });
};

const getStats = (_req: IncomingMessage, res: ServerResponse): void => {
  const total = todos.length;
  const done = todos.filter((todo) => todo.done).length;
  json(res, 200, { total, done, pending: total - done });
};

// Devuelve la tarea creada más recientemente.
// Las tareas se guardan en orden de creación, así que la última es la más reciente.
const getLatestTodo = (_req: IncomingMessage, res: ServerResponse): void => {
  const latest = todos[todos.length - 1];
  if (!latest) {
    json(res, 404, { error: 'no_todos' });
    return;
  }

  json(res, 200, latest);
};

const routes: Record<string, Handler> = {
  'GET /health': (_req, res) => json(res, 200, { status: 'ok' }),
  'GET /version': (_req, res) => json(res, 200, { version }),
  'GET /todos': (req, res) => listTodos(req, res),
  'GET /todos/latest': (_req, res) => getLatestTodo(_req, res),
  'GET /stats': (req, res) => getStats(req, res),
  'POST /todos': (req, res) => {
    void createTodo(req, res);
  },
  'DELETE /todos': (req, res) => deleteAllTodos(req, res),
};

export const app: Handler = (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const route = routes[`${req.method ?? 'GET'} ${path}`];
  if (route) route(req, res);
  else json(res, 404, { error: 'not_found' });
};
