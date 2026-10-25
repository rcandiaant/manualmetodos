import { describe, expect, it } from 'vitest';
import { Node } from '@tiptap/pm/model';
import { aplicarSugerencias, completarGrupo } from '../src/cambios/aplicar';
import { claveGrupo } from '../src/cambios/conflictos';
import { bidsMovidos } from '../src/cambios/estructura';
import { calcularSugerencias, listarBloques } from '../src/cambios/sugerencias';
import { esquemaManual, validarDocumento } from '../src/esquema/esquema';
import type { DocJSON, Sugerencia } from '../src/tipos';
import { doc, ecuacion, item, lista, parrafo, texto } from './ayudantes-doc';
import { PALABRAS, conInline, lugares, mutar, prng, type Azar } from './ayudantes-mutacion';

/**
 * C1 (revisión final): con aceptación PARCIAL de las inserciones de un mismo ancla,
 * cada bloque insertado aceptado queda en su contenedor de la copia (anti-objetivo 1).
 */

const it_ = (bid: string, t = bid) => item(null, parrafo(bid, t));

describe('aceptación parcial de una cadena de primeros hijos (C1)', () => {
  it('L0[a1] L1[n1,n2,i1]: aceptar solo n2 lo deja en L1 antes de i1', () => {
    const base = doc(lista(it_('a1')), lista(it_('i1')));
    const copia = doc(lista(it_('a1')), lista(it_('n1'), it_('n2'), it_('i1')));
    const s = calcularSugerencias(base, copia, 'labA');
    const n2 = s.filter((x) => JSON.stringify(x.propuesta).includes('"n2"'));
    expect(n2).toHaveLength(1);
    expect(n2[0]).toMatchObject({ primerHijo: true, siguiente: 'i1' });
    expect(aplicarSugerencias(base, n2)).toEqual(doc(lista(it_('a1')), lista(it_('n2'), it_('i1'))));
    // Aceptar todo sigue reproduciendo la copia, en orden.
    expect(aplicarSugerencias(base, s)).toEqual(copia);
    // Ids estables entre guardados: recalcular da los mismos, y si el laboratorio quita n1
    // el id de n2 no cambia (su lugar —profundidad, primerHijo, siguiente— es el mismo).
    expect(calcularSugerencias(base, copia, 'labA').map((x) => x.id)).toEqual(s.map((x) => x.id));
    const sinN1 = calcularSugerencias(base, doc(lista(it_('a1')), lista(it_('n2'), it_('i1'))), 'labA');
    expect(sinN1.map((x) => x.id)).toEqual([n2[0].id]);
  });

  it('movimiento rechazado en primera posición + ítem nuevo vecino aceptado: queda en su lista', () => {
    const base = doc(lista(it_('a1')), lista(it_('i1'), it_('i2'), it_('i3')));
    const copia = doc(lista(it_('a1')), lista(it_('i3'), it_('n'), it_('i1'), it_('i2')));
    const s = calcularSugerencias(base, copia, 'labA');
    const nuevo = s.filter((x) => x.tipo === 'bloque-insertado' && x.grupo === undefined);
    expect(nuevo).toHaveLength(1);
    const movidas = s.filter((x) => x.grupo !== undefined);
    expect(movidas.length).toBeGreaterThan(0);
    const aceptadas = completarGrupo(nuevo, s, movidas);
    expect(aplicarSugerencias(base, aceptadas)).toEqual(
      doc(lista(it_('a1')), lista(it_('n'), it_('i1'), it_('i2'), it_('i3'))),
    );
    expect(aplicarSugerencias(base, s)).toEqual(copia);
  });
});

describe('autor de calcularSugerencias (M5)', () => {
  const base = doc(parrafo('p1', 'a'));
  const copia = doc(parrafo('p1', 'b'));
  it('acepta el juego de caracteres del servidor', () => {
    for (const autor of ['labA', 'lab-01', 'u@inia+x_1', 'a'.repeat(60)]) {
      const s = calcularSugerencias(base, copia, autor);
      for (const x of s) expect(x.id).toMatch(/^[A-Za-z0-9:@+_-]{1,190}$/);
    }
  });
  it('lanza con autor vacío, largo o con caracteres fuera del juego', () => {
    for (const autor of ['', 'a'.repeat(61), 'Laboratorio 1', 'Ñuñoa', 'lab:1', 'lab.1']) {
      expect(() => calcularSugerencias(base, copia, autor), autor).toThrow(/^Autor inválido/);
    }
  });
});

// ---------------------------------------------------------------------------
// Propiedad: subconjuntos aleatorios de unidades aceptadas de un laboratorio.
// ---------------------------------------------------------------------------

const seccion = (bid: string, t: string): DocJSON => ({ type: 'seccion', attrs: { bid }, content: [texto(t)] });
const listaDe = (tipo: string, items: DocJSON[]): DocJSON => ({ type: tipo, content: items });

function capitulo(az: Azar, c: number): DocJSON {
  let n = 0;
  const bid = () => `c${c}b${++n}`;
  const p = () => conInline(parrafo(bid()), az);
  const lst = (prof: number): DocJSON =>
    listaDe(
      az.elegir(['listaOrdenada', 'listaVinetas']),
      Array.from({ length: 2 + az.entero(3) }, () => {
        const hijos = [p()];
        if (az.r() < 0.3) hijos.push(p());
        if (prof === 0 && az.r() < 0.3) hijos.push(lst(1));
        return item(null, ...hijos);
      }),
    );
  const tabla = (): DocJSON => ({
    type: 'tabla',
    attrs: { columnas: 'll' },
    content: [0, 1].map(() => ({
      type: 'filaTabla',
      content: [0, 1].map(() => ({ type: 'celda', attrs: { bid: bid() }, content: [texto(az.elegir(PALABRAS))] })),
    })),
  });
  const bloques: DocJSON[] = [];
  for (let k = 0; k < 4; k++) {
    bloques.push(seccion(bid(), `Sección ${k}`), p());
    // Listas seguidas (sin párrafo entre medio) para que el ancla viva en otra lista.
    for (let j = 0; j < 3; j++) bloques.push(az.elegir([p, () => lst(0), () => lst(0), tabla, () => ecuacion(bid(), `x_${j}`)])());
  }
  return doc(...bloques);
}

let nuevos = 0;

/**
 * Mutación extra (local a esta prueba): 2–3 ítems nuevos seguidos en una lista, a menudo
 * al inicio (cadena de primeros hijos cuyo ancla vive en el contenedor anterior).
 */
function cadenaDeItems(az: Azar, d: DocJSON): void {
  const { listas } = lugares(d);
  if (listas.length === 0) return;
  const l = az.elegir(listas);
  const pos = az.r() < 0.7 ? 0 : az.entero(l.content!.length + 1);
  const n = 2 + az.entero(2);
  for (let i = 0; i < n; i++) l.content!.splice(pos + i, 0, item(null, conInline(parrafo(`m${++nuevos}`), az)));
}

const normalizar = (d: DocJSON): DocJSON => Node.fromJSON(esquemaManual, d).toJSON() as DocJSON;

/** Ancestros desde `doc` (incluido) hasta el bloque con `bid` (incluido), o null. */
function ruta(raiz: DocJSON, bid: string): DocJSON[] | null {
  const rec = (n: DocJSON, camino: DocJSON[]): DocJSON[] | null => {
    const c = [...camino, n];
    if (n.type !== 'doc' && n.attrs?.bid === bid) return c;
    for (const h of n.content ?? []) {
      const r = rec(h, c);
      if (r) return r;
    }
    return null;
  };
  return rec(raiz, []);
}

const bidsEn = (n: DocJSON): string[] =>
  listarBloques({ type: 'doc', content: [n] }).flatMap((b) => (b.bid !== null ? [b.bid] : []));

/**
 * Oráculo de ubicación. Para cada inserción aceptada X (profundidad d, padre P en la copia):
 * - la secuencia de tipos desde `doc` hasta X es la misma en la copia y en el resultado;
 * - todo bid "testigo" de un hermano Y de X en P (bid de la base que el laboratorio no movió,
 *   o bid clave de otra inserción aceptada) tiene, en el resultado, su ancestro de
 *   profundidad d como hermano de X (mismo padre) y del mismo lado (antes/después).
 * Devuelve la lista de violaciones (vacía si todo cuadra).
 */
function violaciones(base: DocJSON, copia: DocJSON, aceptadas: Sugerencia[], res: DocJSON): string[] {
  const movidos = bidsMovidos(base, copia);
  const enBase = new Set(bidsEn(base));
  const insertadas = aceptadas.filter((s) => s.tipo === 'bloque-insertado');
  const clave = (s: Sugerencia) => bidsEn(s.propuesta[0])[0];
  const claves = new Set(insertadas.map(clave));
  const testigo = (b: string) => (enBase.has(b) && !movidos.has(b) && !b.startsWith('@')) || claves.has(b);
  const errores: string[] = [];
  for (const s of insertadas) {
    const k = clave(s);
    const d = s.profundidad as number;
    const rc = ruta(copia, k);
    const rr = ruta(res, k);
    if (!rc || !rr) {
      errores.push(`${s.id}: clave ${k} no encontrada`);
      continue;
    }
    // rc[0] = doc (profundidad -1), rc[d + 1] = X.
    const tipos = (r: DocJSON[]) => r.slice(0, d + 2).map((n) => n.type).join('>');
    if (tipos(rc) !== tipos(rr)) errores.push(`${s.id}: contenedor ${tipos(rr)} ≠ copia ${tipos(rc)}`);
    const xc = rc[d + 1];
    const pc = rc[d];
    const xr = rr[d + 1];
    const pr = rr[d];
    const ic = (pc.content ?? []).indexOf(xc);
    const ir = (pr.content ?? []).indexOf(xr);
    (pc.content ?? []).forEach((yc, j) => {
      if (j === ic) return;
      for (const b of bidsEn(yc).filter(testigo)) {
        const rb = ruta(res, b);
        const yr = rb?.[d + 1];
        if (!rb || rb[d] !== pr || !yr) {
          errores.push(`${s.id} (${k}): el vecino ${b} no comparte contenedor en el resultado`);
          continue;
        }
        const jr = (pr.content ?? []).indexOf(yr);
        if (Math.sign(jr - ir) !== Math.sign(j - ic)) errores.push(`${s.id} (${k}): lado cambiado respecto de ${b}`);
      }
    });
  }
  return errores;
}

describe('propiedad: subconjuntos aleatorios aceptados quedan en su lugar (C1)', () => {
  it('15 capítulos × 20 copias × 4 subconjuntos', () => {
    let aplicados = 0;
    let lanzados = 0;
    let conPrimerHijo = 0;
    const mensajes = new Set<string>();
    for (let c = 0; c < 15; c++) {
      const az = prng(7000 + c);
      const base = normalizar(capitulo(az, c));
      for (let k = 0; k < 20; k++) {
        const crudo = structuredClone(base);
        mutar(az, crudo, 6);
        if (az.r() < 0.6) cadenaDeItems(az, crudo);
        const copia = normalizar(crudo);
        const sugs = calcularSugerencias(base, copia, 'lab');
        const unidades = new Map<string, Sugerencia[]>();
        for (const s of sugs) {
          const u = claveGrupo(s) ?? s.id;
          unidades.set(u, [...(unidades.get(u) ?? []), s]);
        }
        for (let m = 0; m < 4; m++) {
          const acept: Sugerencia[] = [];
          const rech: Sugerencia[] = [];
          for (const u of unidades.values()) (az.r() < 0.5 ? acept : rech).push(...u);
          const aceptadas = completarGrupo(acept, sugs, rech);
          if (aceptadas.some((s) => s.primerHijo)) conPrimerHijo++;
          const caso = `capítulo ${c}, copia ${k}, subconjunto ${m}`;
          let res: DocJSON;
          try {
            res = aplicarSugerencias(base, aceptadas);
          } catch (e) {
            // Permitido solo como error visible (mensaje no vacío).
            expect(e, caso).toBeInstanceOf(Error);
            expect((e as Error).message.length, caso).toBeGreaterThan(0);
            mensajes.add((e as Error).message.replace(/lab:[^ ]+/g, 'ID').slice(0, 60));
            lanzados++;
            continue;
          }
          expect(validarDocumento(res), caso).toEqual({ ok: true });
          expect(violaciones(base, copia, aceptadas, res), caso).toEqual([]);
          aplicados++;
        }
      }
    }
    expect(aplicados + lanzados).toBe(1200);
    expect(conPrimerHijo).toBeGreaterThan(30); // las cadenas de primeros hijos se ejercitan
    expect(lanzados, [...mensajes].join('\n')).toBeLessThan(aplicados / 10);
  });
});
