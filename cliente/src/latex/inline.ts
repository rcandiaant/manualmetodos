import type * as Ast from '@unified-latex/unified-latex-types';
import { printRaw } from '@unified-latex/unified-latex-util-print-raw';
import type { DocJSON } from '../tipos';

/** Contexto compartido durante una importación. */
export interface CtxImport {
  avisos: string[];
  siguienteBid(): string;
  /** LaTeX original byte a byte del nodo (para `especial`/`especialInline`). */
  crudo(n: Ast.Node): string;
  /** Importa nodos como bloques (contenido de `\footnote{…}`), con bids del mismo contador. */
  bloques(nodos: Ast.Node[]): DocJSON[];
}

/** Nombre legible de un nodo para los avisos: `\cmd`, `\begin{env}`, `$`, `{`, `%`. */
export function describirNodo(n: Ast.Node): string {
  switch (n.type) {
    case 'macro':
      return `\\${n.content}`;
    case 'environment':
    case 'mathenv':
    case 'verbatim': {
      // En `mathenv` el parser entrega `env` como nodo string, no como string.
      const env: unknown = n.env;
      return `\\begin{${typeof env === 'string' ? env : printRaw(env as Ast.Node)}}`;
    }
    case 'inlinemath':
      return '$';
    case 'displaymath':
      return '\\[';
    case 'group':
      return '{';
    case 'comment':
      return '%';
    case 'verb':
      return `\\${n.env}`;
    default:
      return n.type;
  }
}

/** Registra un aviso `"línea N: <construcción>"`. */
export function avisar(ctx: CtxImport, n: Ast.Node): void {
  let linea = n.position?.start.line;
  // Un comentario en línea propia empieza (según el parser) en el salto previo.
  if (linea !== undefined && n.type === 'comment' && !n.sameline && n.position!.start.column > 1) {
    linea++;
  }
  ctx.avisos.push(`${linea !== undefined ? `línea ${linea}` : 'línea ?'}: ${describirNodo(n)}`);
}

/** Orden canónico de las marcas (el del esquema). */
const ORDEN_MARCAS = ['negrita', 'cursiva', 'subindice', 'superindice'];

const MARCA_DE_MACRO: Record<string, string> = {
  textbf: 'negrita',
  textit: 'cursiva',
  emph: 'cursiva',
  textsubscript: 'subindice',
  textsuperscript: 'superindice',
};

/** Escapes de texto que se convierten en el carácter literal. */
const ESCAPES = new Set(['%', '&', '_', '$', '#', '{', '}']);

/** R19: palabras de control de texto que se convierten en un carácter. */
const CARACTER_DE_MACRO: Record<string, string> = {
  textbackslash: '\\',
  textasciitilde: '~',
  textasciicircum: '^',
};

/** Caracteres literales ↔ marcadores de uso privado (protegidos de `tipografia`). */
const MARCADOR: Record<string, string> = { '\\': '', '~': '', '^': '' };
const LITERAL: Record<string, string> = Object.fromEntries(
  Object.entries(MARCADOR).map(([c, m]) => [m, c]),
);
const LITERAL_RE = /[-]/g;

/**
 * Contenido de un sub/superíndice matemático (`$_{…}$`, `$^{…}$`) que se
 * importa como texto marcado; el exportador usa el mismo criterio (R18).
 */
export const SUBSUP_MATEMATICO = /^[A-Za-z0-9+\-.,()=]+$/;

/** Espacio fino `\,` y espacio irrompible `~`. */
const ESPACIO_FINO = ' ';
const NBSP = ' ';

const argVacio = (a: Ast.Argument | undefined) => !a || a.content.length === 0;

const soloTexto = (nodos: Ast.Node[]): nodos is Ast.String[] =>
  nodos.length > 0 && nodos.every((n) => n.type === 'string');

/**
 * Texto acumulado → texto final: colapsa espacios ASCII (no U+00A0/U+202F) y
 * aplica las ligaduras tipográficas de LaTeX.
 */
function tipografia(t: string): string {
  return t
    .replace(/[ \t\r\n\f]+/g, ' ')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``/g, '“')
    .replace(/''/g, '”')
    .replace(/~/g, NBSP);
}

/**
 * `$_2$`, `$_{12}$`, `$^{2+}$`, `$_4^+$`: matemática formada solo por sub/
 * superíndices de contenido simple (letras, dígitos, `+`, `-`). Devuelve los
 * nodos `text` marcados o `null` si la fórmula no es de esa forma.
 */
function subSuperindices(m: Ast.InlineMath): DocJSON[] | null {
  if (m.content.length === 0) return null;
  const salida: DocJSON[] = [];
  for (const h of m.content) {
    if (h.type !== 'macro' || (h.content !== '_' && h.content !== '^') || h.escapeToken !== '') {
      return null;
    }
    const args = h.args ?? [];
    if (args.length !== 1 || !soloTexto(args[0].content)) return null;
    const t = args[0].content.map((s) => s.content).join('');
    if (!SUBSUP_MATEMATICO.test(t)) return null;
    salida.push({
      type: 'text',
      text: t,
      marks: [{ type: h.content === '_' ? 'subindice' : 'superindice' }],
    });
  }
  return salida;
}

/** Agrega una marca a un nodo inline (texto o átomo), en orden canónico. */
function marcar(n: DocJSON, tipo: string): DocJSON {
  const tipos = new Set([...(n.marks ?? []).map((m) => m.type), tipo]);
  const marks = ORDEN_MARCAS.filter((t) => tipos.has(t)).map((type) => ({ type }));
  return { ...n, marks };
}

const mismasMarcas = (a: DocJSON, b: DocJSON) =>
  JSON.stringify(a.marks ?? []) === JSON.stringify(b.marks ?? []);

/** Fusiona nodos `text` contiguos con las mismas marcas. */
function fusionar(nodos: DocJSON[]): DocJSON[] {
  const salida: DocJSON[] = [];
  for (const n of nodos) {
    const prev = salida[salida.length - 1];
    if (n.type === 'text' && prev?.type === 'text' && mismasMarcas(prev, n)) {
      salida[salida.length - 1] = { ...prev, text: prev.text! + n.text! };
    } else salida.push(n);
  }
  return salida;
}

/**
 * Convierte contenido inline de LaTeX en nodos inline del esquema:
 * texto (con ligaduras y escapes resueltos), marcas, `matematica`,
 * `referencia`, `notaPie` y, para lo que no tiene representación,
 * `especialInline` con el LaTeX original byte a byte y un aviso.
 */
export function convertirInline(nodos: Ast.Node[], ctx: CtxImport): DocJSON[] {
  return fusionar(convertir(nodos, ctx));
}

function convertir(nodos: Ast.Node[], ctx: CtxImport): DocJSON[] {
  const salida: DocJSON[] = [];
  let texto = '';
  const volcar = () => {
    const t = tipografia(texto).replace(LITERAL_RE, (c) => LITERAL[c]);
    if (t) salida.push({ type: 'text', text: t });
    texto = '';
  };
  const emitir = (...ns: DocJSON[]) => {
    volcar();
    salida.push(...ns);
  };

  for (let i = 0; i < nodos.length; i++) {
    const n = nodos[i];
    // Como en TeX, los espacios tras una palabra de control no cuentan;
    // un `{}` inmediato sólo la termina.
    const terminarPalabraDeControl = () => {
      while (nodos[i + 1]?.type === 'whitespace') i++;
      const g = nodos[i + 1];
      if (g?.type === 'group' && g.content.length === 0) i++;
    };
    if (n.type === 'string') texto += n.content;
    else if (n.type === 'whitespace' || n.type === 'parbreak') texto += ' ';
    else if (n.type === 'macro' && ESCAPES.has(n.content) && !n.args) texto += n.content;
    else if (n.type === 'macro' && n.content === ',' && !n.args) texto += ESPACIO_FINO;
    else if (n.type === 'macro' && n.content === 'degree' && !n.args) {
      texto += '°';
      terminarPalabraDeControl();
    } else if (n.type === 'macro' && CARACTER_DE_MACRO[n.content] && !n.args) {
      // Marcador privado: la tipografía no debe tocar el carácter (`~` → U+00A0).
      texto += MARCADOR[CARACTER_DE_MACRO[n.content]];
      terminarPalabraDeControl();
    } else if (
      n.type === 'macro' &&
      MARCA_DE_MACRO[n.content] &&
      !n.args &&
      nodos[i + 1]?.type === 'group' &&
      nodos[i + 1].position?.start.offset === n.position?.end.offset
    ) {
      // `\textsubscript{…}` y similares sin firma conocida por el parser.
      const tipo = MARCA_DE_MACRO[n.content];
      const g = nodos[++i] as Ast.Group;
      emitir(...convertir(g.content, ctx).map((h) => marcar(h, tipo)));
    } else if (n.type === 'inlinemath') {
      const nodosMath = mathInline(n, ctx);
      if (nodosMath) emitir(...nodosMath);
      else emitir(especialInline(n, ctx.crudo(n), ctx));
    } else if (n.type === 'macro' && n.content === 'ref' && refConvertible(n)) {
      const arg = n.args![1];
      emitir({
        type: 'referencia',
        attrs: { etiqueta: (arg.content as Ast.String[]).map((s) => s.content).join('') },
      });
    } else if (n.type === 'macro' && n.content === 'footnote' && notaConvertible(n)) {
      emitir({ type: 'notaPie', attrs: { bloques: ctx.bloques(n.args![1].content) } });
    } else if (n.type === 'macro' && MARCA_DE_MACRO[n.content] && marcaConvertible(n)) {
      const tipo = MARCA_DE_MACRO[n.content];
      emitir(...convertir(n.args![0].content, ctx).map((h) => marcar(h, tipo)));
    } else {
      // El salto de línea que precede a un comentario cuenta como espacio.
      if (n.type === 'comment' && (!n.sameline || n.leadingWhitespace)) texto += ' ';
      let latex = ctx.crudo(n);
      // Macro desconocida (sin args parseados): se le pegan los grupos contiguos.
      if (n.type === 'macro' && !n.args) {
        let fin = n.position?.end.offset;
        while (
          fin !== undefined &&
          nodos[i + 1]?.type === 'group' &&
          nodos[i + 1].position?.start.offset === fin
        ) {
          i++;
          latex += ctx.crudo(nodos[i]);
          fin = nodos[i].position?.end.offset;
        }
      }
      emitir(especialInline(n, latex, ctx));
    }
  }
  volcar();
  return salida;
}

function especialInline(n: Ast.Node, latex: string, ctx: CtxImport): DocJSON {
  avisar(ctx, n);
  return { type: 'especialInline', attrs: { latex } };
}

/** `$…$` → texto con sub/superíndice o `matematica`; `null` si no es `$…$`. */
function mathInline(n: Ast.InlineMath, ctx: CtxImport): DocJSON[] | null {
  const crudo = ctx.crudo(n);
  // Sólo la forma `$…$` (no `\(…\)`) para que la exportación sea inversa.
  if (crudo.length < 2 || crudo[0] !== '$' || crudo[crudo.length - 1] !== '$') return null;
  return subSuperindices(n) ?? [{ type: 'matematica', attrs: { latex: crudo.slice(1, -1) } }];
}

/** `\ref{x}` sin estrella, con etiqueta de texto plano. */
function refConvertible(m: Ast.Macro): boolean {
  const args = m.args ?? [];
  return args.length === 2 && argVacio(args[0]) && args[1].openMark === '{' && soloTexto(args[1].content);
}

/** `\footnote{…}` sin argumento opcional. */
export function notaConvertible(m: Ast.Macro): boolean {
  const args = m.args ?? [];
  return args.length === 2 && argVacio(args[0]) && args[1].openMark === '{';
}

function marcaConvertible(m: Ast.Macro): boolean {
  const args = m.args ?? [];
  return args.length === 1 && args[0].openMark === '{';
}
