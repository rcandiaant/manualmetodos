import type { DocJSON } from '../tipos';
import { MATEMATICA_DE_SIMBOLO, SUBSUP_MATEMATICO } from './inline';

/**
 * Exportador JSON → LaTeX: inverso exacto de `importarLatex` (Tasks 3 y 4).
 * Estilo de salida del manual: `\analito{}`, línea en blanco, `\metodo{}`,
 * `\section{}`, listas con `\item` indentado con tabulación por nivel,
 * `\label{}` al final del texto del ítem, `\footnote{}` pegado al texto,
 * `\[`/`\]` en líneas propias y `tabular` con ` & ` y ` \\` por fila.
 */

const NBSP = ' ';
const ESPACIO_FINO = ' ';

/** Marcas de formato que se emiten como macro envolvente (orden canónico). */
const MACRO_DE_MARCA: Record<string, string> = { negrita: 'textbf', cursiva: 'textit' };
const MARCAS_FORMATO = ['negrita', 'cursiva'];

const ESCAPE: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '%': '\\%',
  '&': '\\&',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  [NBSP]: '~',
  [ESPACIO_FINO]: '\\,',
  '–': '--',
  '—': '---',
  '“': '``',
  '”': "''",
  // Task 4: `"` es activo en babel-spanish; `<<` y `>>` son sus atajos de comillas.
  '"': '\\textquotedbl{}',
  '<': '\\textless{}',
  '>': '\\textgreater{}',
};

/**
 * Caracteres del texto del usuario que el exportador sabe escribir (además del
 * ASCII imprimible): escapes, `°` y los símbolos que van como `$\cmd$`.
 */
export const CARACTERES_MAPEADOS: ReadonlySet<string> = new Set([
  ...Object.keys(ESCAPE),
  ...Object.keys(MATEMATICA_DE_SIMBOLO),
  '°',
]);

/** Cantidad de `\` justo antes de la posición `fin`. */
function barrasAntes(s: string, fin: number): number {
  let k = 0;
  while (fin - k - 1 >= 0 && s[fin - k - 1] === '\\') k++;
  return k;
}

/**
 * Concatena LaTeX. Entre una fórmula `$…$` y otra que empieza justo después va
 * `{}` (TeX leería `$$` como matemática en display); el importador la descarta.
 */
function unir(s: string, pieza: string): string {
  const cierraMath = s.endsWith('$') && barrasAntes(s, s.length - 1) % 2 === 0;
  return cierraMath && pieza.startsWith('$') ? `${s}{}${pieza}` : s + pieza;
}

const tieneMarca = (n: DocJSON, tipo: string) => (n.marks ?? []).some((m) => m.type === tipo);
const esSubSup = (n: DocJSON) =>
  n.type === 'text' && (tieneMarca(n, 'subindice') || tieneMarca(n, 'superindice'));

/**
 * R18: sólo el texto de la forma `SUBSUP_MATEMATICO` va como `$_{…}$`/`$^{…}$`;
 * el resto va como `\textsubscript{…}`/`\textsuperscript{…}` con el texto escapado.
 */
const esSubSupMath = (n: DocJSON) => esSubSup(n) && SUBSUP_MATEMATICO.test(n.text ?? '');

/**
 * Escapa el texto del usuario. `°` → `\degree`, con `{}` si lo sigue una
 * letra o un blanco (o el fin del nodo), para no producir `\degreeC` ni
 * perder el blanco (el importador descarta los espacios tras `\degree`).
 * `≤ ≥ → × ± µ μ` → `$\leq$`… (Task 4): el importador lee esas fórmulas exactas
 * como el carácter.
 */
function escaparTexto(t: string): string {
  let s = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '°') {
      const sig = t[i + 1];
      s += sig === undefined || /[\p{L}\s]/u.test(sig) ? '\\degree{}' : '\\degree';
    } else if (MATEMATICA_DE_SIMBOLO[c]) s = unir(s, `$${MATEMATICA_DE_SIMBOLO[c]}$`);
    else s += ESCAPE[c] ?? c;
  }
  return s;
}

/** `_2`, `_{12}`, `^+`, `^{2+}`. */
function subSup(n: DocJSON): string {
  const op = tieneMarca(n, 'subindice') ? '_' : '^';
  const t = n.text ?? '';
  return t.length === 1 ? `${op}${t}` : `${op}{${t}}`;
}

/** Un comentario `%…` en línea necesita el salto de línea que lo terminaba. */
const esComentario = (latex: string) => latex.startsWith('%');

function inlineAtomo(n: DocJSON, nivel: number): string {
  switch (n.type) {
    case 'text':
      return escaparTexto(n.text ?? '');
    case 'matematica':
      return `$${n.attrs?.latex ?? ''}$`;
    case 'referencia':
      return `\\ref{${n.attrs?.etiqueta ?? ''}}`;
    case 'notaPie':
      const cuerpo = bloques((n.attrs?.bloques as DocJSON[]) ?? [], nivel);
      return `\\footnote{${cuerpo.replace(/^\t+/, '')}}`;
    case 'especialInline': {
      const latex: string = n.attrs?.latex ?? '';
      return esComentario(latex) ? `${latex}\n` : latex;
    }
    default:
      throw new Error(`exportarLatex: nodo inline desconocido "${n.type}"`);
  }
}

/**
 * Nodos inline → LaTeX. Las marcas de formato abiertas (`abiertas`) ya están
 * emitidas; una corrida contigua de nodos con una marca nueva se envuelve en
 * su macro, y las corridas sub/superíndice matemáticas (R18) se unen en una
 * sola `$…$`.
 */
function inline(nodos: DocJSON[], nivel: number, abiertas: string[] = []): string {
  let s = '';
  let i = 0;
  while (i < nodos.length) {
    const n = nodos[i];
    const nueva = MARCAS_FORMATO.find((m) => tieneMarca(n, m) && !abiertas.includes(m));
    if (nueva) {
      let j = i;
      while (j < nodos.length && tieneMarca(nodos[j], nueva)) j++;
      const dentro = inline(nodos.slice(i, j), nivel, [...abiertas, nueva]);
      s += `\\${MACRO_DE_MARCA[nueva]}{${dentro}}`;
      i = j;
    } else if (esSubSup(n) && !esSubSupMath(n)) {
      const macro = tieneMarca(n, 'subindice') ? 'textsubscript' : 'textsuperscript';
      s += `\\${macro}{${escaparTexto(n.text ?? '')}}`;
      i++;
    } else if (esSubSupMath(n)) {
      let j = i;
      let math = '';
      while (
        j < nodos.length &&
        esSubSupMath(nodos[j]) &&
        !MARCAS_FORMATO.some((m) => tieneMarca(nodos[j], m) && !abiertas.includes(m))
      ) {
        math += subSup(nodos[j]);
        j++;
      }
      s = unir(s, `$${math}$`);
      i = j;
    } else {
      s = unir(s, inlineAtomo(n, nivel));
      i++;
    }
  }
  return s;
}

const tabs = (nivel: number) => '\t'.repeat(nivel);

const esLista = (b: DocJSON | undefined) =>
  b?.type === 'listaOrdenada' || b?.type === 'listaVinetas';

/** Un `especial` que es un comentario se fundiría con un párrafo contiguo sin línea en blanco. */
const esComentarioBloque = (b: DocJSON) => b.type === 'especial' && esComentario(b.attrs?.latex ?? '');

/**
 * Separador entre dos bloques consecutivos (R22): salto simple si el bloque
 * siguiente está `pegado` al anterior, línea en blanco si no. Algunos pares
 * exigen la línea en blanco para que el importador no los funda.
 */
function separador(prev: DocJSON, sig: DocJSON): string {
  // Un párrafo pegado a otro párrafo o a un comentario sería un solo párrafo.
  if (
    (prev.type === 'parrafo' && (sig.type === 'parrafo' || esComentarioBloque(sig))) ||
    (sig.type === 'parrafo' && esComentarioBloque(prev))
  ) {
    return '\n\n';
  }
  // Una nota al inicio del párrafo tras una lista se adjuntaría a la lista (R2).
  if (esLista(prev) && sig.type === 'parrafo' && sig.content?.[0]?.type === 'notaPie') return '\n\n';
  if (sig.type === 'seccion') return '\n\n';
  return sig.attrs?.pegado ? '\n' : '\n\n';
}

function lista(b: DocJSON, nivel: number): string {
  const env = b.type === 'listaOrdenada' ? 'enumerate' : 'itemize';
  const items = (b.content ?? []).map((it) => item(it, nivel + 1));
  return [`${tabs(nivel)}\\begin{${env}}`, ...items, `${tabs(nivel)}\\end{${env}}`].join('\n');
}

/**
 * I2: tras `\item` o tras el `\\` de la fila anterior, un `[` inicial se leería
 * como argumento opcional (`\item[…]`, `\\[dim]`). Se protege como `{[}`, que
 * el importador lee de vuelta como `[` en esas mismas posiciones.
 */
const protegerCorchete = (latex: string) => (latex.startsWith('[') ? `{[}${latex.slice(1)}` : latex);

function item(it: DocJSON, nivel: number): string {
  const [primero, ...resto] = it.content ?? [];
  let s = `${tabs(nivel)}\\item`;
  const texto = primero ? protegerCorchete(inline(primero.content ?? [], nivel)) : '';
  if (texto) s += ` ${texto}`;
  const etiqueta = it.attrs?.etiqueta;
  if (etiqueta) s += ` \\label{${etiqueta}}`;
  let prev = primero;
  for (const b of resto) {
    s += separador(prev, b) + bloque(b, nivel);
    prev = b;
  }
  return s;
}

function tabla(b: DocJSON, nivel: number): string {
  const filas = (b.content ?? []).map(
    (f) =>
      tabs(nivel + 1) +
      protegerCorchete((f.content ?? []).map((c) => inline(c.content ?? [], nivel + 1)).join(' & ')) +
      ' \\\\',
  );
  const ind = tabs(nivel);
  return [`${ind}\\begin{tabular}{${b.attrs?.columnas ?? ''}}`, ...filas, `${ind}\\end{tabular}`].join(
    '\n',
  );
}

function bloque(b: DocJSON, nivel: number): string {
  const ind = tabs(nivel);
  switch (b.type) {
    case 'seccion':
      return `${ind}\\section{${inline(b.content ?? [], nivel)}}`;
    case 'parrafo':
      return ind + inline(b.content ?? [], nivel);
    case 'listaOrdenada':
    case 'listaVinetas':
      return lista(b, nivel);
    case 'tabla':
      return tabla(b, nivel);
    case 'ecuacion':
      return `${ind}\\[\n${ind}${b.attrs?.latex ?? ''}\n${ind}\\]`;
    case 'especial':
      return ind + (b.attrs?.latex ?? '');
    default:
      throw new Error(`exportarLatex: bloque desconocido "${b.type}"`);
  }
}

/** Secuencia de bloques (nivel superior, cuerpo de ítem o nota al pie). */
function bloques(bs: DocJSON[], nivel: number): string {
  let s = '';
  bs.forEach((b, i) => {
    if (i > 0) s += separador(bs[i - 1], b);
    s += bloque(b, nivel);
  });
  return s;
}

/** Convierte el JSON del esquema del manual en un capítulo LaTeX. */
export function exportarLatex(doc: DocJSON): string {
  const [analito, metodo, ...resto] = doc.content ?? [];
  const partes = [
    `\\analito{${inline(analito?.content ?? [], 0)}}`,
    `\\metodo{${inline(metodo?.content ?? [], 0)}}`,
  ];
  let s = partes.join('\n\n');
  if (resto.length > 0) s += '\n\n' + bloques(resto, 0);
  return s + '\n';
}
