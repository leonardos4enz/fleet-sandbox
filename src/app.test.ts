import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addTodo, app, resetTodos } from './app.js';
import {
  assignLabelToTodo,
  createLabel,
  deleteLabel,
  labelsForTodo,
  resetLabels,
  type Label,
} from './labels.js';

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
  resetLabels();
});

const postTodo = (body: string): Promise<Response> =>
  fetch(`${base}/todos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

const getTodos = async (): Promise<
  Array<{ id: number; title: string; done: boolean; priority: string; labels: unknown[] }>
> => {
  const res = await fetch(`${base}/todos`);
  expect(res.status).toBe(200);
  return (await res.json()) as Array<{
    id: number;
    title: string;
    done: boolean;
    priority: string;
    labels: unknown[];
  }>;
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
    expect(await res.json()).toEqual({ total: 0, done: 0, pending: 0, byLabel: {} });
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
    const body = (await res.json()) as {
      id: number;
      title: string;
      done: boolean;
      priority: string;
    };
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

describe('prioridad de las tareas', () => {
  it('POST /todos sin priority crea la tarea con priority "medium"', async () => {
    const res = await postTodo(JSON.stringify({ title: 'Comprar pan' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { title: string; priority: string };
    expect(body.priority).toBe('medium');
  });

  it.each(['low', 'medium', 'high'])(
    'POST /todos con priority "%s" guarda esa prioridad',
    async (priority) => {
      const res = await postTodo(JSON.stringify({ title: 'Tarea', priority }));
      expect(res.status).toBe(201);
      const body = (await res.json()) as { title: string; priority: string };
      expect(body.priority).toBe(priority);
    },
  );

  it.each([
    ['prioridad desconocida', 'urgent'],
    ['prioridad vacía', ''],
    ['prioridad con mayúsculas', 'HIGH'],
    ['prioridad numérica', 3],
    ['prioridad nula', null],
  ])('POST /todos con %s responde 400 invalid_priority', async (_caso, priority) => {
    const res = await postTodo(JSON.stringify({ title: 'Tarea', priority }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_priority' });
  });

  it('una prioridad inválida no crea la tarea', async () => {
    await postTodo(JSON.stringify({ title: 'Tarea', priority: 'urgent' }));

    expect(await getTodos()).toEqual([]);
  });

  it('GET /todos devuelve la prioridad de cada tarea', async () => {
    await postTodo(JSON.stringify({ title: 'Urgente', priority: 'high' }));
    await postTodo(JSON.stringify({ title: 'Normal' }));

    const body = await getTodos();

    expect(body.map((todo) => todo.priority)).toEqual(['high', 'medium']);
  });

  it('GET /todos/:id devuelve la prioridad de la tarea', async () => {
    const todo = addTodo('Urgente', false, 'high');

    const res = await fetch(`${base}/todos/${todo.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; priority: string };
    expect(body.priority).toBe('high');
  });

  it('GET /todos/latest devuelve la prioridad de la última tarea', async () => {
    await postTodo(JSON.stringify({ title: 'Urgente', priority: 'high' }));

    const res = await fetch(`${base}/todos/latest`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; priority: string };
    expect(body.priority).toBe('high');
  });

  it('GET /todos?priority=high devuelve solo las tareas con priority high', async () => {
    addTodo('Urgente', false, 'high');
    addTodo('Normal', false, 'medium');
    addTodo('Trivial', false, 'low');

    const res = await fetch(`${base}/todos?priority=high`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; priority: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ title: 'Urgente', priority: 'high' });
  });

  it('GET /todos?priority=low devuelve solo las tareas con priority low', async () => {
    addTodo('Urgente', false, 'high');
    addTodo('Normal', false, 'medium');
    addTodo('Trivial', false, 'low');

    const res = await fetch(`${base}/todos?priority=low`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; priority: string }>;
    expect(body.map((todo) => todo.title)).toEqual(['Trivial']);
  });

  it('GET /todos?priority=high se combina con el filtro done', async () => {
    addTodo('Urgente completada', true, 'high');
    addTodo('Urgente pendiente', false, 'high');
    addTodo('Normal completada', true, 'medium');

    const res = await fetch(`${base}/todos?priority=high&done=false`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; priority: string }>;
    expect(body.map((todo) => todo.title)).toEqual(['Urgente pendiente']);
  });

  it('GET /todos?priority=high se combina con la búsqueda por texto', async () => {
    addTodo('Comprar pan', false, 'high');
    addTodo('Comprar leche', false, 'high');
    addTodo('Pan integral', false, 'low');

    const res = await fetch(`${base}/todos?priority=high&q=pan`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; priority: string }>;
    expect(body.map((todo) => todo.title)).toEqual(['Comprar pan']);
  });

  it('GET /todos?priority=high se combina con la paginación', async () => {
    addTodo('Primera', false, 'high');
    addTodo('Segunda', false, 'high');
    addTodo('Tercera', false, 'medium');

    const res = await fetch(`${base}/todos?priority=high&limit=1&offset=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; priority: string }>;
    expect(body.map((todo) => todo.title)).toEqual(['Segunda']);
  });

  it('GET /todos sin priority sigue devolviendo todas las prioridades', async () => {
    addTodo('Urgente', false, 'high');
    addTodo('Trivial', false, 'low');

    const body = await getTodos();

    expect(body.map((todo) => todo.priority)).toEqual(['high', 'low']);
  });

  it('GET /todos?priority=desconocida responde 400 invalid_priority', async () => {
    const res = await fetch(`${base}/todos?priority=urgent`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_priority' });
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

describe('filtrado de tareas por etiqueta', () => {
  // Crea una etiqueta y falla el test si no se pudo crear, para no tener que
  // comprobar el null en cada uso.
  const makeLabel = (name: string, color: string): Label => {
    const label = createLabel(name, color);
    if (label === null) throw new Error(`no se pudo crear la etiqueta ${name}`);
    return label;
  };

  it('GET /todos?label=trabajo devuelve solo las tareas con esa etiqueta', async () => {
    const conEtiqueta = addTodo('Hacer informe');
    const sinEtiqueta = addTodo('Comprar pan');
    const trabajo = makeLabel('trabajo', '#ff0000');
    assignLabelToTodo(conEtiqueta.id, trabajo.id);

    const res = await fetch(`${base}/todos?label=trabajo`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: number; title: string }>;
    expect(body.map((todo) => todo.title)).toEqual(['Hacer informe']);
    expect(body[0]?.id).toBe(conEtiqueta.id);
    expect(body.map((todo) => todo.id)).not.toContain(sinEtiqueta.id);
  });

  it('la tarea filtrada viene con su etiqueta', async () => {
    addTodo('Comprar pan');
    const todo = addTodo('Hacer informe');
    const trabajo = makeLabel('trabajo', '#ff0000');
    assignLabelToTodo(todo.id, trabajo.id);

    const res = await fetch(`${base}/todos?label=trabajo`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; labels: Label[] }>;
    expect(body.map((todo) => todo.title)).toEqual(['Hacer informe']);
    expect(body[0]?.labels).toEqual([{ id: trabajo.id, name: 'trabajo', color: '#ff0000' }]);
  });

  it('GET /todos?label=inexistente responde 200 con un arreglo vacío', async () => {
    const todo = addTodo('Hacer informe');
    const trabajo = makeLabel('trabajo', '#ff0000');
    assignLabelToTodo(todo.id, trabajo.id);

    const res = await fetch(`${base}/todos?label=inexistente`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('GET /todos sin label sigue devolviendo todas las tareas', async () => {
    const conEtiqueta = addTodo('Hacer informe');
    addTodo('Comprar pan');
    const trabajo = makeLabel('trabajo', '#ff0000');
    assignLabelToTodo(conEtiqueta.id, trabajo.id);

    const body = await getTodos();

    expect(body.map((todo) => todo.title)).toEqual(['Hacer informe', 'Comprar pan']);
  });

  it('GET /todos?label= vacío se comporta como si no viniera', async () => {
    const conEtiqueta = addTodo('Hacer informe');
    addTodo('Comprar pan');
    const trabajo = makeLabel('trabajo', '#ff0000');
    assignLabelToTodo(conEtiqueta.id, trabajo.id);

    const res = await fetch(`${base}/todos?label=`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    expect(body.map((todo) => todo.title)).toEqual(['Hacer informe', 'Comprar pan']);
  });

  it('GET /todos?label= con solo espacios se comporta como si no viniera', async () => {
    const conEtiqueta = addTodo('Hacer informe');
    addTodo('Comprar pan');
    const trabajo = makeLabel('trabajo', '#ff0000');
    assignLabelToTodo(conEtiqueta.id, trabajo.id);

    const res = await fetch(`${base}/todos?label=%20%20`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    expect(body.map((todo) => todo.title)).toEqual(['Hacer informe', 'Comprar pan']);
  });

  it('GET /todos?label=trabajo&done=false devuelve solo las pendientes con esa etiqueta', async () => {
    const pendiente = addTodo('Hacer informe', false);
    const completada = addTodo('Enviar informe', true);
    addTodo('Comprar pan', false);
    const trabajo = makeLabel('trabajo', '#ff0000');
    assignLabelToTodo(pendiente.id, trabajo.id);
    assignLabelToTodo(completada.id, trabajo.id);

    const res = await fetch(`${base}/todos?label=trabajo&done=false`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; done: boolean }>;
    expect(body.map((todo) => todo.title)).toEqual(['Hacer informe']);
    expect(body[0]?.done).toBe(false);
  });

  it('GET /todos?label=trabajo&priority=high devuelve solo las de esa prioridad', async () => {
    const urgente = addTodo('Hacer informe', false, 'high');
    const normal = addTodo('Revisar informe', false, 'medium');
    addTodo('Tarea urgente sin etiqueta', false, 'high');
    const trabajo = makeLabel('trabajo', '#ff0000');
    assignLabelToTodo(urgente.id, trabajo.id);
    assignLabelToTodo(normal.id, trabajo.id);

    const res = await fetch(`${base}/todos?label=trabajo&priority=high`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; priority: string }>;
    expect(body.map((todo) => todo.title)).toEqual(['Hacer informe']);
    expect(body[0]?.priority).toBe('high');
  });

  it('GET /todos?label=trabajo&q=pan devuelve solo las de esa etiqueta con ese texto', async () => {
    const conPan = addTodo('Comprar pan para la oficina');
    const sinPan = addTodo('Hacer informe');
    addTodo('Comprar pan');
    const trabajo = makeLabel('trabajo', '#ff0000');
    assignLabelToTodo(conPan.id, trabajo.id);
    assignLabelToTodo(sinPan.id, trabajo.id);

    const res = await fetch(`${base}/todos?label=trabajo&q=pan`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    expect(body.map((todo) => todo.title)).toEqual(['Comprar pan para la oficina']);
  });

  it('GET /todos?label=trabajo&limit=1&offset=1 devuelve la segunda coincidencia', async () => {
    addTodo('Tarea sin etiqueta');
    const primera = addTodo('Hacer informe');
    const segunda = addTodo('Enviar informe');
    const trabajo = makeLabel('trabajo', '#ff0000');
    assignLabelToTodo(primera.id, trabajo.id);
    assignLabelToTodo(segunda.id, trabajo.id);

    const res = await fetch(`${base}/todos?label=trabajo&limit=1&offset=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    expect(body.map((todo) => todo.title)).toEqual(['Enviar informe']);
  });

  it('una tarea con dos etiquetas aparece en el resultado de cada filtro', async () => {
    addTodo('Tarea sin etiqueta');
    const todo = addTodo('Hacer informe');
    const trabajo = makeLabel('trabajo', '#ff0000');
    const casa = makeLabel('casa', '#00ff00');
    assignLabelToTodo(todo.id, trabajo.id);
    assignLabelToTodo(todo.id, casa.id);

    const porTrabajo = await fetch(`${base}/todos?label=trabajo`);
    expect(porTrabajo.status).toBe(200);
    expect(((await porTrabajo.json()) as Array<{ title: string }>).map((todo) => todo.title)).toEqual([
      'Hacer informe',
    ]);

    const porCasa = await fetch(`${base}/todos?label=casa`);
    expect(porCasa.status).toBe(200);
    expect(((await porCasa.json()) as Array<{ title: string }>).map((todo) => todo.title)).toEqual([
      'Hacer informe',
    ]);
  });

  it('el nombre de la etiqueta se compara exactamente', async () => {
    const todo = addTodo('Hacer informe');
    const trabajo = makeLabel('trabajo', '#ff0000');
    assignLabelToTodo(todo.id, trabajo.id);

    const res = await fetch(`${base}/todos?label=Trabajo`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
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
    expect(await res.json()).toEqual({ total: 0, done: 0, pending: 0, byLabel: {} });
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
    expect(await res.json()).toEqual({ ...second, labels: [] });
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
    expect(await res.json()).toEqual({
      id: todo.id,
      title: 'Título nuevo',
      done: false,
      priority: 'medium',
      labels: [],
    });
  });

  it('actualiza el estado done y responde 200 con la tarea actualizada', async () => {
    const todo = addTodo('Tarea');

    const res = await patchTodo(todo.id, JSON.stringify({ done: true }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: todo.id,
      title: 'Tarea',
      done: true,
      priority: 'medium',
      labels: [],
    });
  });

  it('actualiza el título y el estado a la vez', async () => {
    const todo = addTodo('Título viejo');

    const res = await patchTodo(todo.id, JSON.stringify({ title: 'Título nuevo', done: true }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: todo.id,
      title: 'Título nuevo',
      done: true,
      priority: 'medium',
      labels: [],
    });
  });

  it('el cambio se ve después en GET /todos/:id', async () => {
    const todo = addTodo('Título viejo');

    await patchTodo(todo.id, JSON.stringify({ title: 'Título nuevo', done: true }));

    const res = await fetch(`${base}/todos/${todo.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: todo.id,
      title: 'Título nuevo',
      done: true,
      priority: 'medium',
      labels: [],
    });
  });

  it('ignora los campos desconocidos', async () => {
    const todo = addTodo('Tarea');

    const res = await patchTodo(todo.id, JSON.stringify({ done: true, extra: 'ignorado' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: todo.id,
      title: 'Tarea',
      done: true,
      priority: 'medium',
      labels: [],
    });
  });

  it('mantiene la prioridad de la tarea al editarla', async () => {
    const todo = addTodo('Tarea', false, 'high');

    const res = await patchTodo(todo.id, JSON.stringify({ title: 'Título nuevo' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: todo.id,
      title: 'Título nuevo',
      done: false,
      priority: 'high',
      labels: [],
    });
  });

  it('ignora la priority del body porque editar la prioridad está fuera de alcance', async () => {
    const todo = addTodo('Tarea', false, 'low');

    const res = await patchTodo(todo.id, JSON.stringify({ title: 'Título nuevo', priority: 'high' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: todo.id,
      title: 'Título nuevo',
      done: false,
      priority: 'low',
      labels: [],
    });
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
    expect(await res.json()).toEqual({
      id: todo.id,
      title: 'Tarea',
      done: false,
      priority: 'medium',
      labels: [],
    });
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
    expect(await res.json()).toEqual({ total: 1, done: 1, pending: 0, byLabel: {} });
  });

  it('GET /stats refleja volver a dejar la tarea pendiente', async () => {
    const todo = addTodo('Tarea completada', true);

    await patchTodo(todo.id, JSON.stringify({ done: false }));

    const res = await fetch(`${base}/stats`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 1, done: 0, pending: 1, byLabel: {} });
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

describe('etiquetas', () => {
  const postLabel = (body: string): Promise<Response> =>
    fetch(`${base}/labels`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

  const getLabels = async (): Promise<Label[]> => {
    const res = await fetch(`${base}/labels`);
    expect(res.status).toBe(200);
    return (await res.json()) as Label[];
  };

  it('POST /labels crea una etiqueta y responde 201', async () => {
    const res = await postLabel(JSON.stringify({ name: 'trabajo', color: '#a1b2c3' }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 1, name: 'trabajo', color: '#a1b2c3' });
  });

  it('los ids de las etiquetas son correlativos y empiezan en 1', async () => {
    await postLabel(JSON.stringify({ name: 'trabajo', color: '#a1b2c3' }));
    const res = await postLabel(JSON.stringify({ name: 'casa', color: '#d4e5f6' }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 2, name: 'casa', color: '#d4e5f6' });
  });

  it('POST /labels con un name ya usado responde 409 duplicate_label', async () => {
    await postLabel(JSON.stringify({ name: 'trabajo', color: '#a1b2c3' }));

    const res = await postLabel(JSON.stringify({ name: 'trabajo', color: '#d4e5f6' }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'duplicate_label' });
  });

  it('una etiqueta duplicada no se crea', async () => {
    await postLabel(JSON.stringify({ name: 'trabajo', color: '#a1b2c3' }));
    await postLabel(JSON.stringify({ name: 'trabajo', color: '#d4e5f6' }));

    expect(await getLabels()).toEqual([{ id: 1, name: 'trabajo', color: '#a1b2c3' }]);
  });

  it.each([
    ['name ausente', {}],
    ['name vacío', { name: '', color: '#a1b2c3' }],
    ['name con solo espacios', { name: '   ', color: '#a1b2c3' }],
    ['name que no es string', { name: 42, color: '#a1b2c3' }],
  ])('POST /labels con %s responde 400 invalid_name', async (_caso, body) => {
    const res = await postLabel(JSON.stringify(body));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_name' });
  });

  it.each([
    ['body que no es JSON', '{no es json'],
    ['body vacío', ''],
    ['body que no es un objeto', '["trabajo"]'],
  ])('POST /labels con %s responde 400 invalid_body', async (_caso, body) => {
    const res = await postLabel(body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_body' });
  });

  it.each([
    ['color ausente', { name: 'trabajo' }],
    ['color vacío', { name: 'trabajo', color: '' }],
    ['color sin #', { name: 'trabajo', color: 'a1b2c3' }],
    ['color con pocos dígitos', { name: 'trabajo', color: '#a1b2c' }],
    ['color con dígitos no hexadecimales', { name: 'trabajo', color: '#g1b2c3' }],
    ['color que no es string', { name: 'trabajo', color: 123 }],
  ])('POST /labels con %s responde 400 invalid_color', async (_caso, body) => {
    const res = await postLabel(JSON.stringify(body));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_color' });
  });

  it('un name válido con un color inválido responde 400 invalid_color', async () => {
    const res = await postLabel(JSON.stringify({ name: 'trabajo', color: 'no-es-color' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_color' });
  });

  it('una etiqueta inválida no se crea', async () => {
    await postLabel(JSON.stringify({ name: 'trabajo', color: 'no-es-color' }));

    expect(await getLabels()).toEqual([]);
  });

  it('GET /labels devuelve un arreglo vacío al inicio', async () => {
    expect(await getLabels()).toEqual([]);
  });

  it('GET /labels devuelve las etiquetas creadas en orden de creación', async () => {
    await postLabel(JSON.stringify({ name: 'trabajo', color: '#a1b2c3' }));
    await postLabel(JSON.stringify({ name: 'casa', color: '#d4e5f6' }));

    expect(await getLabels()).toEqual([
      { id: 1, name: 'trabajo', color: '#a1b2c3' },
      { id: 2, name: 'casa', color: '#d4e5f6' },
    ]);
  });

  it('DELETE /labels/:id borra la etiqueta y responde 204 sin cuerpo', async () => {
    await postLabel(JSON.stringify({ name: 'trabajo', color: '#a1b2c3' }));

    const res = await fetch(`${base}/labels/1`, { method: 'DELETE' });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('después de borrar, la etiqueta desaparece de GET /labels', async () => {
    await postLabel(JSON.stringify({ name: 'trabajo', color: '#a1b2c3' }));
    await postLabel(JSON.stringify({ name: 'casa', color: '#d4e5f6' }));

    await fetch(`${base}/labels/1`, { method: 'DELETE' });

    expect(await getLabels()).toEqual([{ id: 2, name: 'casa', color: '#d4e5f6' }]);
  });

  it('DELETE /labels/:id responde 400 invalid_id si el id no es un entero positivo', async () => {
    for (const id of ['abc', '0', '-1', '1.5']) {
      const res = await fetch(`${base}/labels/${id}`, { method: 'DELETE' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_id' });
    }
  });

  it('DELETE /labels/:id responde 404 not_found si la etiqueta no existe', async () => {
    const res = await fetch(`${base}/labels/999`, { method: 'DELETE' });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('un id inválido no borra ninguna etiqueta', async () => {
    await postLabel(JSON.stringify({ name: 'trabajo', color: '#a1b2c3' }));

    await fetch(`${base}/labels/abc`, { method: 'DELETE' });

    expect(await getLabels()).toHaveLength(1);
  });

  it('borrar una etiqueta la quita de las tareas en GET /todos y GET /todos/:id', async () => {
    const todo = addTodo('Comprar pan');
    await postLabel(JSON.stringify({ name: 'trabajo', color: '#a1b2c3' }));
    await fetch(`${base}/todos/${todo.id}/labels/1`, { method: 'POST' });

    await fetch(`${base}/labels/1`, { method: 'DELETE' });

    const list = await getTodos();
    expect(list[0]?.labels).toEqual([]);

    const res = await fetch(`${base}/todos/${todo.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { labels: Label[] };
    expect(body.labels).toEqual([]);
  });
});

describe('etiquetas de una tarea', () => {
  // Crea una etiqueta y falla el test si no se pudo crear, para no tener que
  // comprobar el null en cada uso.
  const makeLabel = (name: string, color: string): Label => {
    const label = createLabel(name, color);
    if (label === null) throw new Error(`no se pudo crear la etiqueta ${name}`);
    return label;
  };

  const assignLabel = (todoId: number | string, labelId: number | string): Promise<Response> =>
    fetch(`${base}/todos/${todoId}/labels/${labelId}`, { method: 'POST' });

  const removeLabel = (todoId: number | string, labelId: number | string): Promise<Response> =>
    fetch(`${base}/todos/${todoId}/labels/${labelId}`, { method: 'DELETE' });

  it('POST asigna la etiqueta y responde 200 con la tarea actualizada', async () => {
    const todo = addTodo('Comprar pan');
    const label = makeLabel('urgente', '#ff0000');

    const res = await assignLabel(todo.id, label.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: todo.id,
      title: 'Comprar pan',
      done: false,
      priority: 'medium',
      labels: [{ id: label.id, name: 'urgente', color: '#ff0000' }],
    });
  });

  it('asignar la misma etiqueta dos veces no la duplica', async () => {
    const todo = addTodo('Comprar pan');
    const label = makeLabel('urgente', '#ff0000');

    await assignLabel(todo.id, label.id);
    const res = await assignLabel(todo.id, label.id);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { labels: Label[] };
    expect(body.labels).toEqual([{ id: label.id, name: 'urgente', color: '#ff0000' }]);
  });

  it('una tarea puede tener varias etiquetas y GET /todos/:id las devuelve todas', async () => {
    const todo = addTodo('Comprar pan');
    const primera = makeLabel('urgente', '#ff0000');
    const segunda = makeLabel('casa', '#00ff00');

    await assignLabel(todo.id, primera.id);
    await assignLabel(todo.id, segunda.id);

    const res = await fetch(`${base}/todos/${todo.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { labels: Label[] };
    expect(body.labels).toEqual([
      { id: primera.id, name: 'urgente', color: '#ff0000' },
      { id: segunda.id, name: 'casa', color: '#00ff00' },
    ]);
  });

  it('POST con id de tarea inválido responde 400 invalid_id', async () => {
    const label = makeLabel('urgente', '#ff0000');
    addTodo('Comprar pan');

    for (const id of ['abc', '0', '-1', '1.5']) {
      const res = await assignLabel(id, label.id);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_id' });
    }
  });

  it('POST con id de etiqueta inválido responde 400 invalid_id', async () => {
    const todo = addTodo('Comprar pan');

    for (const labelId of ['abc', '0', '-1', '1.5']) {
      const res = await assignLabel(todo.id, labelId);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_id' });
    }
  });

  it('POST con una tarea inexistente responde 404 not_found', async () => {
    const label = makeLabel('urgente', '#ff0000');

    const res = await assignLabel(999, label.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('POST con una etiqueta inexistente responde 404 not_found', async () => {
    const todo = addTodo('Comprar pan');

    const res = await assignLabel(todo.id, 999);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('DELETE quita la etiqueta y responde 204 sin cuerpo', async () => {
    const todo = addTodo('Comprar pan');
    const label = makeLabel('urgente', '#ff0000');
    await assignLabel(todo.id, label.id);

    const res = await removeLabel(todo.id, label.id);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('tras DELETE la etiqueta desaparece de labels de la tarea', async () => {
    const todo = addTodo('Comprar pan');
    const label = makeLabel('urgente', '#ff0000');
    await assignLabel(todo.id, label.id);

    await removeLabel(todo.id, label.id);

    const res = await fetch(`${base}/todos/${todo.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { labels: Label[] };
    expect(body.labels).toEqual([]);
  });

  it('DELETE de una etiqueta que la tarea no tiene responde 204', async () => {
    const todo = addTodo('Comprar pan');
    const label = makeLabel('urgente', '#ff0000');

    const res = await removeLabel(todo.id, label.id);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('DELETE con una tarea o etiqueta inexistente responde 404 not_found', async () => {
    const todo = addTodo('Comprar pan');
    const label = makeLabel('urgente', '#ff0000');

    const missingTodo = await removeLabel(999, label.id);
    expect(missingTodo.status).toBe(404);
    expect(await missingTodo.json()).toEqual({ error: 'not_found' });

    const missingLabel = await removeLabel(todo.id, 999);
    expect(missingLabel.status).toBe(404);
    expect(await missingLabel.json()).toEqual({ error: 'not_found' });
  });

  it('DELETE con id inválido responde 400 invalid_id', async () => {
    const todo = addTodo('Comprar pan');
    const label = makeLabel('urgente', '#ff0000');

    const badTodo = await removeLabel('abc', label.id);
    expect(badTodo.status).toBe(400);
    expect(await badTodo.json()).toEqual({ error: 'invalid_id' });

    const badLabel = await removeLabel(todo.id, 'abc');
    expect(badLabel.status).toBe(400);
    expect(await badLabel.json()).toEqual({ error: 'invalid_id' });
  });

  it('DELETE /todos/:id borra también las etiquetas de la tarea', async () => {
    const todo = addTodo('Comprar pan');
    const label = makeLabel('urgente', '#ff0000');
    await assignLabel(todo.id, label.id);

    await fetch(`${base}/todos/${todo.id}`, { method: 'DELETE' });

    // La tarea ya no tiene etiquetas asignadas: un id reutilizado no las hereda.
    expect(labelsForTodo(todo.id)).toEqual([]);
  });

  it('DELETE /todos borra también las etiquetas de todas las tareas', async () => {
    const primera = addTodo('Primera');
    const segunda = addTodo('Segunda');
    const label = makeLabel('urgente', '#ff0000');
    await assignLabel(primera.id, label.id);
    await assignLabel(segunda.id, label.id);

    await fetch(`${base}/todos`, { method: 'DELETE' });

    expect(labelsForTodo(primera.id)).toEqual([]);
    expect(labelsForTodo(segunda.id)).toEqual([]);
  });
});

describe('stats con tareas', () => {
  it('GET /stats cuenta las tareas creadas con POST /todos', async () => {
    await postTodo(JSON.stringify({ title: 'Tarea pendiente A' }));
    await postTodo(JSON.stringify({ title: 'Tarea pendiente B' }));
    addTodo('Tarea completada', true);

    const res = await fetch(`${base}/stats`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 3, done: 1, pending: 2, byLabel: {} });
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

describe('stats por etiqueta', () => {
  // Crea una etiqueta y falla el test si no se pudo crear, para no tener que
  // comprobar el null en cada uso.
  const makeLabel = (name: string, color: string): Label => {
    const label = createLabel(name, color);
    if (label === null) throw new Error(`no se pudo crear la etiqueta ${name}`);
    return label;
  };

  it('GET /stats cuenta las tareas de cada etiqueta', async () => {
    const trabajo = makeLabel('trabajo', '#ff0000');
    const casa = makeLabel('casa', '#00ff00');
    const primera = addTodo('Primera');
    const segunda = addTodo('Segunda');
    const tercera = addTodo('Tercera');
    assignLabelToTodo(primera.id, trabajo.id);
    assignLabelToTodo(segunda.id, trabajo.id);
    assignLabelToTodo(tercera.id, casa.id);

    const res = await fetch(`${base}/stats`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      total: 3,
      done: 0,
      pending: 3,
      byLabel: { trabajo: 2, casa: 1 },
    });
  });

  it('una etiqueta sin tareas aparece con 0', async () => {
    const trabajo = makeLabel('trabajo', '#ff0000');
    makeLabel('casa', '#00ff00');
    const todo = addTodo('Con etiqueta');
    assignLabelToTodo(todo.id, trabajo.id);

    const res = await fetch(`${base}/stats`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { byLabel: Record<string, number> };
    expect(body.byLabel).toEqual({ trabajo: 1, casa: 0 });
  });

  it('sin etiquetas byLabel es un objeto vacío', async () => {
    addTodo('Sin etiquetas');

    const res = await fetch(`${base}/stats`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 1, done: 0, pending: 1, byLabel: {} });
  });

  it('una tarea con dos etiquetas cuenta en las dos claves', async () => {
    const trabajo = makeLabel('trabajo', '#ff0000');
    const casa = makeLabel('casa', '#00ff00');
    const todo = addTodo('Con dos etiquetas');
    assignLabelToTodo(todo.id, trabajo.id);
    assignLabelToTodo(todo.id, casa.id);

    const res = await fetch(`${base}/stats`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { byLabel: Record<string, number> };
    expect(body.byLabel).toEqual({ trabajo: 1, casa: 1 });
  });

  it('tras borrar una etiqueta su clave desaparece de byLabel', async () => {
    const trabajo = makeLabel('trabajo', '#ff0000');
    const casa = makeLabel('casa', '#00ff00');
    const todo = addTodo('Con etiqueta');
    assignLabelToTodo(todo.id, trabajo.id);

    expect(deleteLabel(casa.id)).toBe(true);

    const res = await fetch(`${base}/stats`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { byLabel: Record<string, number> };
    expect(body.byLabel).toEqual({ trabajo: 1 });
  });
});

describe('etiquetas de las tareas', () => {
  // Crea una etiqueta y falla el test si no se pudo crear, para no tener que
  // comprobar el null en cada uso.
  const makeLabel = (name: string, color: string): Label => {
    const label = createLabel(name, color);
    if (label === null) throw new Error(`no se pudo crear la etiqueta ${name}`);
    return label;
  };

  it('POST /todos responde 201 con labels vacío', async () => {
    const res = await postTodo(JSON.stringify({ title: 'Comprar pan' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: 1,
      title: 'Comprar pan',
      done: false,
      priority: 'medium',
      labels: [],
    });
  });

  it('GET /todos devuelve las etiquetas de cada tarea', async () => {
    const todo = addTodo('Comprar pan');
    const label = makeLabel('urgente', '#ff0000');
    assignLabelToTodo(todo.id, label.id);

    const body = await getTodos();

    expect(body).toHaveLength(1);
    expect(body[0]?.labels).toEqual([{ id: label.id, name: 'urgente', color: '#ff0000' }]);
  });

  it('GET /todos/:id devuelve las etiquetas de la tarea', async () => {
    const todo = addTodo('Comprar pan');
    const label = makeLabel('urgente', '#ff0000');
    assignLabelToTodo(todo.id, label.id);

    const res = await fetch(`${base}/todos/${todo.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { labels: Label[] };
    expect(body.labels).toEqual([{ id: label.id, name: 'urgente', color: '#ff0000' }]);
  });

  it('GET /todos/latest devuelve las etiquetas de la última tarea', async () => {
    const todo = addTodo('Comprar pan');
    const label = makeLabel('urgente', '#ff0000');
    assignLabelToTodo(todo.id, label.id);

    const res = await fetch(`${base}/todos/latest`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number; labels: Label[] };
    expect(body.id).toBe(todo.id);
    expect(body.labels).toEqual([{ id: label.id, name: 'urgente', color: '#ff0000' }]);
  });

  it('PATCH /todos/:id devuelve las etiquetas de la tarea', async () => {
    const todo = addTodo('Comprar pan');
    const label = makeLabel('urgente', '#ff0000');
    assignLabelToTodo(todo.id, label.id);

    const res = await fetch(`${base}/todos/${todo.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Comprar pan y leche' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; labels: Label[] };
    expect(body.title).toBe('Comprar pan y leche');
    expect(body.labels).toEqual([{ id: label.id, name: 'urgente', color: '#ff0000' }]);
  });

  it('un PATCH no borra las etiquetas de la tarea', async () => {
    const todo = addTodo('Comprar pan');
    const label = makeLabel('urgente', '#ff0000');
    assignLabelToTodo(todo.id, label.id);

    await fetch(`${base}/todos/${todo.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done: true }),
    });

    const res = await fetch(`${base}/todos/${todo.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { done: boolean; labels: Label[] };
    expect(body.done).toBe(true);
    expect(body.labels).toEqual([{ id: label.id, name: 'urgente', color: '#ff0000' }]);
  });

  it('devuelve varias etiquetas en el orden en que se crearon', async () => {
    const todo = addTodo('Comprar pan');
    const primera = makeLabel('urgente', '#ff0000');
    const segunda = makeLabel('casa', '#00ff00');
    assignLabelToTodo(todo.id, primera.id);
    assignLabelToTodo(todo.id, segunda.id);

    const res = await fetch(`${base}/todos/${todo.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { labels: Label[] };
    expect(body.labels).toEqual([
      { id: primera.id, name: 'urgente', color: '#ff0000' },
      { id: segunda.id, name: 'casa', color: '#00ff00' },
    ]);
  });
});
