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

describe('paginación de tareas', () => {
  it('GET /todos?limit=2&offset=1 devuelve como máximo 2 tareas empezando en la segunda', async () => {
    addTodo('Primera');
    addTodo('Segunda');
    addTodo('Tercera');

    const res = await fetch(`${base}/todos?limit=2&offset=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    expect(body.map((todo) => todo.title)).toEqual(['Segunda', 'Tercera']);
  });

  it('GET /todos?limit=1 devuelve solo la primera tarea', async () => {
    addTodo('Primera');
    addTodo('Segunda');

    const res = await fetch(`${base}/todos?limit=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    expect(body.map((todo) => todo.title)).toEqual(['Primera']);
  });

  it('GET /todos?offset=2 salta las dos primeras tareas', async () => {
    addTodo('Primera');
    addTodo('Segunda');
    addTodo('Tercera');

    const res = await fetch(`${base}/todos?offset=2`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    expect(body.map((todo) => todo.title)).toEqual(['Tercera']);
  });

  it('sin limit ni offset devuelve todas las tareas', async () => {
    addTodo('Primera');
    addTodo('Segunda');
    addTodo('Tercera');

    const body = await getTodos();
    expect(body.map((todo) => todo.title)).toEqual(['Primera', 'Segunda', 'Tercera']);
  });

  it('la paginación se combina con el filtro done', async () => {
    addTodo('Completada A', true);
    addTodo('Pendiente A');
    addTodo('Completada B', true);

    const res = await fetch(`${base}/todos?done=true&limit=1&offset=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; done: boolean }>;
    expect(body.map((todo) => todo.title)).toEqual(['Completada B']);
  });

  it('un offset mayor que la cantidad de tareas devuelve un arreglo vacío', async () => {
    addTodo('Primera');

    const res = await fetch(`${base}/todos?limit=2&offset=5`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it.each([
    ['limit no numérico', 'limit=abc'],
    ['limit decimal', 'limit=1.5'],
    ['limit negativo', 'limit=-1'],
    ['limit mayor que 100', 'limit=101'],
    ['offset no numérico', 'offset=abc'],
    ['offset decimal', 'offset=1.5'],
    ['offset negativo', 'offset=-1'],
  ])('%s responde 400 invalid_pagination', async (_caso, query) => {
    const res = await fetch(`${base}/todos?${query}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_pagination' });
  });

  it('limit=100 es válido', async () => {
    const res = await fetch(`${base}/todos?limit=100`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe('búsqueda de tareas por texto', () => {
  it('GET /todos?q=pan devuelve solo las tareas cuyo título contiene "pan"', async () => {
    addTodo('Comprar pan');
    addTodo('Hacer tortillas');
    addTodo('Comprar leche');

    const res = await fetch(`${base}/todos?q=pan`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ title: 'Comprar pan' });
  });

  it('GET /todos?q=busca sin distinguir mayúsculas', async () => {
    addTodo('Comprar PAN');
    addTodo('Pan integral');
    addTodo('Comprar leche');

    const res = await fetch(`${base}/todos?q=pan`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    expect(body.map((todo) => todo.title).sort()).toEqual(['Comprar PAN', 'Pan integral']);
  });

  it('GET /todos?q=combina con el filtro done', async () => {
    addTodo('Comprar pan', true);
    addTodo('Pan para la cena', false);
    addTodo('Comprar leche', false);

    const res = await fetch(`${base}/todos?q=pan&done=false`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; done: boolean }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ title: 'Pan para la cena', done: false });
  });

  it('GET /todos?q=vacío se comporta como si no viniera', async () => {
    addTodo('Comprar pan');
    addTodo('Comprar leche');

    const res = await fetch(`${base}/todos?q=`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    expect(body.map((todo) => todo.title).sort()).toEqual(['Comprar leche', 'Comprar pan']);
  });

  it('GET /todos?q=sin resultados devuelve un arreglo vacío', async () => {
    addTodo('Comprar pan');

    const res = await fetch(`${base}/todos?q=zzz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('la búsqueda se combina con la paginación: el limit cuenta sobre las coincidencias', async () => {
    addTodo('Comprar pan');
    addTodo('Hacer pan');
    addTodo('Comprar leche');

    const res = await fetch(`${base}/todos?q=pan&limit=1&offset=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    expect(body.map((todo) => todo.title)).toEqual(['Hacer pan']);
  });
});

describe('DELETE /todos', () => {
  it('borra todas las tareas y responde 200 con la cantidad borrada', async () => {
    addTodo('Primera');
    addTodo('Segunda');
    addTodo('Tercera');

    const res = await fetch(`${base}/todos`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 3 });
  });

  it('después de borrar, GET /todos devuelve []', async () => {
    addTodo('Primera');
    addTodo('Segunda');

    const res = await fetch(`${base}/todos`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    expect(await getTodos()).toEqual([]);
  });

  it('borrar sin tareas responde 200 con deleted 0', async () => {
    const res = await fetch(`${base}/todos`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 0 });
    expect(await getTodos()).toEqual([]);
  });

  it('las tareas borradas no reaparecen en GET /stats', async () => {
    addTodo('Tarea completada', true);
    addTodo('Tarea pendiente');

    await fetch(`${base}/todos`, { method: 'DELETE' });

    const res = await fetch(`${base}/stats`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 0, done: 0, pending: 0 });
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

describe('GET /todos/:id', () => {
  it('devuelve la tarea con ese id', async () => {
    const first = addTodo('Primera');
    const second = addTodo('Segunda');

    const res = await fetch(`${base}/todos/${second.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(second);
    expect(second.id).not.toBe(first.id);
  });

  it('devuelve la tarea correcta entre varias', async () => {
    addTodo('Primera');
    const target = addTodo('Segunda');
    addTodo('Tercera');

    const res = await fetch(`${base}/todos/${target.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: target.id, title: 'Segunda', done: false });
  });

  it('responde 404 not_found si no existe la tarea', async () => {
    addTodo('Primera');

    const res = await fetch(`${base}/todos/999`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('responde 400 invalid_id si el id no es un entero positivo', async () => {
    const res = await fetch(`${base}/todos/abc`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_id' });
  });

  it('responde 400 invalid_id con id cero o negativo', async () => {
    const zero = await fetch(`${base}/todos/0`);
    expect(zero.status).toBe(400);
    expect(await zero.json()).toEqual({ error: 'invalid_id' });

    const negative = await fetch(`${base}/todos/-1`);
    expect(negative.status).toBe(400);
    expect(await negative.json()).toEqual({ error: 'invalid_id' });
  });

  it('responde 400 invalid_id con id decimal', async () => {
    const res = await fetch(`${base}/todos/1.5`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_id' });
  });

  it('responde 400 invalid_id con id vacío', async () => {
    const res = await fetch(`${base}/todos/`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_id' });
  });

  it('responde 400 invalid_id con id mal codificado', async () => {
    const res = await fetch(`${base}/todos/%zz`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_id' });
  });

  it('GET /todos/latest sigue devolviendo la última tarea y no un 400', async () => {
    await postTodo(JSON.stringify({ title: 'Primera' }));
    await postTodo(JSON.stringify({ title: 'Segunda' }));

    const res = await fetch(`${base}/todos/latest`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: 'Segunda', done: false });
  });

  it('las rutas exactas siguen funcionando', async () => {
    addTodo('Primera');

    expect((await fetch(`${base}/todos`)).status).toBe(200);
    expect((await fetch(`${base}/stats`)).status).toBe(200);
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});

describe('PATCH /todos/:id', () => {
  const patchTodo = (id: number | string, body: string): Promise<Response> =>
    fetch(`${base}/todos/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body,
    });

  it('actualiza el título y responde 200 con la tarea actualizada', async () => {
    const todo = addTodo('Título viejo');

    const res = await patchTodo(todo.id, JSON.stringify({ title: 'Título nuevo' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: todo.id, title: 'Título nuevo', done: false });
  });

  it('actualiza el estado done y responde 200 con la tarea actualizada', async () => {
    const todo = addTodo('Tarea');

    const res = await patchTodo(todo.id, JSON.stringify({ done: true }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: todo.id, title: 'Tarea', done: true });
  });

  it('actualiza el título y el estado a la vez', async () => {
    const todo = addTodo('Título viejo');

    const res = await patchTodo(todo.id, JSON.stringify({ title: 'Título nuevo', done: true }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: todo.id, title: 'Título nuevo', done: true });
  });

  it('el cambio se ve después en GET /todos/:id', async () => {
    const todo = addTodo('Título viejo');

    await patchTodo(todo.id, JSON.stringify({ title: 'Título nuevo', done: true }));

    const res = await fetch(`${base}/todos/${todo.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: todo.id, title: 'Título nuevo', done: true });
  });

  it('ignora los campos desconocidos', async () => {
    const todo = addTodo('Tarea');

    const res = await patchTodo(todo.id, JSON.stringify({ done: true, extra: 'ignorado' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: todo.id, title: 'Tarea', done: true });
  });

  it('con title vacío responde 400 invalid_body', async () => {
    const todo = addTodo('Tarea');

    const res = await patchTodo(todo.id, JSON.stringify({ title: '' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_body' });
  });

  it('con title de tipo incorrecto responde 400 invalid_body', async () => {
    const todo = addTodo('Tarea');

    const res = await patchTodo(todo.id, JSON.stringify({ title: 42 }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_body' });
  });

  it('con done que no es booleano responde 400 invalid_body', async () => {
    const todo = addTodo('Tarea');

    const res = await patchTodo(todo.id, JSON.stringify({ done: 'sí' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_body' });
  });

  it('sin ningún campo válido responde 400 invalid_body', async () => {
    const todo = addTodo('Tarea');

    const res = await patchTodo(todo.id, JSON.stringify({ desconocido: 1 }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_body' });
  });

  it('con body vacío responde 400 invalid_body', async () => {
    const todo = addTodo('Tarea');

    const res = await patchTodo(todo.id, JSON.stringify({}));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_body' });
  });

  it('con body que no es JSON responde 400 invalid_body', async () => {
    const todo = addTodo('Tarea');

    const res = await patchTodo(todo.id, '{no es json');

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_body' });
  });

  it('un body inválido no modifica la tarea', async () => {
    const todo = addTodo('Tarea');

    await patchTodo(todo.id, JSON.stringify({ title: '' }));

    const res = await fetch(`${base}/todos/${todo.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: todo.id, title: 'Tarea', done: false });
  });

  it('responde 404 not_found si no existe la tarea', async () => {
    addTodo('Primera');

    const res = await patchTodo(999, JSON.stringify({ title: 'Título nuevo' }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('responde 400 invalid_id si el id no es un entero positivo', async () => {
    const res = await patchTodo('abc', JSON.stringify({ title: 'Título nuevo' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_id' });
  });

  it('GET /stats refleja el cambio de done', async () => {
    const todo = addTodo('Tarea pendiente');

    await patchTodo(todo.id, JSON.stringify({ done: true }));

    const res = await fetch(`${base}/stats`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 1, done: 1, pending: 0 });
  });

  it('GET /stats refleja volver a dejar la tarea pendiente', async () => {
    const todo = addTodo('Tarea completada', true);

    await patchTodo(todo.id, JSON.stringify({ done: false }));

    const res = await fetch(`${base}/stats`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 1, done: 0, pending: 1 });
  });
});

describe('DELETE /todos/:id', () => {
  it('borra la tarea y responde 204 sin cuerpo', async () => {
    const target = addTodo('Se borra');

    const res = await fetch(`${base}/todos/${target.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('después de borrar, GET /todos/:id responde 404 not_found', async () => {
    const target = addTodo('Se borra');

    await fetch(`${base}/todos/${target.id}`, { method: 'DELETE' });

    const res = await fetch(`${base}/todos/${target.id}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('después de borrar, la tarea no aparece en GET /todos', async () => {
    const kept = addTodo('Se queda');
    const removed = addTodo('Se borra');

    await fetch(`${base}/todos/${removed.id}`, { method: 'DELETE' });

    const body = await getTodos();
    expect(body.map((todo) => todo.title)).toEqual(['Se queda']);
    expect(body[0]?.id).toBe(kept.id);
  });

  it('responde 404 not_found si no existe la tarea', async () => {
    addTodo('Primera');

    const res = await fetch(`${base}/todos/999`, { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('responde 400 invalid_id si el id no es un entero positivo', async () => {
    const res = await fetch(`${base}/todos/abc`, { method: 'DELETE' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_id' });
  });

  it('responde 400 invalid_id con id cero, negativo o decimal', async () => {
    for (const id of ['0', '-1', '1.5']) {
      const res = await fetch(`${base}/todos/${id}`, { method: 'DELETE' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_id' });
    }
  });

  it('un id inválido no borra ninguna tarea', async () => {
    addTodo('Se queda');

    await fetch(`${base}/todos/abc`, { method: 'DELETE' });

    expect(await getTodos()).toHaveLength(1);
  });

  it('DELETE /todos sigue borrando todas las tareas', async () => {
    addTodo('Primera');
    addTodo('Segunda');

    const res = await fetch(`${base}/todos`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2 });
    expect(await getTodos()).toEqual([]);
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
