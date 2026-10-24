import { diffArrays } from 'diff';
import type { DocJSON, Sugerencia } from '../tipos';
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

const esBloque = (n: DocJSON): boolean => BLOQUES_CON_BID.has(n.type ?? '');
const bidDe = (n: DocJSON): string | null => {
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
      id: `${autor}:${bid}:${grupo.b0}`,
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
  return res;
}

export function calcularSugerencias(base: DocJSON, copia: DocJSON, autor: string): Sugerencia[] {
  const bloquesBase = new Map<string, DocJSON>();
  for (const b of listarBloques(base)) if (b.bid !== null) bloquesBase.set(b.bid, b.nodo);

  const res: Sugerencia[] = [];
  const vistos = new Set<string>();
  /** Inserciones ya emitidas por ancla: dan el `n` del id `${autor}:${ancla}:+${n}`. */
  const insercionesPorAncla = new Map<string, number>();
  let ancla: string | null = null;

  /** Un bloque de la copia es "existente" si su bid está en la base y no se vio antes. */
  const esExistente = (n: DocJSON): boolean => {
    const bid = bidDe(n);
    return bid !== null && bloquesBase.has(bid) && !vistos.has(bid);
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

  const visitar = (n: DocJSON) => {
    if (esBloque(n) && esExistente(n)) {
      const bid = bidDe(n) as string;
      vistos.add(bid);
      res.push(...diffBloque(bid, bloquesBase.get(bid) as DocJSON, n, autor));
      ancla = bid;
      return;
    }
    if (n.type !== 'doc' && esNuevo(n)) {
      const bloqueId = ancla ?? ANCLA_INICIO;
      const k = insercionesPorAncla.get(bloqueId) ?? 0;
      insercionesPorAncla.set(bloqueId, k + 1);
      res.push({
        // espacio de ids propio (`+n`) para no chocar con contenido/formato en la posición 0
        id: `${autor}:${bloqueId}:+${k}`,
        autor,
        bloqueId,
        base: { desde: 0, hasta: 0 },
        copia: { desde: 0, hasta: 0 },
        original: [],
        propuesta: [structuredClone(n)],
        tipo: 'bloque-insertado',
      });
      return;
    }
    for (const h of n.content ?? []) visitar(h);
  };
  visitar(copia);

  for (const [bid, nodo] of bloquesBase) {
    if (vistos.has(bid)) continue;
    res.push({
      id: `${autor}:${bid}:0`,
      autor,
      bloqueId: bid,
      base: { desde: 0, hasta: tokenizarBloque(nodo).length },
      copia: { desde: 0, hasta: 0 },
      original: [structuredClone(nodo)],
      propuesta: [],
      tipo: 'bloque-eliminado',
    });
  }
  return res;
}
