import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Parámetros capturados por la ruta, p. ej. `{ id: '3' }` para `GET /todos/:id`.
export type RouteParams = Record<string, string>;

export type Handler = (req: IncomingMessage, res: ServerResponse, params: RouteParams) => void;

// Prioridades válidas, de menor a mayor.
const PRIORITIES = ['low', 'medium', 'high'] as const;

export type Priority = (typeof PRIORITIES)[number];

const DEFAULT_PRIORITY: Priority = 'medium';

export type Todo = {
  id: number;
  title: string;
  done: boolean;
  priority: Priority;
};

// Indica si el valor es una de las prioridades válidas.
const isPriority = (value: unknown): value is Priority =>
  typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value);

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

// Un 204 no admite cuerpo: solo se envía el status.
const noContent = (res: ServerResponse): void => {
  res.writeHead(204);
  res.end();
};

const todos: Todo[] = [];
let nextTodoId = 1;

export const addTodo = (
  title: string,
  done = false,
  priority: Priority = DEFAULT_PRIORITY,
): Todo => {
  const todo: Todo = { id: nextTodoId, title, done, priority };
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

// Title y priority leídos del body. El title es null si no es válido.
// La priority es la prioridad pedida, la de por defecto si no viene, o
// 'invalid' si viene con un valor que no es una prioridad válida.
type ParsedBody = {
  title: string | null;
  priority: Priority | 'invalid';
};

// Devuelve el title si el body es un JSON válido con un title no vacío,
// o null en cualquier otro caso (body inválido, ausente, vacío o no string).
// La priority es opcional: si no viene, se usa la de por defecto.
const parseBody = async (req: IncomingMessage): Promise<ParsedBody> => {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    return { title: null, priority: DEFAULT_PRIORITY };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { title: null, priority: DEFAULT_PRIORITY };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { title: null, priority: DEFAULT_PRIORITY };
  }

  const { title, priority } = parsed as Record<string, unknown>;

  let parsedPriority: Priority | 'invalid' = DEFAULT_PRIORITY;
  if (priority !== undefined) {
    parsedPriority = isPriority(priority) ? priority : 'invalid';
  }

  if (typeof title !== 'string') return { title: null, priority: parsedPriority };

  const trimmed = title.trim();
  return { title: trimmed.length > 0 ? trimmed : null, priority: parsedPriority };
};

const createTodo = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const { title, priority } = await parseBody(req);
  if (title === null) {
    json(res, 400, { error: 'invalid_title' });
    return;
  }
  if (priority === 'invalid') {
    json(res, 400, { error: 'invalid_priority' });
    return;
  }

  const todo = addTodo(title, false, priority);
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

// Devuelve undefined si no viene el parámetro `priority`, la prioridad a
// filtrar si vale "low", "medium" o "high", y 'invalid' en cualquier otro caso.
const parsePriority = (url: URL): Priority | 'invalid' | undefined => {
  const raw = url.searchParams.get('priority');
  if (raw === null) return undefined;
  return isPriority(raw) ? raw : 'invalid';
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
  const priority = parsePriority(url);

  if (done === 'invalid') {
    json(res, 400, { error: 'invalid_done' });
    return;
  }

  if (priority === 'invalid') {
    json(res, 400, { error: 'invalid_priority' });
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
  if (priority !== undefined) {
    result = result.filter((todo) => todo.priority === priority);
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

// Devuelve el id como entero positivo, o null si no lo es.
// Solo se aceptan dígitos: "0", "-1", "1.5", "abc" o "" no son ids válidos.
const parseTodoId = (raw: string): number | null => {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const getTodoById = (params: RouteParams, res: ServerResponse): void => {
  const id = parseTodoId(params['id'] ?? '');
  if (id === null) {
    json(res, 400, { error: 'invalid_id' });
    return;
  }

  const todo = todos.find((candidate) => candidate.id === id);
  if (!todo) {
    json(res, 404, { error: 'not_found' });
    return;
  }

  json(res, 200, todo);
};

// Campos que se pueden cambiar con PATCH /todos/:id. Los ausentes no se tocan.
type TodoPatch = {
  title?: string;
  done?: boolean;
};

// Devuelve los campos a cambiar si el body es un JSON válido con al menos un
// campo editable válido (`title` string no vacío o `done` booleano), o null en
// cualquier otro caso (body inválido, ausente, vacío, sin campos editables o
// con un `title`/`done` de tipo incorrecto). Los campos desconocidos se ignoran.
const parsePatch = async (req: IncomingMessage): Promise<TodoPatch | null> => {
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

  const body = parsed as Record<string, unknown>;
  const patch: TodoPatch = {};

  if ('title' in body) {
    const title = body['title'];
    if (typeof title !== 'string') return null;
    const trimmed = title.trim();
    if (trimmed.length === 0) return null;
    patch.title = trimmed;
  }

  if ('done' in body) {
    const done = body['done'];
    if (typeof done !== 'boolean') return null;
    patch.done = done;
  }

  if (patch.title === undefined && patch.done === undefined) return null;

  return patch;
};

const patchTodo = async (
  req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
): Promise<void> => {
  const id = parseTodoId(params['id'] ?? '');
  if (id === null) {
    json(res, 400, { error: 'invalid_id' });
    return;
  }

  const patch = await parsePatch(req);
  if (patch === null) {
    json(res, 400, { error: 'invalid_body' });
    return;
  }

  const todo = todos.find((candidate) => candidate.id === id);
  if (!todo) {
    json(res, 404, { error: 'not_found' });
    return;
  }

  if (patch.title !== undefined) todo.title = patch.title;
  if (patch.done !== undefined) todo.done = patch.done;

  json(res, 200, todo);
};

const deleteTodoById = (params: RouteParams, res: ServerResponse): void => {
  const id = parseTodoId(params['id'] ?? '');
  if (id === null) {
    json(res, 400, { error: 'invalid_id' });
    return;
  }

  const index = todos.findIndex((candidate) => candidate.id === id);
  if (index === -1) {
    json(res, 404, { error: 'not_found' });
    return;
  }

  todos.splice(index, 1);
  noContent(res);
};

const routes: Record<string, Handler> = {
  'GET /health': (_req, res) => json(res, 200, { status: 'ok' }),
  'GET /version': (_req, res) => json(res, 200, { version }),
  'GET /todos': (req, res) => listTodos(req, res),
  'GET /todos/latest': (_req, res) => getLatestTodo(_req, res),
  'GET /todos/:id': (_req, res, params) => getTodoById(params, res),
  'PATCH /todos/:id': (req, res, params) => {
    void patchTodo(req, res, params);
  },
  'GET /stats': (req, res) => getStats(req, res),
  'POST /todos': (req, res) => {
    void createTodo(req, res);
  },
  'DELETE /todos': (req, res) => deleteAllTodos(req, res),
  'DELETE /todos/:id': (_req, res, params) => deleteTodoById(params, res),
};

// Un segmento de ruta que empieza por `:` captura el valor de ese parámetro.
const PARAM_PREFIX = ':';

// Decodifica un segmento capturado. Si el escape es inválido se devuelve el
// texto tal cual, para que lo rechace la validación del parámetro.
const decodeSegment = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

// Busca la ruta que corresponde al verbo HTTP y al camino pedido. Las rutas
// exactas ganan siempre sobre las que tienen parámetros, así que
// `/todos/latest` no se confunde con `/todos/:id`.
const matchRoute = (
  method: string,
  path: string,
): { handler: Handler; params: RouteParams } | null => {
  const exact = routes[`${method} ${path}`];
  if (exact) return { handler: exact, params: {} };

  const pathSegments = path.split('/');

  for (const [routeKey, handler] of Object.entries(routes)) {
    const separator = routeKey.indexOf(' ');
    const routeMethod = routeKey.slice(0, separator);
    const routeSegments = routeKey.slice(separator + 1).split('/');
    if (routeMethod !== method) continue;
    if (routeSegments.length !== pathSegments.length) continue;

    const params: RouteParams = {};
    let matched = true;

    for (let index = 0; index < routeSegments.length; index += 1) {
      const routeSegment = routeSegments[index] ?? '';
      const pathSegment = pathSegments[index] ?? '';

      if (routeSegment.startsWith(PARAM_PREFIX)) {
        params[routeSegment.slice(PARAM_PREFIX.length)] = decodeSegment(pathSegment);
      } else if (routeSegment !== pathSegment) {
        matched = false;
        break;
      }
    }

    if (matched) return { handler, params };
  }

  return null;
};

export const app = (req: IncomingMessage, res: ServerResponse): void => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const match = matchRoute(req.method ?? 'GET', path);
  if (match) match.handler(req, res, match.params);
  else json(res, 404, { error: 'not_found' });
};
