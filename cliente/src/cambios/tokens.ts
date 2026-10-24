import type { DocJSON } from '../tipos';

export interface Token {
  clave: string;
  texto: string;
  marcas: string[];
  nodo?: DocJSON;
}

/** Bloques atómicos: se tokenizan como un único token. */
export const BLOQUES_ATOMICOS = new Set(['ecuacion', 'especial']);

/** JSON con claves ordenadas, para que nodos iguales den la misma clave. */
export function jsonEstable(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(jsonEstable).join(',')}]`;
  if (valor !== null && typeof valor === 'object') {
    const obj = valor as Record<string, unknown>;
    const claves = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${claves.map((k) => `${JSON.stringify(k)}:${jsonEstable(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(valor) ?? 'null';
}

const marcasDe = (nodo: DocJSON): string[] => (nodo.marks ?? []).map((m) => m.type).sort();

/**
 * Palabra (letras/dígitos, admite separadores internos como en "42,0" o "1.5"),
 * secuencia de espacios, o un carácter de puntuación suelto.
 */
const PATRON = /[\p{L}\p{N}]+(?:[.,'’-][\p{L}\p{N}]+)*|\s+|[^\p{L}\p{N}\s]/gu;

function claveAtomo(nodo: DocJSON, excluir: string[] = []): string {
  const attrs: Record<string, unknown> = { ...(nodo.attrs ?? {}) };
  for (const k of excluir) delete attrs[k];
  return `${nodo.type}:${jsonEstable(attrs)}`;
}

export function tokenizarBloque(bloque: DocJSON): Token[] {
  if (BLOQUES_ATOMICOS.has(bloque.type ?? '')) {
    // `bid` (identidad) y `pegado` (disposición respecto del hermano anterior) no son
    // contenido: excluirlos evita diferencias fantasma entre JSON con y sin attrs por defecto.
    return [{ clave: claveAtomo(bloque, ['bid', 'pegado']), texto: '', marcas: [], nodo: bloque }];
  }
  const tokens: Token[] = [];
  // Texto adyacente con las mismas marcas se une antes de partir en tokens, para que
  // la forma en que el editor fragmente los nodos de texto no afecte al diff.
  let tramo = '';
  let marcasTramo: string[] = [];
  const vaciarTramo = () => {
    for (const m of tramo.matchAll(PATRON)) {
      tokens.push({ clave: m[0], texto: m[0], marcas: marcasTramo });
    }
    tramo = '';
  };
  for (const nodo of bloque.content ?? []) {
    if (nodo.type === 'text') {
      const marcas = marcasDe(nodo);
      if (tramo !== '' && marcas.join(',') !== marcasTramo.join(',')) vaciarTramo();
      marcasTramo = marcas;
      tramo += nodo.text ?? '';
    } else {
      vaciarTramo();
      tokens.push({ clave: claveAtomo(nodo), texto: '', marcas: marcasDe(nodo), nodo });
    }
  }
  vaciarTramo();
  return tokens;
}

/** Reconstruye nodos inline a partir de tokens, uniendo texto contiguo con iguales marcas. */
export function tokensANodos(tokens: Token[]): DocJSON[] {
  const nodos: DocJSON[] = [];
  let previoMarcas: string | null = null;
  for (const t of tokens) {
    if (t.nodo) {
      nodos.push(structuredClone(t.nodo)); // sin referencias compartidas con la entrada
      previoMarcas = null;
      continue;
    }
    const firma = t.marcas.join(',');
    const ultimo = nodos[nodos.length - 1];
    if (previoMarcas === firma && ultimo) {
      ultimo.text = (ultimo.text ?? '') + t.texto;
    } else {
      const n: DocJSON = { type: 'text', text: t.texto };
      if (t.marcas.length > 0) n.marks = t.marcas.map((m) => ({ type: m }));
      nodos.push(n);
      previoMarcas = firma;
    }
  }
  return nodos;
}
