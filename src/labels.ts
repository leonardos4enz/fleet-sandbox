export type Label = { id: number; name: string; color: string };

// Un color es un hexadecimal de 6 dígitos con `#` inicial.
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// Indica si el valor es un nombre de etiqueta válido: un texto que, sin
// espacios alrededor, no queda vacío.
export const isValidLabelName = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

// Indica si el valor es un color válido, ignorando los espacios alrededor.
export const isValidHexColor = (value: unknown): value is string =>
  typeof value === 'string' && HEX_COLOR_PATTERN.test(value.trim());

// Catálogo de etiquetas, en orden de creación.
const labels: Label[] = [];
let nextLabelId = 1;

// Etiquetas asignadas por tarea: id de tarea -> conjunto de ids de etiqueta.
const assignments = new Map<number, Set<number>>();

// Crea una etiqueta con el nombre y el color ya recortados. Devuelve null si
// ya existe una etiqueta con ese nombre (y no crea nada en ese caso).
export const createLabel = (name: string, color: string): Label | null => {
  const trimmedName = name.trim();
  if (findLabelByName(trimmedName) !== undefined) return null;

  const label: Label = { id: nextLabelId, name: trimmedName, color: color.trim() };
  nextLabelId += 1;
  labels.push(label);
  return label;
};

// Devuelve las etiquetas del catálogo en orden de creación.
export const listLabels = (): Label[] => labels.map((label) => ({ ...label }));

// Devuelve la etiqueta con ese id, o undefined si no existe.
export const findLabelById = (id: number): Label | undefined => {
  const found = labels.find((label) => label.id === id);
  return found === undefined ? undefined : { ...found };
};

// Devuelve la etiqueta con ese nombre (comparación exacta), o undefined si
// no existe.
export const findLabelByName = (name: string): Label | undefined => {
  const found = labels.find((label) => label.name === name);
  return found === undefined ? undefined : { ...found };
};

// Borra la etiqueta del catálogo y la quita de todas las tareas donde estaba
// asignada. Devuelve false si la etiqueta no existe.
export const deleteLabel = (id: number): boolean => {
  const index = labels.findIndex((label) => label.id === id);
  if (index === -1) return false;

  labels.splice(index, 1);
  for (const labelIds of assignments.values()) {
    labelIds.delete(id);
  }
  return true;
};

// Asigna la etiqueta a la tarea. Devuelve false si la etiqueta no existe o si
// ya estaba asignada: nunca se duplica.
export const assignLabelToTodo = (todoId: number, labelId: number): boolean => {
  if (findLabelById(labelId) === undefined) return false;

  const labelIds = assignments.get(todoId) ?? new Set<number>();
  if (labelIds.has(labelId)) return false;

  labelIds.add(labelId);
  assignments.set(todoId, labelIds);
  return true;
};

// Quita la etiqueta de la tarea. Devuelve false si esa tarea no la tenía.
export const removeLabelFromTodo = (todoId: number, labelId: number): boolean => {
  const labelIds = assignments.get(todoId);
  if (labelIds === undefined || !labelIds.delete(labelId)) return false;

  if (labelIds.size === 0) assignments.delete(todoId);
  return true;
};

// Devuelve las etiquetas de la tarea en orden del catálogo, o [] si la tarea
// no tiene etiquetas.
export const labelsForTodo = (todoId: number): Label[] => {
  const labelIds = assignments.get(todoId);
  if (labelIds === undefined) return [];

  return labels
    .filter((label) => labelIds.has(label.id))
    .map((label) => ({ ...label }));
};

// Quita todas las etiquetas de la tarea.
export const clearTodoLabels = (todoId: number): void => {
  assignments.delete(todoId);
};

// Vacía el catálogo y las asignaciones y reinicia la numeración de ids.
// Solo para tests: cada test debe partir de un estado limpio.
export const resetLabels = (): void => {
  labels.length = 0;
  assignments.clear();
  nextLabelId = 1;
};
