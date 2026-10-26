import { describe, expect, it } from 'vitest';
import {
  abreviaturaLab,
  analizarConflictos,
  agruparPorBloque,
  aplicarFiltros,
  chipLab,
  claseLab,
  colaDeConflictos,
  consultaDeFiltros,
  indiceColor,
  leerFiltros,
  PALETA_LABS,
  type Filtros,
} from '../../../src/app/revisor/panel';
import { aportes, BASE, deLab } from './datos';

const SIN_FILTRO: Filtros = { lab: null, soloConflictos: false, soloPendientes: false, ver: 'todo' };

describe('agruparPorBloque', () => {
  it('agruparPorBloque colapsa propuestas identicas y cuenta laboratorios distintos', () => {
    const norte = deLab(12, { p1: 'Disolver 43,0 g de NaCl.', p3: 'Medir el pH inicial.' });
    const sur = deLab(15, { p1: 'Disolver 43,0 g de NaCl.' });
    const centro = deLab(20, { p1: 'Disolver 44,0 g de NaCl.' });
    const grupos = agruparPorBloque([...norte, ...sur, ...centro]);

    expect(grupos.map((g) => g.bloqueId)).toEqual(['p1', 'p3']);
    const p1 = grupos[0];
    expect(p1.laboratorios.map((l) => l.usuarioId)).toEqual([12, 15, 20]);
    // Norte y Sur proponen lo mismo: una sola fila con los dos laboratorios.
    expect(p1.filas).toHaveLength(2);
    expect(p1.filas[0].laboratorios.map((l) => l.usuarioId)).toEqual([12, 15]);
    expect(p1.filas[0].sugerencias).toHaveLength(2);
    expect(p1.filas[1].laboratorios.map((l) => l.usuarioId)).toEqual([20]);
    expect(grupos[1].laboratorios.map((l) => l.usuarioId)).toEqual([12]);
  });

  it('dos sugerencias del mismo laboratorio cuentan como un laboratorio', () => {
    const norte = deLab(12, { p1: 'Disolver 43,0 g de KCl.' });
    expect(norte.length).toBeGreaterThan(1);
    const [p1] = agruparPorBloque(norte);
    expect(p1.laboratorios).toHaveLength(1);
    expect(p1.filas).toHaveLength(norte.length);
  });
});

describe('colores por laboratorio', () => {
  it('colores estables por usuarioId y letra visible', () => {
    expect(PALETA_LABS).toBeGreaterThanOrEqual(12);
    // El color depende solo del usuarioId, no de qué otros laboratorios aparecen.
    // El color depende solo del usuarioId: el ciclo de la paleta lo repite cada PALETA_LABS ids.
    expect(indiceColor(12 + PALETA_LABS)).toBe(indiceColor(12));
    const indices = new Set(Array.from({ length: PALETA_LABS }, (_, i) => indiceColor(i + 1)));
    expect(indices.size).toBe(PALETA_LABS);
    expect(claseLab(12)).toBe(`lab-c${indiceColor(12)}`);

    expect(abreviaturaLab('Laboratorio Norte')).toBe('Nor');
    expect(abreviaturaLab('Laboratorio de Suelos y Aguas')).toBe('SA');
    expect(abreviaturaLab('')).toBe('?');

    const chip = chipLab({ usuarioId: 12, laboratorio: 'Laboratorio <b>Norte</b>' });
    expect(chip.classList.contains(claseLab(12))).toBe(true);
    expect(chip.textContent).toBe(abreviaturaLab('Laboratorio <b>Norte</b>'));
    expect(chip.title).toBe('Laboratorio <b>Norte</b>');
    expect(chip.querySelector('b')).toBeNull();
  });
});

describe('cola de conflictos', () => {
  it('cola de conflictos en orden de documento', () => {
    const cola = colaDeConflictos(aportes().sugerencias, BASE);
    // En la respuesta, la sugerencia de p3 de Centro va antes que las de p1.
    expect(cola.map((c) => c.bloqueId)).toEqual(['p1', 'p3']);
    expect(cola[0].sugerencias.map((s) => s.usuarioId)).toEqual([20, 12, 15]);
    expect(cola[1].sugerencias.map((s) => s.usuarioId).sort()).toEqual([12, 20]);
  });

  it('la cola colapsa propuestas identicas en una columna con todos sus laboratorios', () => {
    const [p1] = colaDeConflictos(aportes().sugerencias, BASE);
    // Norte y Sur proponen «43,0»; Centro «44,0»: dos propuestas distintas.
    expect(p1.propuestas).toHaveLength(2);
    expect(p1.propuestas.map((f) => f.laboratorios.map((l) => l.usuarioId))).toEqual([[20], [12, 15]]);
  });

  it('un conflicto con propuestas identicas no es conflicto: pasa a coincidencias', () => {
    const sugs = [
      ...deLab(12, { p2: 'Agitar durante 10 minutos.' }),
      ...deLab(15, { p2: 'Agitar durante 10 minutos.' }),
      ...deLab(20, { p2: 'Agitar durante 10 minutos.' }),
    ];
    const { cola, coincidencias } = analizarConflictos(sugs, BASE);
    expect(cola).toEqual([]);
    expect(colaDeConflictos(sugs, BASE)).toEqual([]);
    expect(coincidencias).toHaveLength(1);
    expect(coincidencias[0].bloqueId).toBe('p2');
    expect(coincidencias[0].propuestas).toHaveLength(1);
    expect(coincidencias[0].propuestas[0].laboratorios.map((l) => l.usuarioId)).toEqual([12, 15, 20]);
  });

  it('solo considera las sugerencias pendientes', () => {
    const sugs = aportes().sugerencias.map((s) => (s.bloqueId === 'p3' ? { ...s, estado: 'rechazada' as const } : s));
    expect(colaDeConflictos(sugs, BASE).map((c) => c.bloqueId)).toEqual(['p1']);
  });
});

describe('filtros', () => {
  it('filtro por laboratorio y solo pendientes', () => {
    const a = aportes();
    const soloSur = aplicarFiltros(a, { ...SIN_FILTRO, lab: 15 }, new Set());
    expect(new Set(soloSur.sugerencias.map((s) => s.usuarioId))).toEqual(new Set([15]));
    expect(soloSur.comentarios.map((c) => c.id)).toEqual([5]);

    const pendientes = aplicarFiltros(a, { ...SIN_FILTRO, soloPendientes: true }, new Set());
    expect(pendientes.sugerencias.some((s) => s.estado !== 'pendiente')).toBe(false);
    expect(pendientes.sugerencias.length).toBe(a.sugerencias.length - 1);
    expect(pendientes.comentarios.map((c) => c.id)).toEqual([5]); // el resuelto se oculta

    const conflictos = new Set(colaDeConflictos(a.sugerencias, BASE).flatMap((c) => c.sugerencias.map((s) => s.id)));
    const soloConf = aplicarFiltros(a, { ...SIN_FILTRO, soloConflictos: true }, conflictos);
    expect(soloConf.sugerencias.every((s) => conflictos.has(s.id))).toBe(true);
    expect(soloConf.comentarios).toEqual([]);

    expect(aplicarFiltros(a, { ...SIN_FILTRO, ver: 'comentarios' }, new Set()).sugerencias).toEqual([]);
    expect(aplicarFiltros(a, { ...SIN_FILTRO, ver: 'cambios' }, new Set()).comentarios).toEqual([]);
  });

  it('los filtros van y vuelven de la url', () => {
    const f = leerFiltros(new URLSearchParams('lab=12&solo=conflictos'));
    expect(f).toEqual({ lab: 12, soloConflictos: true, soloPendientes: false, ver: 'todo' });
    expect(consultaDeFiltros(f)).toBe('lab=12&solo=conflictos');
    expect(consultaDeFiltros(SIN_FILTRO)).toBe('');
    const todo: Filtros = { lab: 3, soloConflictos: true, soloPendientes: true, ver: 'comentarios' };
    expect(leerFiltros(new URLSearchParams(consultaDeFiltros(todo)))).toEqual(todo);
    // Valores raros: se ignoran.
    expect(leerFiltros(new URLSearchParams('lab=x&solo=nada&ver=otro'))).toEqual(SIN_FILTRO);
  });
});
