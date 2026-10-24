/**
 * Normalización de LaTeX para comparar un capítulo original con su
 * reexportación: elimina las diferencias de superficie que el importador
 * colapsa (espacios, comentarios, formas equivalentes de la misma marca).
 */

/**
 * Elimina los comentarios `%` no escapados como lo hace TeX: el comentario,
 * su salto de línea y los espacios iniciales de la línea siguiente.
 */
function quitarComentarios(tex: string): string {
  let s = '';
  let i = 0;
  while (i < tex.length) {
    const c = tex[i];
    if (c === '\\') {
      s += tex.slice(i, i + 2);
      i += 2;
    } else if (c === '%') {
      while (i < tex.length && tex[i] !== '\n') i++;
      i++;
      let j = i;
      while (j < tex.length && (tex[j] === ' ' || tex[j] === '\t')) j++;
      // R23: si la línea siguiente está en blanco, el comentario no esconde el
      // fin de párrafo: se conserva un salto para que la línea vacía cuente.
      if (tex[j] === '\r') j++;
      if (tex[j] === '\n') s += '\n';
      else i = j;
    } else {
      s += c;
      i++;
    }
  }
  return s;
}

/** Índice justo después de la `}` que cierra la `{` en `ini`; -1 si no cierra. */
function cierreGrupo(s: string, ini: number): number {
  let prof = 0;
  for (let i = ini; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') i++;
    else if (c === '{') prof++;
    else if (c === '}' && --prof === 0) return i + 1;
  }
  return -1;
}

/**
 * R2: `\end{enumerate|itemize}\footnote{…}` ≡ `\footnote{…}\end{…}`. Se mueve
 * la nota delante del `\end` hasta que no quede ninguna tras un fin de lista.
 */
function moverNotasTrasListas(s: string): string {
  const re = /\\end\{(?:enumerate|itemize)\} ?\\footnote\{/g;
  for (;;) {
    re.lastIndex = 0;
    const m = re.exec(s);
    if (!m) return s;
    const iNota = m.index + m[0].length - '\\footnote{'.length;
    const fin = cierreGrupo(s, iNota + '\\footnote'.length);
    if (fin < 0) return s;
    const end = s.slice(m.index, iNota).replace(/ +$/, '');
    const antes = s.slice(0, m.index).replace(/ +$/, '');
    s = `${antes}${s.slice(iNota, fin)} ${end}${s.slice(fin)}`;
  }
}

/**
 * El importador guarda `\label{…}` como atributo del ítem, sin importar dónde
 * estaba en su cuerpo. Se mueve cada `\label{…}` justo tras el `\item` de su
 * mismo nivel de lista (saltando listas anidadas completas).
 */
function moverEtiquetas(s: string): string {
  const re = /\\label\{[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const label = m[0];
    const previos = s.slice(0, m.index);
    const tokens = [...previos.matchAll(/\\(begin|end)\{(?:enumerate|itemize)\}|\\item(?![A-Za-z])/g)];
    let prof = 0;
    let destino = -1;
    for (let k = tokens.length - 1; k >= 0 && destino < 0; k--) {
      const t = tokens[k];
      if (t[1] === 'end') prof++;
      else if (t[1] === 'begin' && --prof < 0) break;
      else if (!t[1] && prof === 0) destino = t.index! + t[0].length;
    }
    if (destino < 0 || destino === m.index) continue;
    // El hueco que deja la etiqueta cuenta como un espacio.
    const antes = s.slice(destino, m.index).replace(/ +$/, '');
    const despues = s.slice(m.index + label.length).replace(/^ +/, '');
    s = `${s.slice(0, destino)}${label}${antes} ${despues}`;
    re.lastIndex = destino + label.length + antes.length;
  }
  return s;
}

/** Equivalencias Unicode ↔ LaTeX que el importador colapsa. */
const UNICODE: [RegExp, string][] = [
  [/“/g, '``'],
  [/”/g, "''"],
  [/\u00A0/g, '~'],
  [/\u202F/g, '\\,'],
  [/—/g, '---'],
  [/–/g, '--'],
];

/** Marca de fin de párrafo (una o más líneas en blanco). */
export const PARRAFO = '\u2029';

/**
 * Quita espacios sin efecto tipográfico: justo tras la `{` y justo antes de
 * la `}` de un grupo real (no `\{ \}`), alrededor de un `&` no escapado, de
 * `\\`, `\[`, `\]` y de la marca de párrafo, y antes de `\label`. Nunca entre
 * una `}` y el texto siguiente, ni alrededor de `\& \{ \}`.
 */
function espaciosTokens(s: string): string {
  let o = '';
  const sinEspacioFinal = () => {
    if (o.endsWith(' ')) o = o.slice(0, -1);
  };
  let i = 0;
  const saltarEspacio = () => {
    if (s[i] === ' ') i++;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      const par = s.slice(i, i + 2);
      i += 2;
      if (par === '\\\\' || par === '\\[' || par === '\\]') {
        sinEspacioFinal();
        o += par;
        saltarEspacio();
      } else {
        if (s.startsWith('label{', i - 1)) sinEspacioFinal();
        o += par;
      }
    } else if (c === '{' || c === '&' || c === PARRAFO) {
      if (c !== '{') sinEspacioFinal();
      o += c;
      i++;
      saltarEspacio();
    } else if (c === '}') {
      sinEspacioFinal();
      o += c;
      i++;
    } else {
      o += c;
      i++;
    }
  }
  // Junto a `\item` y `\begin`/`\end{enumerate|itemize}` un espacio no compone
  // nada (TeX cierra el párrafo y descarta el espacio final, o está en modo vertical).
  return o
    .replace(/ ?\\item(?![A-Za-z]) ?/g, '\\item ')
    .replace(/ ?(\\(?:begin|end)\{(?:enumerate|itemize)\}) ?/g, '$1');
}

/** Fin (exclusivo) del grupo `{…}` que empieza en `ini`, o -1. */
const finGrupo = (s: string, ini: number) => (s[ini] === '{' ? cierreGrupo(s, ini) : -1);

/**
 * Un fin de párrafo no tiene efecto en LaTeX en ciertas posiciones: al inicio
 * y al final, junto a `{`/`}`, antes de `\section`, `\item`,
 * `\begin`/`\end{enumerate|itemize}`, tras `\begin{enumerate|itemize}` y tras
 * `\section{…}`, `\analito{…}` o `\metodo{…}`. Ahí se reemplaza por un espacio.
 * Tras `\end{…}` o alrededor de `\[ \]` sí cambia la composición y se conserva.
 */
function parrafosNeutros(s: string): string {
  const P = PARRAFO;
  s = s
    .replace(new RegExp(`^${P}|${P}$`, 'g'), '')
    .replace(new RegExp(`(?<!\\\\)\\{${P}`, 'g'), '{')
    .replace(new RegExp(`${P}(?=\\}|\\\\section\\{|\\\\item(?![A-Za-z])|\\\\(?:begin|end)\\{(?:enumerate|itemize)\\})`, 'g'), ' ')
    .replace(new RegExp(`(\\\\begin\\{(?:enumerate|itemize)\\})${P}`, 'g'), '$1 ');
  const re = /\\(?:section|analito|metodo)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const fin = finGrupo(s, m.index + m[0].length - 1);
    if (fin > 0 && s[fin] === P) s = `${s.slice(0, fin)} ${s.slice(fin + 1)}`;
  }
  return s;
}

export function normalizarLatex(tex: string): string {
  let s = tex.replace(/\r\n?/g, '\n');
  s = quitarComentarios(s);
  for (const [re, r] of UNICODE) s = s.replace(re, r);
  s = s.replace(/\n[ \t\f]*\n[ \t\n\f]*/g, ` ${PARRAFO} `);
  s = s.replace(/[ \t\n\f]+/g, ' ').trim();
  s = espaciosTokens(s);
  s = parrafosNeutros(s);
  s = espaciosTokens(s.replace(/ {2,}/g, ' ').trim());
  s = s
    .replace(/\\emph\{/g, '\\textit{')
    .replace(/\\degree(?: ?\{\}| )/g, '\\degree{}')
    .replace(/(?<!\\)([_^])\{([^{}\\])\}/g, '$1$2')
    // Un `\\` final y el espacio final de la última celda no componen nada.
    .replace(/ ?(?:\\\\)? ?(?=\\end\{tabular\})/g, '');
  s = moverNotasTrasListas(s);
  s = moverEtiquetas(s);
  return espaciosTokens(s.replace(/ {2,}/g, ' ').trim());
}

export interface ResultadoComparacion {
  igual: boolean;
  primeraDiferencia?: { posicion: number; a: string; b: string };
}

const CONTEXTO = 40;

/** Compara dos fuentes LaTeX normalizadas; si difieren, da la primera diferencia (±40 caracteres). */
export function compararLatex(a: string, b: string): ResultadoComparacion {
  const na = normalizarLatex(a);
  const nb = normalizarLatex(b);
  if (na === nb) return { igual: true };
  let p = 0;
  while (p < na.length && p < nb.length && na[p] === nb[p]) p++;
  // El fin de párrafo se muestra como `¶` para que sea visible en el contexto.
  const ctx = (s: string) => s.slice(Math.max(0, p - CONTEXTO), p + CONTEXTO).split(PARRAFO).join('¶');
  return { igual: false, primeraDiferencia: { posicion: p, a: ctx(na), b: ctx(nb) } };
}
