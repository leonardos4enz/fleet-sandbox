import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './app.js';

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
