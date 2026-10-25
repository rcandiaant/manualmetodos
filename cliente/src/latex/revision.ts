import type { DocJSON } from '../tipos';
import { CARACTERES_MAPEADOS } from './exportar';

/**
 * Revisión previa a la exportación (Task 4): lo que el `.tex` no sabe
 * representar se avisa antes de exportar, nunca se pierde en silencio.
 */

/** ASCII imprimible y los blancos de control que el texto puede traer. */
const ASCII = /^[\x20-\x7E\t\n\r]$/;
/**
 * Latin-1 imprimible completo (U+00A0–U+00FF: letras, ¿ ¡ « » · º ª § © ²…) y las
 * letras de Latin Extended-A (U+0100–U+017F); compilan con inputenc utf8 + T1
 * (comprobado con pdflatex y herramientas/marco-prueba.tex)…
 */
const LATINA = /^[\u00A0-\u017F]$/u;
/** …salvo estas de Latin Extended-A: «Unicode character … not set up for use with LaTeX». */
const SIN_DEFINIR_EN_T1 = new Set([...'\u0126\u0127\u0138\u013F\u0140\u0149\u0166\u0167\u017F']);
/** R8: comillas simples, puntos suspensivos y comillas bajas (texto pegado desde Word). */
const TIPOGRAFICOS = new Set(['\u2018', '\u2019', '\u2026', '\u201A', '\u201E']);

const soportado = (c: string) =>
  ASCII.test(c) ||
  CARACTERES_MAPEADOS.has(c) ||
  TIPOGRAFICOS.has(c) ||
  (LATINA.test(c) && !SIN_DEFINIR_EN_T1.has(c));

/**
 * Recorre el documento en orden: `visitar(nodo, bloqueId)` con el bid del bloque
 * más cercano que lo contiene (`null` en el título del analito y del método).
 * Entra en las notas al pie (`attrs.bloques`), cuyos bloques tienen su propio bid.
 */
function recorrer(n: DocJSON, bloqueId: string | null, visitar: (n: DocJSON, bloqueId: string | null) => void): void {
  const bid = typeof n.attrs?.bid === 'string' ? n.attrs.bid : bloqueId;
  visitar(n, bid);
  if (n.type === 'notaPie' && Array.isArray(n.attrs?.bloques)) {
    for (const b of n.attrs.bloques as DocJSON[]) recorrer(b, bid, visitar);
  }
  for (const h of n.content ?? []) recorrer(h, bid, visitar);
}

/**
 * Caracteres del texto que no son ASCII imprimible, ni Latin-1 imprimible, ni letras latinas con
 * diacríticos (Latin Extended-A), ni ‘ ’ … ‚ „, ni están en el mapa del exportador.
 * Una entrada por carácter distinto y bloque, en orden de documento.
 */
export function caracteresNoSoportados(doc: DocJSON): Array<{ caracter: string; bloqueId: string | null }> {
  const salida: Array<{ caracter: string; bloqueId: string | null }> = [];
  const vistos = new Set<string>();
  recorrer(doc, null, (n, bloqueId) => {
    if (n.type !== 'text') return;
    for (const c of n.text ?? '') {
      if (soportado(c)) continue;
      const clave = `${bloqueId ?? ''}\u0000${c}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      salida.push({ caracter: c, bloqueId });
    }
  });
  return salida;
}

/** Etiquetas citadas por nodos `referencia` que ningún ítem del documento declara (sin repetir, en orden). */
export function referenciasColgantes(doc: DocJSON): string[] {
  const declaradas = new Set<string>();
  const citadas: string[] = [];
  recorrer(doc, null, (n) => {
    if (n.type === 'item' && typeof n.attrs?.etiqueta === 'string') declaradas.add(n.attrs.etiqueta);
    if (n.type === 'referencia' && typeof n.attrs?.etiqueta === 'string') citadas.push(n.attrs.etiqueta);
  });
  return [...new Set(citadas)].filter((e) => !declaradas.has(e));
}
