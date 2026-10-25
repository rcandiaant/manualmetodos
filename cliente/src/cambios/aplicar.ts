import type { ContentMatch, NodeType } from '@tiptap/pm/model';
import { esquemaManual } from '../esquema/esquema';
import type { DocJSON, Sugerencia } from '../tipos';
import { claveGrupo, detectarConflictos } from './conflictos';
import { ANCLA_INICIO, listarBloques } from './sugerencias';
import { BLOQUES_ATOMICOS, jsonEstable, tokenizarBloque, tokensANodos } from './tokens';

/** Pseudo-bloques de la cabecera: se localizan por tipo, no por attr `bid`. */
const TIPO_CABECERA: Record<string, string> = { '@analito': 'analito', '@metodo': 'metodo' };
const TIPOS_CABECERA = new Set(Object.values(TIPO_CABECERA));

interface Eslabon {
  nodo: DocJSON;
  padre: DocJSON;
  indice: number;
}

/** Cadena desde el nodo buscado hasta la raíz: [nodo en su padre, padre en el abuelo, …]. */
function buscar(raiz: DocJSON, es: (n: DocJSON) => boolean): Eslabon[] | null {
  const rec = (padre: DocJSON): Eslabon[] | null => {
    const hijos = padre.content ?? [];
    for (let i = 0; i < hijos.length; i++) {
      const nodo = hijos[i];
      if (es(nodo)) return [{ nodo, padre, indice: i }];
      const sub = rec(nodo);
      if (sub) return [...sub, { nodo, padre, indice: i }];
    }
    return null;
  };
  return rec(raiz);
}

function buscarBloque(raiz: DocJSON, bid: string): Eslabon[] {
  const tipoCabecera = TIPO_CABECERA[bid];
  const cadena = buscar(raiz, (n) =>
    tipoCabecera ? n.type === tipoCabecera : n.attrs?.bid === bid && !TIPOS_CABECERA.has(n.type ?? ''),
  );
  if (!cadena) throw new Error(`Bloque no encontrado: ${bid}`);
  return cadena;
}

const numCabecera = (d: DocJSON): number => {
  let n = 0;
  while (TIPOS_CABECERA.has(d.content?.[n]?.type ?? '')) n++;
  return n;
};

/** Une nodos de texto adyacentes con las mismas marcas. */
function fusionarTexto(nodos: DocJSON[]): DocJSON[] {
  const res: DocJSON[] = [];
  for (const n of nodos) {
    const ultimo = res[res.length - 1];
    if (
      n.type === 'text' &&
      ultimo?.type === 'text' &&
      jsonEstable(ultimo.marks ?? []) === jsonEstable(n.marks ?? [])
    ) {
      ultimo.text = (ultimo.text ?? '') + (n.text ?? '');
    } else {
      res.push(n);
    }
  }
  return res.filter((n) => n.type !== 'text' || (n.text ?? '') !== '');
}

/** Ediciones de contenido/formato de un bloque, en un solo recorrido sobre los tokens base. */
function editarBloque(raiz: DocJSON, bid: string, sugs: Sugerencia[]): void {
  const [{ nodo, padre, indice }] = buscarBloque(raiz, bid);
  if (BLOQUES_ATOMICOS.has(nodo.type ?? '')) {
    // Un bloque atómico es un único token: la propuesta trae el bloque completo.
    const propuesta = sugs.flatMap((s) => structuredClone(s.propuesta));
    padre.content?.splice(indice, 1, ...propuesta);
    return;
  }
  const tokens = tokenizarBloque(nodo);
  // Equivale a reemplazar de derecha a izquierda; a igual `desde`, una inserción pura
  // (rango vacío) va antes que el reemplazo que empieza en ese mismo token.
  const orden = [...sugs].sort((a, b) => a.base.desde - b.base.desde || a.base.hasta - b.base.hasta);
  const salida: DocJSON[] = [];
  let cursor = 0;
  for (const s of orden) {
    if (s.base.desde < cursor || s.base.hasta > tokens.length) {
      throw new Error(`Sugerencia fuera de rango o solapada: ${s.id}`);
    }
    salida.push(...tokensANodos(tokens.slice(cursor, s.base.desde)));
    salida.push(...structuredClone(s.propuesta));
    cursor = s.base.hasta;
  }
  salida.push(...tokensANodos(tokens.slice(cursor)));
  const contenido = fusionarTexto(salida);
  if (contenido.length > 0) nodo.content = contenido;
  else delete nodo.content;
}

function numeroInsercion(s: Sugerencia): number {
  const m = /:\+(\d+)$/.exec(s.id);
  if (!m) throw new Error(`Id de inserción malformado: ${s.id}`);
  return Number(m[1]);
}

/** Estado del autómata `content` de `tipoPadre` tras consumir `tipos`, o null si no encaja. */
function recorrer(tipoPadre: NodeType, tipos: string[]): ContentMatch | null {
  let m: ContentMatch | null = tipoPadre.contentMatch;
  for (const t of tipos) {
    const tipoHijo = esquemaManual.nodes[t];
    m = tipoHijo && m ? m.matchType(tipoHijo) : null;
    if (!m) return null;
  }
  return m;
}

/** true si `tipo` etiqueta alguna transición alcanzable del autómata `content`. */
function apareceEnContenido(tipoPadre: NodeType, tipo: string): boolean {
  const vistos = new Set<ContentMatch>();
  const pendientes = [tipoPadre.contentMatch];
  while (pendientes.length > 0) {
    const m = pendientes.pop() as ContentMatch;
    if (vistos.has(m)) continue;
    vistos.add(m);
    for (let i = 0; i < m.edgeCount; i++) {
      const { type, next } = m.edge(i);
      if (type.name === tipo) return true;
      pendientes.push(next);
    }
  }
  return false;
}

/**
 * true si `padre` admite un hijo de tipo `tipo` en la posición `indice + 1`, según las
 * reglas `content` de `esquemaManual`: el contenido resultante debe seguir siendo válido.
 * Si el contenido actual de `padre` ya no cumple el esquema (p. ej. un doc sin cabecera),
 * basta con que el tipo figure en su expresión `content`.
 */
function admite(padre: DocJSON, indice: number, tipo: string): boolean {
  const tipoPadre = esquemaManual.nodes[padre.type ?? ''];
  if (!tipoPadre || !esquemaManual.nodes[tipo]) return false;
  const tipos = (padre.content ?? []).map((h) => h.type ?? '');
  if (!recorrer(tipoPadre, tipos)?.validEnd) return apareceEnContenido(tipoPadre, tipo);
  tipos.splice(indice + 1, 0, tipo);
  return recorrer(tipoPadre, tipos)?.validEnd ?? false;
}

/**
 * Inserta los bloques nuevos de un ancla en orden ascendente de `n` (R8). Cada uno se
 * ubica tras su predecesor (el bloque ancla o la inserción anterior): justo después del
 * ancestro del predecesor cuya profundidad es `profundidad` (R13). Sin `profundidad`,
 * como hermano del primer ancestro cuyo padre admite el tipo insertado (R4).
 * Una inserción `primerHijo` se ubica, en cambio, justo antes del ancestro de su bloque
 * `siguiente` cuya profundidad es `profundidad`; las siguientes se encadenan tras ella.
 * Si `siguiente` falta o lo elimina otra sugerencia aceptada (`eliminados`), lanza error.
 */
function insertarEnAncla(raiz: DocJSON, ancla: string, sugs: Sugerencia[], eliminados: Set<string>): void {
  let previo: DocJSON | null = null;
  const ordenadas = sugs
    .map((s) => ({ n: numeroInsercion(s), s }))
    .sort((a, b) => a.n - b.n)
    .map(({ s }) => s);
  for (const s of ordenadas) {
    const nuevo = structuredClone(s.propuesta[0]);
    const tipo = nuevo?.type ?? '';
    const lugar = s.primerHijo ? `antes de ${s.siguiente ?? '(sin siguiente)'}` : `tras ${ancla}`;
    const error = () => new Error(`No se puede ubicar la inserción ${s.id} (${tipo || 'vacía'}) ${lugar}`);
    const valido = ({ padre, indice }: Eslabon) =>
      admite(padre, indice, tipo) && (padre !== raiz || indice + 1 >= numCabecera(raiz));
    // `destino`: se inserta en `destino.padre` en la posición `destino.indice + 1`.
    let destino: Eslabon | undefined;
    if (s.primerHijo) {
      const sig = s.siguiente;
      if (!nuevo || sig === undefined || s.profundidad === undefined || eliminados.has(sig)) throw error();
      let cadena: Eslabon[];
      try {
        cadena = buscarBloque(raiz, sig);
      } catch {
        throw error();
      }
      const candidato = cadena[cadena.length - 1 - s.profundidad];
      const antes = candidato && { ...candidato, indice: candidato.indice - 1 };
      destino = antes && valido(antes) ? antes : undefined;
    } else {
      let cadena: Eslabon[] | null;
      if (previo) {
        const p = previo;
        cadena = buscar(raiz, (n) => n === p);
      } else if (ancla === ANCLA_INICIO) {
        // Sin bloque previo: se coloca al inicio del cuerpo (tras la cabecera, si la hay).
        cadena = [{ nodo: raiz, padre: raiz, indice: numCabecera(raiz) - 1 }];
      } else {
        cadena = buscarBloque(raiz, ancla);
      }
      const eslabones = cadena ?? [];
      if (s.profundidad !== undefined) {
        // eslabones[k].nodo tiene profundidad eslabones.length - 1 - k.
        const candidato = eslabones[eslabones.length - 1 - s.profundidad];
        destino = candidato && valido(candidato) ? candidato : undefined;
      } else {
        destino = eslabones.find(valido);
      }
    }
    if (!nuevo || !destino) throw error();
    destino.padre.content ??= [];
    destino.padre.content.splice(destino.indice + 1, 0, nuevo);
    previo = nuevo;
  }
}

/**
 * Quita contenedores que quedaron vacíos (item, listas, tablas, filas). Un item que
 * conserva hijos pero perdió su párrafo inicial no se puede reparar sin perder
 * contenido: lanza error (R14). `eliminadoEn` da el bid eliminado de cada item.
 */
function limpiarVaciados(nodo: DocJSON, eliminadoEn: Map<DocJSON, string>): void {
  if (!nodo.content) return;
  for (const h of nodo.content) limpiarVaciados(h, eliminadoEn);
  nodo.content = nodo.content.filter((h) => {
    const hijos = h.content ?? [];
    switch (h.type) {
      case 'item':
        if (hijos.length > 0 && hijos[0].type !== 'parrafo') {
          throw new Error(
            `No se puede eliminar el párrafo inicial de un ítem con contenido anidado: ${eliminadoEn.get(h) ?? '?'}`,
          );
        }
        return hijos.length > 0;
      case 'listaOrdenada':
      case 'listaVinetas':
      case 'tabla':
      case 'filaTabla':
        return hijos.length > 0;
      default:
        return true;
    }
  });
}

/**
 * Las aceptadas más los miembros que les faltan de sus grupos (mismo autor y
 * `grupo`), en el orden de `todas`. Lanza error si un miembro de un grupo con alguna
 * aceptada está en `rechazadas`: la UI decide los grupos enteros.
 */
export function completarGrupo(
  aceptadas: Sugerencia[],
  todas: Sugerencia[],
  rechazadas: Sugerencia[] = [],
): Sugerencia[] {
  const grupos = new Set(aceptadas.map(claveGrupo).filter((g): g is string => g !== null));
  const rechazadasDeGrupo = rechazadas.filter((s) => {
    const g = claveGrupo(s);
    return g !== null && grupos.has(g);
  });
  if (rechazadasDeGrupo.length > 0) {
    const r = rechazadasDeGrupo[0];
    throw new Error(
      `Grupo decidido a medias (bloque movido «${r.grupo}» del ${r.autor}): ` +
        `${rechazadasDeGrupo.map((x) => x.id).join(', ')} rechazada(s) y otra parte aceptada. ` +
        'Acepte o rechace el movimiento entero.',
    );
  }
  const ids = new Set(aceptadas.map((s) => s.id));
  const faltan = todas.filter((s) => {
    const g = claveGrupo(s);
    return g !== null && grupos.has(g) && !ids.has(s.id);
  });
  return [...aceptadas, ...faltan];
}

/**
 * Cada grupo aceptado debe estar completo: todo bid de la base contenido en sus
 * inserciones aceptadas tiene su eliminación aceptada (si no, ese bid quedaría
 * duplicado), y toda eliminación aceptada del grupo está contenida en una inserción
 * aceptada (si no, el bloque se perdería). Lanza «Grupo incompleto» con lo que falta.
 */
function validarGrupos(base: DocJSON, aceptadas: Sugerencia[]): void {
  const enBase = new Set(listarBloques(base).flatMap((b) => (b.bid !== null ? [b.bid] : [])));
  const partes = new Map<string, { s: Sugerencia; insertados: Set<string>; eliminados: Set<string> }>();
  for (const s of aceptadas) {
    const g = claveGrupo(s);
    if (g === null) continue;
    const p = partes.get(g) ?? { s, insertados: new Set<string>(), eliminados: new Set<string>() };
    if (s.tipo === 'bloque-insertado') {
      for (const b of listarBloques({ type: 'doc', content: s.propuesta })) {
        if (b.bid !== null && enBase.has(b.bid)) p.insertados.add(b.bid);
      }
    } else if (s.tipo === 'bloque-eliminado') {
      p.eliminados.add(s.bloqueId);
    }
    partes.set(g, p);
  }
  for (const { s, insertados, eliminados } of partes.values()) {
    const sinEliminar = [...insertados].filter((b) => !eliminados.has(b));
    const sinInsertar = [...eliminados].filter((b) => !insertados.has(b));
    if (sinEliminar.length === 0 && sinInsertar.length === 0) continue;
    const faltan = [
      sinEliminar.length > 0 ? `falta aceptar la eliminación de ${sinEliminar.join(', ')}` : '',
      sinInsertar.length > 0 ? `falta aceptar la inserción en su lugar nuevo de ${sinInsertar.join(', ')}` : '',
    ].filter(Boolean);
    throw new Error(
      `Grupo incompleto (bloque movido «${s.grupo}» del ${s.autor}): ${faltan.join('; ')}. ` +
        'Acepte o rechace el movimiento entero.',
    );
  }
}

export function aplicarSugerencias(base: DocJSON, aceptadas: Sugerencia[]): DocJSON {
  const conflictos = detectarConflictos(aceptadas);
  if (conflictos.length > 0) {
    throw new Error(`Sugerencias en conflicto: ${conflictos.map((c) => c.ids.join(', ')).join('; ')}`);
  }
  validarGrupos(base, aceptadas);
  const res = structuredClone(base);
  if (aceptadas.length === 0) return res;

  const agrupar = (tipos: string[]) => {
    const m = new Map<string, Sugerencia[]>();
    for (const s of aceptadas) {
      if (!tipos.includes(s.tipo)) continue;
      m.set(s.bloqueId, [...(m.get(s.bloqueId) ?? []), s]);
    }
    return m;
  };

  const eliminadas = agrupar(['bloque-eliminado']);
  const bidsEliminados = new Set(eliminadas.keys());
  const eliminadoEn = new Map<DocJSON, string>();
  const eliminar = (bid: string) => {
    if (TIPO_CABECERA[bid]) throw new Error(`No se puede eliminar la cabecera: ${bid}`);
    const [{ padre, indice }] = buscarBloque(res, bid);
    padre.content?.splice(indice, 1);
    if (padre.type === 'item' && indice === 0) {
      const grupo = eliminadas.get(bid)?.find((s) => s.grupo !== undefined)?.grupo;
      eliminadoEn.set(
        padre,
        grupo === undefined
          ? bid
          : `${bid} (bloque movido «${grupo}»: acepte también el movimiento del contenido que quedaba en su ítem)`,
      );
    }
  };
  const deGrupo = (sugs: Sugerencia[]) => sugs.some((s) => s.grupo !== undefined);

  // 1) Texto, con los bloques aún intactos (los rangos son de la base).
  for (const [bid, sugs] of agrupar(['contenido', 'formato'])) editarBloque(res, bid, sugs);
  // 2) Eliminaciones de bloques movidos, antes de reinsertarlos con el mismo bid (si no,
  //    habría dos bloques con ese bid). Un bloque movido nunca es ancla ni `siguiente`
  //    de una inserción de su autor; si lo es de otro autor, `detectarConflictos` ya choca.
  for (const [bid, sugs] of eliminadas) if (deGrupo(sugs)) eliminar(bid);
  // 3) Inserciones, antes de las demás eliminaciones para que sus anclas sigan existiendo.
  for (const [ancla, sugs] of agrupar(['bloque-insertado'])) insertarEnAncla(res, ancla, sugs, bidsEliminados);
  // 4) Demás eliminaciones y limpieza de contenedores vaciados.
  for (const [bid, sugs] of eliminadas) if (!deGrupo(sugs)) eliminar(bid);
  // Tras todas las eliminaciones: si el mismo autor vació el item entero, no hay error.
  if (eliminadas.size > 0) limpiarVaciados(res, eliminadoEn);
  return res;
}
