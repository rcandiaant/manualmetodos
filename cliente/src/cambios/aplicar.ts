import type { DocJSON, Sugerencia } from '../tipos';
import { detectarConflictos } from './conflictos';
import { ANCLA_INICIO } from './sugerencias';
import { BLOQUES_ATOMICOS, jsonEstable, tokenizarBloque, tokensANodos } from './tokens';

/** Pseudo-bloques de la cabecera: se localizan por tipo, no por attr `bid`. */
const TIPO_CABECERA: Record<string, string> = { '@analito': 'analito', '@metodo': 'metodo' };
const TIPOS_CABECERA = new Set(Object.values(TIPO_CABECERA));

/** Grupo `bloque` del esquema (doc: `analito metodo bloque*`). */
const GRUPO_BLOQUE = new Set([
  'seccion',
  'parrafo',
  'listaOrdenada',
  'listaVinetas',
  'tabla',
  'ecuacion',
  'especial',
]);

/**
 * Qué tipos de hijo admite cada contenedor (copia local de las reglas `content` del
 * esquema; el esquema no está disponible en esta rama). `item` es `parrafo bloque*`:
 * una inserción nunca va en la posición 0 (siempre va tras un ancla), así que basta
 * con el grupo `bloque`.
 */
const HIJOS_ADMITIDOS: Record<string, Set<string>> = {
  doc: GRUPO_BLOQUE,
  listaOrdenada: new Set(['item']),
  listaVinetas: new Set(['item']),
  item: GRUPO_BLOQUE,
  tabla: new Set(['filaTabla']),
  filaTabla: new Set(['celda']),
};

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

const admite = (padre: DocJSON, tipo: string): boolean =>
  HIJOS_ADMITIDOS[padre.type ?? '']?.has(tipo) ?? false;

/**
 * Inserta los bloques nuevos de un ancla en orden ascendente de `n` (R8). Cada uno se
 * ubica tras su predecesor (el bloque ancla o la inserción anterior): justo después del
 * ancestro del predecesor cuya profundidad es `profundidad` (R13). Sin `profundidad`,
 * como hermano del primer ancestro cuyo padre admite el tipo insertado (R4).
 */
function insertarEnAncla(raiz: DocJSON, ancla: string, sugs: Sugerencia[]): void {
  let previo: DocJSON | null = null;
  const ordenadas = sugs
    .map((s) => ({ n: numeroInsercion(s), s }))
    .sort((a, b) => a.n - b.n)
    .map(({ s }) => s);
  for (const s of ordenadas) {
    const nuevo = structuredClone(s.propuesta[0]);
    const tipo = nuevo?.type ?? '';
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
    const valido = ({ padre, indice }: Eslabon) =>
      admite(padre, tipo) && (padre !== raiz || indice + 1 >= numCabecera(raiz));
    const eslabones = cadena ?? [];
    let destino: Eslabon | undefined;
    if (s.profundidad !== undefined) {
      // eslabones[k].nodo tiene profundidad eslabones.length - 1 - k.
      const candidato = eslabones[eslabones.length - 1 - s.profundidad];
      destino = candidato && valido(candidato) ? candidato : undefined;
    } else {
      destino = eslabones.find(valido);
    }
    if (!nuevo || !destino) {
      throw new Error(`No se puede ubicar la inserción ${s.id} (${tipo || 'vacía'}) tras ${ancla}`);
    }
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

export function aplicarSugerencias(base: DocJSON, aceptadas: Sugerencia[]): DocJSON {
  const conflictos = detectarConflictos(aceptadas);
  if (conflictos.length > 0) {
    throw new Error(`Sugerencias en conflicto: ${conflictos.map((c) => c.ids.join(', ')).join('; ')}`);
  }
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

  // 1) Texto, con los bloques aún intactos (los rangos son de la base).
  for (const [bid, sugs] of agrupar(['contenido', 'formato'])) editarBloque(res, bid, sugs);
  // 2) Inserciones, antes de eliminar para que sus anclas sigan existiendo.
  for (const [ancla, sugs] of agrupar(['bloque-insertado'])) insertarEnAncla(res, ancla, sugs);
  // 3) Eliminaciones y limpieza de contenedores vaciados.
  const eliminadas = agrupar(['bloque-eliminado']);
  const eliminadoEn = new Map<DocJSON, string>();
  for (const bid of eliminadas.keys()) {
    if (TIPO_CABECERA[bid]) throw new Error(`No se puede eliminar la cabecera: ${bid}`);
    const [{ padre, indice }] = buscarBloque(res, bid);
    padre.content?.splice(indice, 1);
    if (padre.type === 'item' && indice === 0) eliminadoEn.set(padre, bid);
  }
  // Tras todas las eliminaciones: si el mismo autor vació el item entero, no hay error.
  if (eliminadas.size > 0) limpiarVaciados(res, eliminadoEn);
  return res;
}
