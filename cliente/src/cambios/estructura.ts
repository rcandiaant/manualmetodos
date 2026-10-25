import { diffArrays } from 'diff';
import type { DocJSON, Sugerencia } from '../tipos';
import { claveGrupo } from './conflictos';
import { bidDe, esBloque } from './sugerencias';

/**
 * I1: cambios de estructura que conservan los bid (unir un ítem al anterior con
 * Backspace, mover un bloque a otro ítem o lista, reordenar, cambiar el tipo).
 * `bidsMovidos` da esos bloques; `calcularSugerencias` representa cada uno como un
 * par eliminación + inserción con el mismo `grupo`. Los avisos se mantienen para
 * los bloques que, por lo que sea, no queden cubiertos por un par
 * (`avisosNoCubiertos`): nunca un cambio de lugar silencioso.
 */

interface Ubicado {
  bid: string;
  nodo: DocJSON;
  /** Contenedores desde el hijo de `doc` hasta el padre del bloque. */
  ancestros: DocJSON[];
}

/** Bloques con bid en orden de documento (la primera aparición de cada bid). */
function ubicar(doc: DocJSON): Map<string, Ubicado> {
  const res = new Map<string, Ubicado>();
  const visitar = (n: DocJSON, ancestros: DocJSON[]) => {
    if (esBloque(n)) {
      const bid = bidDe(n);
      if (bid !== null && !res.has(bid)) res.set(bid, { bid, nodo: n, ancestros });
      return;
    }
    const hijos = n.type === 'doc' ? ancestros : [...ancestros, n];
    for (const h of n.content ?? []) visitar(h, hijos);
  };
  visitar(doc, []);
  return res;
}

/**
 * Clave de cada contenedor: el bloque común (presente en base y copia) de su
 * subárbol que va primero en la base. Si dos documentos agrupan los bloques
 * comunes de la misma forma en cada nivel, cada bloque tiene las mismas claves.
 */
function clavesContenedores(ubicados: Map<string, Ubicado>, ordenBase: Map<string, number>): Map<DocJSON, string> {
  const claves = new Map<DocJSON, string>();
  for (const u of ubicados.values()) {
    const i = ordenBase.get(u.bid);
    if (i === undefined) continue; // bloque nuevo o eliminado: no cuenta
    for (const a of u.ancestros) {
      const actual = claves.get(a);
      if (actual === undefined || i < (ordenBase.get(actual) as number)) claves.set(a, u.bid);
    }
  }
  return claves;
}

/** Firma de ubicación: tipo de cada ancestro con su clave. */
const firmaUbicacion = (u: Ubicado, claves: Map<DocJSON, string>): string =>
  u.ancestros.map((a) => `${a.type}#${claves.get(a) ?? ''}`).join('/');

function textoPlano(nodos: DocJSON[]): string {
  return nodos
    .map((n): string => {
      if (n.type === 'text') return n.text ?? '';
      if (n.type === 'matematica') return `$${n.attrs?.latex ?? ''}$`;
      if (n.type === 'referencia') return `[${n.attrs?.etiqueta ?? ''}]`;
      return typeof n.attrs?.latex === 'string' ? n.attrs.latex : textoPlano(n.content ?? []);
    })
    .join('');
}

/** Extracto corto del bloque para nombrarlo en el aviso. */
function extracto(nodo: DocJSON, max = 60): string {
  const t = textoPlano([nodo]).replace(/\s+/g, ' ').trim();
  if (t === '') return '(bloque vacío)';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Compara la posición estructural de cada bloque presente en ambos documentos
 * (tipo del bloque, cadena de contenedores y orden relativo) y devuelve, en orden
 * de documento de la copia, un aviso legible por cada bloque que cambió. Insertar,
 * eliminar o editar bloques no produce avisos. Un bloque movido hacia un
 * contenedor posterior puede arrastrar también a sus nuevos vecinos.
 */
function analizarEstructura(base: DocJSON, copia: DocJSON): { bid: string; aviso: string }[] {
  const ub = ubicar(base);
  const uc = ubicar(copia);
  const comunesBase = [...ub.keys()].filter((b) => uc.has(b));
  const comunes = new Set(comunesBase);
  const comunesCopia = [...uc.keys()].filter((b) => comunes.has(b));
  const ordenBase = new Map(comunesBase.map((b, i) => [b, i] as const));

  const clavesBase = clavesContenedores(ub, ordenBase);
  const clavesCopia = clavesContenedores(uc, ordenBase);

  const avisos = new Map<string, string>();
  const nombre = (bid: string) => `«${extracto((uc.get(bid) as Ubicado).nodo)}»`;
  for (const bid of comunesCopia) {
    const b = ub.get(bid) as Ubicado;
    const c = uc.get(bid) as Ubicado;
    if (b.nodo.type !== c.nodo.type) {
      avisos.set(bid, `El bloque ${nombre(bid)} cambió de tipo (${b.nodo.type} → ${c.nodo.type}).`);
    } else if (firmaUbicacion(b, clavesBase) !== firmaUbicacion(c, clavesCopia)) {
      avisos.set(
        bid,
        `El bloque ${nombre(bid)} cambió de lugar en la estructura (p. ej., se unió a otro ítem o pasó a otra lista).`,
      );
    }
  }

  // Orden relativo de los demás: los que quedan fuera de la subsecuencia común más larga se movieron.
  const quedan = (bs: string[]) => bs.filter((b) => !avisos.has(b));
  for (const c of diffArrays(quedan(comunesBase), quedan(comunesCopia))) {
    if (!c.added) continue;
    for (const bid of c.value) avisos.set(bid, `El bloque ${nombre(bid)} cambió de orden respecto de los bloques vecinos.`);
  }

  return comunesCopia.filter((b) => avisos.has(b)).map((bid) => ({ bid, aviso: avisos.get(bid) as string }));
}

/** Bids conservados (en base y copia) cuyo tipo, contenedor u orden relativo cambió. */
export function bidsMovidos(base: DocJSON, copia: DocJSON): Set<string> {
  return new Set(analizarEstructura(base, copia).map((a) => a.bid));
}

/** Un aviso legible por cada bloque de `bidsMovidos`, en orden de documento de la copia. */
export function detectarCambiosEstructura(base: DocJSON, copia: DocJSON): string[] {
  return analizarEstructura(base, copia).map((a) => a.aviso);
}

/**
 * Bids cubiertos por un par completo de `sugerencias`: un `bloque-eliminado` del bid
 * con `grupo` y un `bloque-insertado` del mismo autor y grupo.
 */
export function bidsCubiertos(sugerencias: Sugerencia[]): Set<string> {
  const clave = (s: Sugerencia) => claveGrupo(s) as string;
  const conInsercion = new Set(
    sugerencias.filter((s) => s.grupo !== undefined && s.tipo === 'bloque-insertado').map(clave),
  );
  return new Set(
    sugerencias
      .filter((s) => s.grupo !== undefined && s.tipo === 'bloque-eliminado' && conInsercion.has(clave(s)))
      .map((s) => s.bloqueId),
  );
}

/**
 * Avisos de `detectarCambiosEstructura` cuyos bloques no quedan cubiertos por un par
 * de `sugerencias` (que deben ser del mismo laboratorio que `copia`).
 */
export function avisosNoCubiertos(base: DocJSON, copia: DocJSON, sugerencias: Sugerencia[]): string[] {
  const cubiertos = bidsCubiertos(sugerencias);
  return analizarEstructura(base, copia)
    .filter((a) => !cubiertos.has(a.bid))
    .map((a) => a.aviso);
}

/** Cadena de ancestros (sin `doc`) e índice del bloque con ese bid, o null. */
function ubicarConIndice(doc: DocJSON, bid: string): { ancestros: DocJSON[]; padre: DocJSON } | null {
  let res: { ancestros: DocJSON[]; padre: DocJSON } | null = null;
  const visitar = (n: DocJSON, ancestros: DocJSON[]) => {
    if (res) return;
    for (const h of n.content ?? []) {
      if (esBloque(h)) {
        if (bidDe(h) === bid) {
          res = { ancestros, padre: n };
          return;
        }
        continue;
      }
      visitar(h, [...ancestros, h]);
      if (res) return;
    }
  };
  visitar(doc, []);
  return res;
}

/**
 * «unido» si el bloque pasó a ser hijo del ítem anterior al suyo, en el mismo nivel
 * de lista (lo que hace Backspace al inicio de un ítem); si no, «movido».
 */
export function tipoMovimiento(base: DocJSON, copia: DocJSON, bid: string): 'movido' | 'unido' {
  const b = ubicarConIndice(base, bid);
  const c = ubicarConIndice(copia, bid);
  if (!b || !c || b.padre.type !== 'item' || c.padre.type !== 'item') return 'movido';
  if (b.ancestros.length !== c.ancestros.length) return 'movido';
  const listaBase = b.ancestros[b.ancestros.length - 2];
  const i = listaBase?.content?.indexOf(b.padre) ?? -1;
  const anterior = i > 0 ? listaBase?.content?.[i - 1] : undefined;
  const primero = (it: DocJSON | undefined) => {
    const p = it?.content?.[0];
    return p && esBloque(p) ? bidDe(p) : null;
  };
  const clave = primero(anterior);
  return clave !== null && clave !== bid && clave === primero(c.padre) ? 'unido' : 'movido';
}
