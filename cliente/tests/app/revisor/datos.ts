/** Datos compartidos por las pruebas de la vista del revisor (Task 6). */
import { calcularSugerencias } from '../../../src/cambios/sugerencias';
import type { Aportes, Comentario, SugerenciaServidor } from '../../../src/app/tipos-api';
import type { DocJSON } from '../../../src/tipos';
import { doc, parrafo } from '../../ayudantes-doc';

export const BASE: DocJSON = doc(
  parrafo('p1', 'Disolver 42,0 g de NaCl.'),
  parrafo('p2', 'Agitar durante 5 minutos.'),
  parrafo('p3', 'Medir el pH final.'),
);

export const LABS: Record<number, string> = { 12: 'Laboratorio Norte', 15: 'Laboratorio Sur', 20: 'Laboratorio Centro' };

let fila = 100;

/** Sugerencias de un laboratorio tal como las devuelve `GET …/aportes`. */
export function deLab(
  usuarioId: number,
  textos: { p1?: string; p2?: string; p3?: string },
  extra: Partial<SugerenciaServidor> = {},
): SugerenciaServidor[] {
  const copia = doc(
    parrafo('p1', textos.p1 ?? 'Disolver 42,0 g de NaCl.'),
    parrafo('p2', textos.p2 ?? 'Agitar durante 5 minutos.'),
    parrafo('p3', textos.p3 ?? 'Medir el pH final.'),
  );
  return calcularSugerencias(BASE, copia, `u${usuarioId}`).map((s) => ({
    ...s,
    sugerenciaId: fila++,
    usuarioId,
    laboratorio: LABS[usuarioId],
    versionId: 7,
    estado: 'pendiente',
    notaResolucion: null,
    derivadaReunion: false,
    resueltoPor: null,
    resueltoEn: null,
    ...extra,
  }));
}

export function comentario(id: number, usuarioId: number, bloqueId: string, texto: string, estado: Comentario['estado'] = 'abierto'): Comentario {
  return {
    id,
    usuarioId,
    laboratorio: LABS[usuarioId],
    bloqueId,
    rango: { desde: 0, hasta: 1 },
    texto,
    estado,
    notaResolucion: null,
    resueltoPor: null,
    resueltoEn: null,
    creado: '2026-11-03T15:20:00Z',
  };
}

/**
 * - Lab 20 (Centro): p3 «final»→«último» y p1 «42,0»→«44,0» (va primero en la respuesta).
 * - Lab 12 (Norte): p1 «42,0»→«43,0» y p3 «final»→«inicial».
 * - Lab 15 (Sur): p1 «42,0»→«43,0» (idéntica a la de Norte) y p2 «5»→«10» ya aceptada.
 * Conflictos: p1 (los tres) y p3 (Norte y Centro).
 */
export function aportes(): Aportes {
  const centro = deLab(20, { p1: 'Disolver 44,0 g de NaCl.', p3: 'Medir el pH último.' });
  const norte = deLab(12, { p1: 'Disolver 43,0 g de NaCl.', p3: 'Medir el pH inicial.' });
  const surP1 = deLab(15, { p1: 'Disolver 43,0 g de NaCl.' });
  const surP2 = deLab(15, { p2: 'Agitar durante 10 minutos.' }, { estado: 'aceptada' });
  return {
    sugerencias: [...[...centro].reverse(), ...norte, ...surP1, ...surP2],
    comentarios: [
      comentario(5, 15, 'p2', 'Confirmar el <b>tiempo</b>.'),
      comentario(6, 12, 'p3', 'Ya está claro.', 'resuelto'),
    ],
  };
}
