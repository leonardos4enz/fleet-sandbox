import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addTodo, app } from './app.js';

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const postTodo = (body: string): Promise<Response> =>
  fetch(`${base}/todos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

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
    const res = await fetch(`${base}/todos`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: number; title: string; done: boolean }>;
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
    const res = await fetch(`${base}/todos`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.title).toBe('Comprar pan');
  });
});

describe('filtrado de tareas por done', () => {
  beforeAll(() => {
    addTodo('Tarea completada', true);
  });

  it('GET /todos?done=true devuelve solo las tareas con done=true', async () => {
    const res = await fetch(`${base}/todos?done=true`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; done: boolean }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ title: 'Tarea completada', done: true });
  });

  it('GET /todos?done=false devuelve solo las tareas con done=false', async () => {
    const res = await fetch(`${base}/todos?done=false`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; done: boolean }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((todo) => todo.done === false)).toBe(true);
    expect(body.map((todo) => todo.title)).toContain('Comprar pan');
    expect(body.map((todo) => todo.title)).not.toContain('Tarea completada');
  });

  it('GET /todos sin parámetro sigue devolviendo todas las tareas', async () => {
    const res = await fetch(`${base}/todos`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; done: boolean }>;
    const titles = body.map((todo) => todo.title);
    expect(titles).toContain('Comprar pan');
    expect(titles).toContain('Tarea completada');
  });

  it('GET /todos?done=otracosa responde 400 invalid_done', async () => {
    const res = await fetch(`${base}/todos?done=otracosa`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_done' });
  });
});

describe('stats con tareas', () => {
  beforeAll(async () => {
    await postTodo(JSON.stringify({ title: 'Tarea pendiente A' }));
    await postTodo(JSON.stringify({ title: 'Tarea pendiente B' }));
  });

  it('GET /stats cuenta las tareas creadas con POST /todos', async () => {
    const res = await fetch(`${base}/stats`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 4, done: 1, pending: 3 });
  });

  it('GET /stats coincide con el total de tareas listadas en GET /todos', async () => {
    const res = await fetch(`${base}/todos`);
    expect(res.status).toBe(200);
    const todos = (await res.json()) as Array<{ done: boolean }>;
    const statsRes = await fetch(`${base}/stats`);
    const stats = (await statsRes.json()) as { total: number; done: number; pending: number };
    expect(stats.total).toBe(todos.length);
    expect(stats.done).toBe(todos.filter((todo) => todo.done).length);
    expect(stats.pending).toBe(todos.filter((todo) => !todo.done).length);
  });
});
