import { beforeEach, describe, expect, it } from 'vitest';
import {
  assignLabelToTodo,
  clearTodoLabels,
  createLabel,
  deleteLabel,
  findLabelById,
  findLabelByName,
  isValidHexColor,
  isValidLabelName,
  labelsForTodo,
  listLabels,
  removeLabelFromTodo,
  resetLabels,
} from './labels.js';

// Cada test parte de un estado limpio: nada depende del orden ni de otros tests.
beforeEach(() => {
  resetLabels();
});

describe('labels', () => {
  it('isValidLabelName acepta un nombre con texto y rechaza vacíos o no strings', () => {
    expect(isValidLabelName('trabajo')).toBe(true);
    expect(isValidLabelName('')).toBe(false);
    expect(isValidLabelName('   ')).toBe(false);
    expect(isValidLabelName(42)).toBe(false);
    expect(isValidLabelName(null)).toBe(false);
  });

  it('isValidHexColor acepta hexadecimales de 6 dígitos y rechaza el resto', () => {
    expect(isValidHexColor('#a1b2c3')).toBe(true);
    expect(isValidHexColor('#A1B2C3')).toBe(true);
    expect(isValidHexColor('a1b2c3')).toBe(false);
    expect(isValidHexColor('#abc')).toBe(false);
    expect(isValidHexColor('#12345g')).toBe(false);
    expect(isValidHexColor('#1234567')).toBe(false);
    expect(isValidHexColor(123)).toBe(false);
  });

  it('createLabel crea etiquetas con ids correlativos y guarda los valores recortados', () => {
    const first = createLabel(' trabajo ', ' #a1b2c3 ');
    expect(first).toEqual({ id: 1, name: 'trabajo', color: '#a1b2c3' });

    const second = createLabel('casa', '#d4e5f6');
    expect(second).toEqual({ id: 2, name: 'casa', color: '#d4e5f6' });
  });

  it('createLabel devuelve null si el nombre ya existe y no crea otra etiqueta', () => {
    createLabel('trabajo', '#a1b2c3');

    expect(createLabel('trabajo', '#ffffff')).toBeNull();
    expect(listLabels()).toHaveLength(1);
    expect(listLabels()[0]?.name).toBe('trabajo');
  });

  it('listLabels devuelve las etiquetas en orden de creación', () => {
    createLabel('trabajo', '#a1b2c3');
    createLabel('casa', '#d4e5f6');
    createLabel('urgente', '#000000');

    expect(listLabels().map((label) => label.name)).toEqual(['trabajo', 'casa', 'urgente']);
  });

  it('findLabelById y findLabelByName encuentran la etiqueta y devuelven undefined si no existe', () => {
    const created = createLabel('trabajo', '#a1b2c3');
    expect(created).not.toBeNull();

    expect(findLabelById(1)?.name).toBe('trabajo');
    expect(findLabelByName('trabajo')?.id).toBe(1);
    expect(findLabelById(99)).toBeUndefined();
    expect(findLabelByName('casa')).toBeUndefined();
  });

  it('assignLabelToTodo asigna una sola vez y labelsForTodo la devuelve', () => {
    const label = createLabel('trabajo', '#a1b2c3');
    expect(label).not.toBeNull();
    const labelId = label?.id ?? 0;

    expect(assignLabelToTodo(7, labelId)).toBe(true);
    expect(assignLabelToTodo(7, labelId)).toBe(false);
    expect(labelsForTodo(7)).toHaveLength(1);
    expect(labelsForTodo(7)[0]?.name).toBe('trabajo');
  });

  it('labelsForTodo devuelve [] para una tarea sin etiquetas', () => {
    expect(labelsForTodo(7)).toEqual([]);
  });

  it('labelsForTodo devuelve las etiquetas en orden del catálogo', () => {
    const primera = createLabel('trabajo', '#a1b2c3');
    const segunda = createLabel('casa', '#d4e5f6');
    expect(primera).not.toBeNull();
    expect(segunda).not.toBeNull();

    // Se asignan en el orden contrario al del catálogo.
    assignLabelToTodo(7, segunda?.id ?? 0);
    assignLabelToTodo(7, primera?.id ?? 0);

    expect(labelsForTodo(7).map((label) => label.name)).toEqual(['trabajo', 'casa']);
  });

  it('removeLabelFromTodo quita la etiqueta y avisa si no la tenía', () => {
    const label = createLabel('trabajo', '#a1b2c3');
    expect(label).not.toBeNull();
    const labelId = label?.id ?? 0;

    expect(removeLabelFromTodo(7, labelId)).toBe(false);

    assignLabelToTodo(7, labelId);
    expect(removeLabelFromTodo(7, labelId)).toBe(true);
    expect(labelsForTodo(7)).toEqual([]);
  });

  it('assignLabelToTodo devuelve false si la etiqueta no existe', () => {
    expect(assignLabelToTodo(7, 99)).toBe(false);
    expect(labelsForTodo(7)).toEqual([]);
  });

  it('deleteLabel borra la etiqueta del catálogo y de todas las tareas', () => {
    const label = createLabel('trabajo', '#a1b2c3');
    expect(label).not.toBeNull();
    const labelId = label?.id ?? 0;

    assignLabelToTodo(7, labelId);
    assignLabelToTodo(8, labelId);

    expect(deleteLabel(labelId)).toBe(true);
    expect(listLabels()).toEqual([]);
    expect(labelsForTodo(7)).toEqual([]);
    expect(labelsForTodo(8)).toEqual([]);
  });

  it('deleteLabel devuelve false si la etiqueta no existe', () => {
    expect(deleteLabel(99)).toBe(false);
  });

  it('clearTodoLabels quita todas las etiquetas de la tarea', () => {
    const primera = createLabel('trabajo', '#a1b2c3');
    const segunda = createLabel('casa', '#d4e5f6');
    expect(primera).not.toBeNull();
    expect(segunda).not.toBeNull();

    assignLabelToTodo(7, primera?.id ?? 0);
    assignLabelToTodo(7, segunda?.id ?? 0);

    clearTodoLabels(7);
    expect(labelsForTodo(7)).toEqual([]);
  });

  it('resetLabels vacía el catálogo y las asignaciones y reinicia los ids', () => {
    const label = createLabel('trabajo', '#a1b2c3');
    expect(label).not.toBeNull();
    assignLabelToTodo(7, label?.id ?? 0);

    resetLabels();

    expect(listLabels()).toEqual([]);
    expect(labelsForTodo(7)).toEqual([]);
    expect(createLabel('casa', '#d4e5f6')).toEqual({
      id: 1,
      name: 'casa',
      color: '#d4e5f6',
    });
  });
});
