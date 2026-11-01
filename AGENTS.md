# AGENTS.md: reglas para agentes

Este archivo lo leen todos los agentes antes de trabajar. Cada vez que corrijas a un agente, la corrección va **aquí** o en `eslint.config.js`, nunca solo en un chat.

## Stack
- Node 22, TypeScript estricto y ESM. Servidor HTTP con `node:http` (sin frameworks).
- Tests con Vitest, junto al código (`*.test.ts`).

## Definición de "terminado"
1. `npm run verify` pasa (typecheck + lint + tests).
2. Todo comportamiento nuevo tiene un test que fallaría sin el cambio.
3. El diff solo toca lo que pide el issue.

## Tests aislados
- Cada test prepara su propio estado. Nunca depende del orden de ejecución ni de lo que creó otro test o `describe`.
- Todo estado en memoria de un módulo (arreglos, contadores) expone una función `reset…()` exportada solo para tests, y el archivo de test la llama en `beforeEach`.
- Nada de aserciones con valores absolutos que solo son ciertas por lo que dejaron tests anteriores.

## Camino pavimentado: una sola forma de hacer cada cosa
- **Rutas nuevas:** se agregan al objeto `routes` en `src/app.ts`, con su test en `src/app.test.ts`.
- **Respuestas:** siempre con el helper `json()`.
- **Configuración:** solo desde `process.env`, leída en `server.ts`.

## Prohibido
- `any`, `@ts-ignore` y desactivar reglas de lint.
- Comentarios TODO/FIXME/HACK. Si algo queda pendiente, se dice en el resumen final.
- Agregar dependencias sin que el issue lo pida.
- Tocar `.github/`, `eslint.config.js`, `tsconfig.json` o este archivo, salvo que el issue lo pida explícitamente.
- Borrar o debilitar tests existentes para que pasen.
