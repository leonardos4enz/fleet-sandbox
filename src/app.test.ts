import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addTodo, app, resetTodos } from './app.js';

// La versión esperada se lee del package.json real, no se escribe a mano,
// para que el test siga siendo cierto cuando se suba la versión.
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

// Cada test parte de un estado limpio: nada depende del orden ni de otros tests.
beforeEach(() => {
  resetTodos();
});

const postTodo = (body: string): Promise<Response> =>
  fetch(`${base}/todos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

const getTodos = async (): Promise<Array<{ id: number; title: string; done: boolean }>> => {
  const res = await fetch(`${base}/todos`);
  expect(res.status).toBe(200);
  return (await res.json()) as Array<{ id: number; title: string; done: boolean }>;
};

describe('app', () => {
  it('GET /health responde ok', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('rutas desconocidas devuelven 404', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });
});

describe('version', () => {
  it('GET /version devuelve la versión de package.json', async () => {
    const res = await fetch(`${base}/version`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: packageJson.version });
  });
});

describe('resetTodos', () => {
  it('vacía las tareas y reinicia el contador de ids', async () => {
    addTodo('Primera');
    addTodo('Segunda');

    resetTodos();

    expect(await getTodos()).toEqual([]);

    const res = await postTodo(JSON.stringify({ title: 'Después del reset' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number };
    expect(body.id).toBe(1);
  });
});

describe('stats sin tareas', () => {
  it('GET /stats devuelve total, done y pending en cero', async () => {
    const res = await fetch(`${base}/stats`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 0, done: 0, pending: 0 });
  });
});

describe('todos', () => {
  it('GET /todos devuelve un arreglo vacío al inicio', async () => {
    const res = await fetch(`${base}/todos`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('POST /todos crea una tarea y responde 201', async () => {
    const res = await postTodo(JSON.stringify({ title: 'Comprar pan' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number; title: string; done: boolean };
    expect(body.title).toBe('Comprar pan');
    expect(body.done).toBe(false);
    expect(typeof body.id).toBe('number');
  });

  it('GET /todos devuelve las tareas creadas', async () => {
    await postTodo(JSON.stringify({ title: 'Comprar pan' }));

    const body = await getTodos();

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ title: 'Comprar pan', done: false });
  });

  it('POST /todos con title vacío responde 400 invalid_title', async () => {
    const res = await postTodo(JSON.stringify({ title: '' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_title' });
  });

  it('POST /todos sin title responde 400 invalid_title', async () => {
    const res = await postTodo(JSON.stringify({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_title' });
  });

  it('POST /todos con body inválido responde 400 invalid_title', async () => {
    const res = await postTodo('{no es json');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_title' });
  });

  it('POST /todos con title que no es string responde 400 invalid_title', async () => {
    const res = await postTodo(JSON.stringify({ title: 42 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_title' });
  });

  it('las peticiones inválidas no crean tareas', async () => {
    await postTodo(JSON.stringify({ title: 'Comprar pan' }));
    await postTodo(JSON.stringify({ title: '' }));
    await postTodo(JSON.stringify({}));
    await postTodo('{no es json');
    await postTodo(JSON.stringify({ title: 42 }));

    const body = await getTodos();

    expect(body).toHaveLength(1);
    expect(body[0]?.title).toBe('Comprar pan');
  });
});

describe('filtrado de tareas por done', () => {
  it('GET /todos?done=true devuelve solo las tareas con done=true', async () => {
    addTodo('Tarea completada', true);
    addTodo('Tarea pendiente', false);

    const res = await fetch(`${base}/todos?done=true`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; done: boolean }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ title: 'Tarea completada', done: true });
  });

  it('GET /todos?done=false devuelve solo las tareas con done=false', async () => {
    addTodo('Tarea completada', true);
    addTodo('Tarea pendiente', false);

    const res = await fetch(`${base}/todos?done=false`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; done: boolean }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((todo) => todo.done === false)).toBe(true);
    expect(body.map((todo) => todo.title)).toContain('Tarea pendiente');
    expect(body.map((todo) => todo.title)).not.toContain('Tarea completada');
  });

  it('GET /todos sin parámetro sigue devolviendo todas las tareas', async () => {
    addTodo('Tarea completada', true);
    addTodo('Tarea pendiente', false);

    const res = await fetch(`${base}/todos`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; done: boolean }>;
    const titles = body.map((todo) => todo.title);
    expect(titles).toContain('Tarea pendiente');
    expect(titles).toContain('Tarea completada');
  });

  it('GET /todos?done=otracosa responde 400 invalid_done', async () => {
    const res = await fetch(`${base}/todos?done=otracosa`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_done' });
  });
});

describe('última tarea', () => {
  it('GET /todos/latest responde 404 no_todos cuando no hay tareas', async () => {
    const res = await fetch(`${base}/todos/latest`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_todos' });
  });

  it('GET /todos/latest devuelve la tarea creada más recientemente', async () => {
    await postTodo(JSON.stringify({ title: 'Primera' }));
    await postTodo(JSON.stringify({ title: 'Segunda' }));
    await postTodo(JSON.stringify({ title: 'Tercera' }));

    const res = await fetch(`${base}/todos/latest`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number; title: string; done: boolean };
    expect(body.title).toBe('Tercera');
    expect(body.done).toBe(false);

    const todos = await getTodos();
    expect(body.id).toBe(todos[todos.length - 1]?.id);
  });

  it('GET /todos/latest devuelve la única tarea cuando solo hay una', async () => {
    await postTodo(JSON.stringify({ title: 'Única' }));

    const res = await fetch(`${base}/todos/latest`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: 'Única', done: false });
  });
});

describe('stats con tareas', () => {
  it('GET /stats cuenta las tareas creadas con POST /todos', async () => {
    await postTodo(JSON.stringify({ title: 'Tarea pendiente A' }));
    await postTodo(JSON.stringify({ title: 'Tarea pendiente B' }));
    addTodo('Tarea completada', true);

    const res = await fetch(`${base}/stats`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 3, done: 1, pending: 2 });
  });

  it('GET /stats coincide con el total de tareas listadas en GET /todos', async () => {
    await postTodo(JSON.stringify({ title: 'Tarea pendiente A' }));
    await postTodo(JSON.stringify({ title: 'Tarea pendiente B' }));
    addTodo('Tarea completada', true);

    const todos = await getTodos();
    const statsRes = await fetch(`${base}/stats`);
    const stats = (await statsRes.json()) as { total: number; done: number; pending: number };
    expect(stats.total).toBe(todos.length);
    expect(stats.done).toBe(todos.filter((todo) => todo.done).length);
    expect(stats.pending).toBe(todos.filter((todo) => !todo.done).length);
  });
});
