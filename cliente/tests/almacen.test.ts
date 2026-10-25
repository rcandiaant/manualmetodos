import { afterEach, describe, expect, it } from 'vitest';
import {
  cargarEstado,
  estadoVacio,
  descartarCopia,
  guardarCopia,
  guardarEstado,
  validarEstado,
} from '../src/demo/almacen';
import type { DocJSON } from '../src/tipos';
import { calcularSugerencias } from '../src/cambios/sugerencias';
import { doc, parrafo } from './ayudantes-doc';

const CLAVE = 'manualmetodos-demo-fase0-v1';
afterEach(() => window.localStorage.clear());

const BASE = doc(parrafo('p1', 'Disolver 42,0 g.'));
const copiaCon = (t: string): DocJSON => doc(parrafo('p1', t));

function estadoConDecisiones() {
  const e = estadoVacio();
  e.base = BASE;
  e.copias.labA = copiaCon('Disolver 42,00 g.');
  const [s] = calcularSugerencias(BASE, e.copias.labA, 'labA');
  e.decisiones = { [s.id]: 'aceptada', 'labA:p1:huerfana': 'rechazada', 'labB:p1:2': 'rechazada' };
  return { e, idVigente: s.id };
}

describe('guardarCopia', () => {
  it('re-guardar conserva decisiones de sugerencias que siguen existiendo', () => {
    const { e, idVigente } = estadoConDecisiones();
    // Cambio adicional en otra parte: la sugerencia original conserva su id.
    guardarCopia(e, 'labA', copiaCon('Disolver 42,00 g en agua.'));
    expect(e.decisiones[idVigente]).toBe('aceptada');
    expect(e.decisiones['labB:p1:2']).toBe('rechazada');
  });

  it('re-guardar descarta decisiones huérfanas', () => {
    const { e, idVigente } = estadoConDecisiones();
    guardarCopia(e, 'labA', copiaCon('Disolver 43 g.'));
    expect(e.copias.labA).toEqual(copiaCon('Disolver 43 g.'));
    expect(e.decisiones[idVigente]).toBeUndefined();
    expect(e.decisiones['labA:p1:huerfana']).toBeUndefined();
    expect(e.decisiones['labB:p1:2']).toBe('rechazada');
    expect(e.decisionesDescartadas).toEqual({ labA: 2 });
  });

  it('si la copia es la misma, conserva las decisiones', () => {
    const { e } = estadoConDecisiones();
    guardarCopia(e, 'labA', copiaCon('Disolver 42,00 g.'));
    expect(Object.keys(e.decisiones)).toHaveLength(3);
    expect(e.decisionesDescartadas).toEqual({});
  });

  it('acumula descartes hasta que el revisor los ve', () => {
    const { e } = estadoConDecisiones();
    guardarCopia(e, 'labA', copiaCon('a'));
    e.decisiones['labA:p1:otra'] = 'aceptada';
    guardarCopia(e, 'labA', copiaCon('b'));
    expect(e.decisionesDescartadas).toEqual({ labA: 3 });
  });

  it('las decisiones de un grupo sobreviven si sigue completo y se descartan juntas si no', () => {
    const base = doc(parrafo('p1', 'Uno.'), parrafo('p2', 'Dos.'), parrafo('p3', 'Tres.'));
    const mover = (t: string) => doc(parrafo('p2', 'Dos.'), parrafo('p1', t), parrafo('p3', 'Tres.'));
    const e = estadoVacio();
    e.base = base;
    guardarCopia(e, 'labA', mover('Uno.'));
    const grupo = calcularSugerencias(base, mover('Uno.'), 'labA').filter((s) => s.grupo);
    expect(grupo.length).toBeGreaterThan(1);
    for (const s of grupo) e.decisiones[s.id] = 'aceptada';
    guardarCopia(e, 'labA', mover('Uno.')); // misma copia
    expect(Object.keys(e.decisiones)).toHaveLength(grupo.length);
    // Se edita el bloque movido: la inserción cambia de id, la eliminación no.
    guardarCopia(e, 'labA', mover('Uno más.'));
    expect(e.decisiones).toEqual({});
    expect(e.decisionesDescartadas.labA).toBe(grupo.length);
  });
});

describe('descartarCopia', () => {
  it('quita la copia, los motivos y las decisiones del laboratorio', () => {
    const { e } = estadoConDecisiones();
    e.motivos.labA = { 'labA:p1:2': 'más precisión' };
    const motivosA = e.motivos.labA;
    descartarCopia(e, 'labA');
    expect(e.copias.labA).toBeUndefined();
    expect(motivosA).toEqual({});
    expect(e.motivos.labA).toBe(motivosA);
    expect(e.decisiones).toEqual({ 'labB:p1:2': 'rechazada' });
    expect(e.decisionesDescartadas).toEqual({ labA: 2 });
  });
});

describe('validarEstado / cargarEstado', () => {
  it('acepta un estado válido y lo recupera de localStorage', () => {
    const { e } = estadoConDecisiones();
    expect(validarEstado(JSON.parse(JSON.stringify(e)))).toEqual(e);
    expect(guardarEstado(e)).toBe(true);
    const r = cargarEstado();
    expect(r).toEqual({ estado: e, persistente: true });
  });

  it('sin nada guardado devuelve el estado vacío sin aviso', () => {
    expect(cargarEstado()).toEqual({ estado: estadoVacio(), persistente: true });
  });

  it.each([
    ['JSON roto', '{no es json'],
    ['no es objeto', '[1,2]'],
    ['base inválida', JSON.stringify({ ...estadoVacio(), base: { type: 'doc', content: [{ type: 'parrafo' }] } })],
    ['copia inválida', JSON.stringify({ ...estadoVacio(), base: BASE, copias: { labA: { type: 'nada' } } })],
    ['copia sin base', JSON.stringify({ ...estadoVacio(), copias: { labA: BASE } })],
    ['laboratorio desconocido', JSON.stringify({ ...estadoVacio(), base: BASE, copias: { labZ: BASE } })],
    ['decisión inválida', JSON.stringify({ ...estadoVacio(), decisiones: { x: 'quizás' } })],
    ['motivo no texto', JSON.stringify({ ...estadoVacio(), motivos: { labA: { x: 3 }, labB: {} } })],
    ['avisos no lista', JSON.stringify({ ...estadoVacio(), avisos: 'x' })],
  ])('%s → estado vacío con aviso visible', (_caso, crudo) => {
    window.localStorage.setItem(CLAVE, crudo);
    const r = cargarEstado();
    expect(r.estado).toEqual(estadoVacio());
    expect(r.persistente).toBe(true);
    expect(r.aviso).toMatch(/descart/);
  });
});
