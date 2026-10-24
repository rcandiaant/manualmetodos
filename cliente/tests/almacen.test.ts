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
import { doc, parrafo } from './ayudantes-doc';

const CLAVE = 'manualmetodos-demo-fase0-v1';
afterEach(() => window.localStorage.clear());

const BASE = doc(parrafo('p1', 'Disolver 42,0 g.'));
const copiaCon = (t: string): DocJSON => doc(parrafo('p1', t));

function estadoConDecisiones() {
  const e = estadoVacio();
  e.base = BASE;
  e.copias.labA = copiaCon('Disolver 42,00 g.');
  e.decisiones = { 'labA:p1:2': 'aceptada', 'labA:p1:+0': 'rechazada', 'labB:p1:2': 'rechazada' };
  return e;
}

describe('guardarCopia', () => {
  it('si la copia cambió, borra las decisiones de ese laboratorio y lo anota', () => {
    const e = estadoConDecisiones();
    guardarCopia(e, 'labA', copiaCon('Disolver 43 g.'));
    expect(e.copias.labA).toEqual(copiaCon('Disolver 43 g.'));
    expect(e.decisiones).toEqual({ 'labB:p1:2': 'rechazada' });
    expect(e.decisionesDescartadas).toEqual({ labA: 2 });
  });

  it('si la copia es la misma, conserva las decisiones', () => {
    const e = estadoConDecisiones();
    guardarCopia(e, 'labA', copiaCon('Disolver 42,00 g.'));
    expect(Object.keys(e.decisiones)).toHaveLength(3);
    expect(e.decisionesDescartadas).toEqual({});
  });

  it('acumula descartes hasta que el revisor los ve', () => {
    const e = estadoConDecisiones();
    guardarCopia(e, 'labA', copiaCon('a'));
    e.decisiones['labA:p1:0'] = 'aceptada';
    guardarCopia(e, 'labA', copiaCon('b'));
    expect(e.decisionesDescartadas).toEqual({ labA: 3 });
  });
});

describe('descartarCopia', () => {
  it('quita la copia, los motivos y las decisiones del laboratorio', () => {
    const e = estadoConDecisiones();
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
    const e = estadoConDecisiones();
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
