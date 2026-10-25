import { diffArrays } from 'diff';
import type { DocJSON, Sugerencia } from '../tipos';
import { bidsMovidos } from './estructura';
import { asignarIds } from './identidad';
import { BLOQUES_ATOMICOS, tokenizarBloque, tokensANodos, type Token } from './tokens';

/** Ancla de un bloque insertado antes de cualquier bloque con bid. */
export const ANCLA_INICIO = '@inicio';

/**
 * Cabecera de la ficha (título/subtítulo editables): pseudo-bloques sin attr `bid`
 * que se comparan con un bid fijo.
 */
const BIDS_CABECERA: Record<string, string> = { analito: '@analito', metodo: '@metodo' };

/** Bloques que llevan `bid`: textblocks, bloques atómicos y la cabecera. */
const BLOQUES_CON_BID = new Set([
  'seccion',
  'parrafo',
  'celda',
  ...BLOQUES_ATOMICOS,
  ...Object.keys(BIDS_CABECERA),
]);

export const esBloque = (n: DocJSON): boolean => BLOQUES_CON_BID.has(n.type ?? '');
export const bidDe = (n: DocJSON): string | null => {
  const fijo = BIDS_CABECERA[n.type ?? ''];
  if (fijo) return fijo;
  const b = n.attrs?.bid;
  return typeof b === 'string' ? b : null;
};

export interface BloqueListado {
  bid: string | null;
  nodo: DocJSON;
  /** bid no nulo más cercano antes de este bloque, en orden de documento. */
  anteriorBid: string | null;
}

export function listarBloques(doc: DocJSON): BloqueListado[] {
  const lista: BloqueListado[] = [];
  let anterior: string | null = null;
  const visitar = (n: DocJSON) => {
    if (esBloque(n)) {
      const bid = bidDe(n);
      lista.push({ bid, nodo: n, anteriorBid: anterior });
      if (bid !== null) anterior = bid;
      return; // no se desciende: contenido inline (las notas al pie son átomos)
    }
    for (const h of n.content ?? []) visitar(h);
  };
  visitar(doc);
  return lista;
}

const firma = (t: Token) => `${t.clave}|${t.marcas.join(',')}`;

function diffBloque(
  bid: string,
  base: DocJSON,
  copia: DocJSON,
  autor: string,
): Sugerencia[] {
  const tb = tokenizarBloque(base);
  const tc = tokenizarBloque(copia);
  const cambios = diffArrays(tb.map(firma), tc.map(firma));
  const res: Sugerencia[] = [];
  let ib = 0;
  let ic = 0;
  let grupo: { b0: number; c0: number } | null = null;

  const cerrar = () => {
    if (!grupo) return;
    const orig = tb.slice(grupo.b0, ib);
    const prop = tc.slice(grupo.c0, ic);
    const soloFormato =
      orig.length === prop.length && orig.every((t, k) => t.clave === prop[k].clave);
    res.push({
      id: '',
      autor,
      bloqueId: bid,
      base: { desde: grupo.b0, hasta: ib },
      copia: { desde: grupo.c0, hasta: ic },
      original: tokensANodos(orig),
      propuesta: tokensANodos(prop),
      tipo: soloFormato ? 'formato' : 'contenido',
    });
    grupo = null;
  };

  for (const c of cambios) {
    const n = c.count;
    if (!c.added && !c.removed) {
      cerrar();
      ib += n;
      ic += n;
      continue;
    }
    grupo ??= { b0: ib, c0: ic };
    if (c.removed) ib += n;
    else ic += n;
  }
  cerrar();
  asignarIds(res);
  return res;
}

export function calcularSugerencias(base: DocJSON, copia: DocJSON, autor: string): Sugerencia[] {
  const bloquesBase = new Map<string, DocJSON>();
  for (const b of listarBloques(base)) if (b.bid !== null) bloquesBase.set(b.bid, b.nodo);

  const res: Sugerencia[] = [];
  const vistos = new Set<string>();
  /**
   * Bloques movidos o unidos: al recorrer la copia cuentan como no existentes (van
   * dentro de una inserción, con su bid) y al recorrer la base como eliminados.
   */
  const movidos = bidsMovidos(base, copia);
  /** Grupo de cada bid movido: el de la primera inserción que lo contiene. */
  const grupoDe = new Map<string, string>();
  /** Inserciones ya emitidas por ancla: dan el `orden` de aplicación. */
  const insercionesPorAncla = new Map<string, number>();
  let ancla: string | null = null;

  /** Un bloque de la copia es "existente" si su bid está en la base y no se vio antes. */
  const esExistente = (n: DocJSON): boolean => {
    const bid = bidDe(n);
    return bid !== null && bloquesBase.has(bid) && !vistos.has(bid) && !movidos.has(bid);
  };

  /** Bids movidos (aún sin grupo) dentro del subárbol, en orden de documento. */
  const movidosEn = (n: DocJSON): string[] => {
    const res: string[] = [];
    const rec = (m: DocJSON) => {
      if (esBloque(m)) {
        const bid = bidDe(m);
        if (bid !== null && movidos.has(bid) && !grupoDe.has(bid) && !res.includes(bid)) res.push(bid);
        return;
      }
      for (const h of m.content ?? []) rec(h);
    };
    rec(n);
    return res;
  };

  /** true si el subárbol contiene algún bloque con bid y todos ellos son nuevos. */
  const esNuevo = (n: DocJSON): boolean => {
    let hay = false;
    let algunoExistente = false;
    const rec = (m: DocJSON) => {
      if (algunoExistente) return;
      if (esBloque(m)) {
        hay = true;
        if (esExistente(m)) algunoExistente = true;
        return;
      }
      for (const h of m.content ?? []) rec(h);
    };
    rec(n);
    return hay && !algunoExistente;
  };

  /** Ancestros del nodo visitado, desde `doc`: `pila[d + 1]` tiene profundidad `d`. */
  const pila: DocJSON[] = [];
  /** Inserciones emitidas que aún esperan su `siguiente`, con el padre de su nodo en la copia. */
  let pendientes: { s: Sugerencia; padre: DocJSON; esPrimero: boolean }[] = [];

  /**
   * Al ver un bloque existente: es el `siguiente` de las inserciones pendientes. Una
   * inserción primer hijo (padre no `doc`) se marca `primerHijo` si el ancestro de ese
   * bloque a su misma profundidad es hijo de su mismo padre; si no, queda anclada al anterior.
   * Ese respaldo es prácticamente inalcanzable con padre ≠ `doc`: si el padre contiene un
   * bloque existente, `siguiente` está dentro de él; si no, el padre entero es `esNuevo`.
   */
  const resolverPendientes = (bid: string) => {
    for (const { s, padre, esPrimero } of pendientes) {
      s.siguiente = bid;
      const prof = s.profundidad as number;
      if (esPrimero && padre.type !== 'doc' && pila[prof] === padre && pila[prof + 1] !== undefined) {
        s.primerHijo = true;
      }
    }
    pendientes = [];
  };

  /** `prof`: ancestros de `n` sin contar `doc` (el doc se visita con -1). */
  const visitar = (n: DocJSON, prof: number, padre: DocJSON | null, esPrimero: boolean) => {
    if (esBloque(n) && esExistente(n)) {
      const bid = bidDe(n) as string;
      vistos.add(bid);
      pila.push(n);
      resolverPendientes(bid);
      pila.pop();
      res.push(...diffBloque(bid, bloquesBase.get(bid) as DocJSON, n, autor));
      ancla = bid;
      return;
    }
    if (padre !== null && esNuevo(n)) {
      const bloqueId = ancla ?? ANCLA_INICIO;
      const k = insercionesPorAncla.get(bloqueId) ?? 0;
      insercionesPorAncla.set(bloqueId, k + 1);
      const s: Sugerencia = {
        id: '',
        orden: k,
        autor,
        bloqueId,
        base: { desde: 0, hasta: 0 },
        copia: { desde: 0, hasta: 0 },
        original: [],
        propuesta: [structuredClone(n)],
        tipo: 'bloque-insertado',
        profundidad: prof,
      };
      const propios = movidosEn(n);
      if (propios.length > 0) {
        s.grupo = `mov:${propios[0]}`;
        for (const bid of propios) grupoDe.set(bid, s.grupo);
      }
      res.push(s);
      pendientes.push({ s, padre, esPrimero });
      return;
    }
    pila.push(n);
    (n.content ?? []).forEach((h, i) => visitar(h, prof + 1, n, i === 0));
    pila.pop();
  };
  visitar(copia, -1, null, false);

  for (const [bid, nodo] of bloquesBase) {
    if (vistos.has(bid)) continue;
    const grupo = grupoDe.get(bid);
    res.push({
      id: '',
      autor,
      bloqueId: bid,
      base: { desde: 0, hasta: tokenizarBloque(nodo).length },
      copia: { desde: 0, hasta: 0 },
      original: [structuredClone(nodo)],
      propuesta: [],
      tipo: 'bloque-eliminado',
      ...(grupo !== undefined ? { grupo } : {}),
    });
  }
  asignarIds(res);
  return res;
}
