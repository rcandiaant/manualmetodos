import { parse } from '@unified-latex/unified-latex-util-parse';
import { printRaw } from '@unified-latex/unified-latex-util-print-raw';
import type * as Ast from '@unified-latex/unified-latex-types';
import type { DocJSON } from '../tipos';
import { avisar, convertirInline, notaConvertible, type CtxImport } from './inline';

export interface ResultadoImportacion {
  doc: DocJSON;
  avisos: string[];
}

/** Macros de seccionamiento sin equivalente en el esquema: se preservan como `especial`. */
const SECCIONAMIENTO_OTRO = new Set([
  'part',
  'chapter',
  'subsection',
  'subsubsection',
  'paragraph',
  'subparagraph',
]);

const LISTAS: Record<string, 'listaOrdenada' | 'listaVinetas'> = {
  enumerate: 'listaOrdenada',
  itemize: 'listaVinetas',
};

/** Macros de estructura de tabla sin representación en el esquema. */
const ESTRUCTURA_TABLA = new Set([
  'hline',
  'cline',
  'multicolumn',
  'multirow',
  'toprule',
  'midrule',
  'bottomrule',
  'cmidrule',
  'noalign',
  'tabularnewline',
  'newline',
]);

const esLista = (b: DocJSON | undefined) =>
  b?.type === 'listaOrdenada' || b?.type === 'listaVinetas';

const ultimo = <T>(xs: T[] | undefined): T | undefined => xs?.[xs.length - 1];

const esMacro = (n: Ast.Node | undefined, nombre?: string): n is Ast.Macro =>
  n?.type === 'macro' && (nombre === undefined || n.content === nombre);

const esBlanco = (n: Ast.Node) => n.type === 'whitespace' || n.type === 'parbreak';

const argVacio = (a: Ast.Argument | undefined) => !a || a.content.length === 0;

/** Quita espacios y saltos de párrafo al inicio y al final. */
function recortar(nodos: Ast.Node[]): Ast.Node[] {
  let i = 0;
  let j = nodos.length;
  while (i < j && esBlanco(nodos[i])) i++;
  while (j > i && esBlanco(nodos[j - 1])) j--;
  return nodos.slice(i, j);
}

class Importador {
  readonly ctx: CtxImport;

  constructor(private readonly tex: string) {
    let contador = 0;
    this.ctx = {
      avisos: [],
      siguienteBid: () => `b${++contador}`,
      crudo: (n) => this.crudo(n),
      bloques: (nodos) => this.bloques(nodos),
    };
  }

  /** Fin (exclusivo) del nodo en la fuente, incluyendo los argumentos de una macro. */
  private fin(n: Ast.Node): number | undefined {
    let cursor = n.position?.end.offset;
    if (cursor === undefined || n.type !== 'macro' || !n.args) return cursor;
    for (const a of n.args) {
      if (!a.openMark && !a.closeMark) {
        for (const h of a.content) cursor = Math.max(cursor, this.fin(h) ?? cursor);
        continue;
      }
      const ini = this.tex.indexOf(a.openMark, cursor);
      if (ini < 0) return undefined;
      cursor = ini + a.openMark.length;
      for (const h of a.content) cursor = Math.max(cursor, this.fin(h) ?? cursor);
      const cierre = this.tex.indexOf(a.closeMark, cursor);
      if (cierre < 0) return undefined;
      cursor = cierre + a.closeMark.length;
    }
    return cursor;
  }

  /**
   * LaTeX original byte a byte del nodo; si faltan posiciones, `printRaw`.
   * Un comentario se recorta a `%…` hasta el fin de línea: el parser incluye
   * en su posición el salto previo y el siguiente.
   */
  private crudo(n: Ast.Node): string {
    if (n.type === 'comment' && n.position) {
      const ini = this.tex.indexOf('%', n.position.start.offset);
      if (ini >= 0) {
        let fin = this.tex.indexOf('\n', ini);
        if (fin < 0) fin = this.tex.length;
        if (this.tex[fin - 1] === '\r') fin--;
        return this.tex.slice(ini, fin);
      }
    }
    const ini = n.position?.start.offset;
    const fin = this.fin(n);
    return ini !== undefined && fin !== undefined ? this.tex.slice(ini, fin) : printRaw(n);
  }

  private especial(n: Ast.Node): DocJSON {
    const bid = this.ctx.siguienteBid();
    avisar(this.ctx, n);
    return { type: 'especial', attrs: { latex: this.crudo(n), bid } };
  }

  private parrafo(nodos: Ast.Node[]): DocJSON {
    const bid = this.ctx.siguienteBid();
    return { type: 'parrafo', attrs: { bid }, content: convertirInline(recortar(nodos), this.ctx) };
  }

  private seccion(m: Ast.Macro): DocJSON {
    const [estrella, , toc, titulo] = m.args ?? [];
    if (!titulo || !argVacio(estrella) || !argVacio(toc)) return this.especial(m);
    const bid = this.ctx.siguienteBid();
    return {
      type: 'seccion',
      attrs: { bid },
      content: convertirInline(recortar(titulo.content), this.ctx),
    };
  }

  private lista(env: Ast.Environment, tipo: 'listaOrdenada' | 'listaVinetas'): DocJSON {
    const items = env.content.filter((n) => esMacro(n, 'item')) as Ast.Macro[];
    const convertible =
      items.length > 0 &&
      (env.args ?? []).every(argVacio) &&
      env.content.every((n) => esBlanco(n) || esMacro(n, 'item')) &&
      // `\item[x]` no tiene representación en el esquema.
      items.every((it) => argVacio(it.args?.[1]));
    if (!convertible) return this.especial(env);
    return { type: tipo, content: items.map((it) => this.item(it)) };
  }

  private item(it: Ast.Macro): DocJSON {
    const cuerpo = [...(it.args?.[it.args.length - 1]?.content ?? [])];
    let etiqueta: string | null = null;
    const iLabel = cuerpo.findIndex((n) => esMacro(n, 'label'));
    if (iLabel >= 0) {
      const label = cuerpo[iLabel] as Ast.Macro;
      const arg = label.args?.[label.args.length - 1];
      if (arg && arg.content.length > 0) {
        etiqueta = printRaw(arg.content);
        cuerpo.splice(iLabel, 1);
      }
    }
    return {
      type: 'item',
      attrs: { etiqueta },
      content: this.bloques(cuerpo, true),
    };
  }

  /** `\[ … \]` → `ecuacion` con el LaTeX interior byte a byte, sin espacios en los bordes. */
  private ecuacion(n: Ast.DisplayMath): DocJSON {
    const crudo = this.crudo(n);
    if (!crudo.startsWith('\\[') || !crudo.endsWith('\\]') || crudo.length < 4) {
      return this.especial(n);
    }
    const latex = crudo.slice(2, -2).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
    return { type: 'ecuacion', attrs: { latex, bid: this.ctx.siguienteBid() } };
  }

  /**
   * `tabular` → `tabla`: filas separadas por `\\`, celdas por `&`; un `\\`
   * final no crea fila vacía. Cualquier construcción de estructura de tabla
   * (`\hline`, `\\[2pt]`, …) deja la tabla entera como `especial`.
   */
  private tabla(env: Ast.Environment): DocJSON {
    const [pos, spec] = env.args ?? [];
    if (!argVacio(pos) || !spec || spec.openMark !== '{' || spec.content.length === 0) {
      return this.especial(env);
    }
    if (!spec.content.every((n) => n.type === 'string')) return this.especial(env);
    const columnas = (spec.content as Ast.String[]).map((s) => s.content).join('');

    const filas: Ast.Node[][][] = [];
    let fila: Ast.Node[][] = [];
    let celda: Ast.Node[] = [];
    for (const n of env.content) {
      // El parser entrega `\\` como macro de nombre `\`.
      if (n.type === 'macro' && n.content === '\\') {
        if (!(n.args ?? []).every(argVacio)) return this.especial(env);
        fila.push(celda);
        filas.push(fila);
        fila = [];
        celda = [];
      } else if (n.type === 'string' && n.content === '&') {
        fila.push(celda);
        celda = [];
      } else if (
        n.type === 'parbreak' ||
        (n.type === 'string' && n.content.includes('&')) ||
        (n.type === 'macro' && ESTRUCTURA_TABLA.has(n.content))
      ) {
        return this.especial(env);
      } else celda.push(n);
    }
    if (fila.length > 0 || recortar(celda).length > 0) {
      fila.push(celda);
      filas.push(fila);
    }
    if (filas.length === 0) return this.especial(env);

    return {
      type: 'tabla',
      attrs: { columnas },
      content: filas.map((f) => ({
        type: 'filaTabla',
        content: f.map((c) => {
          const bid = this.ctx.siguienteBid();
          return { type: 'celda', attrs: { bid }, content: convertirInline(recortar(c), this.ctx) };
        }),
      })),
    };
  }

  /** Párrafo más profundo al final de un bloque (bajando por el último item de listas). */
  private ultimoParrafo(b: DocJSON | undefined): DocJSON | undefined {
    if (b?.type === 'parrafo') return b;
    if (esLista(b)) return this.ultimoParrafo(ultimo(ultimo(b!.content)?.content));
    return undefined;
  }

  /**
   * `\footnote{…}` justo tras `\end{enumerate|itemize}` (fuera de un `\item`):
   * se adjunta al final del párrafo más profundo del último item. Devuelve
   * false si la lista no termina en un párrafo (la nota sigue el flujo normal).
   */
  private adjuntarNota(lista: DocJSON | undefined, nota: Ast.Macro): boolean {
    const p = this.ultimoParrafo(lista);
    if (!p || !notaConvertible(nota)) return false;
    p.content = [...(p.content ?? []), ...convertirInline([nota], this.ctx)];
    return true;
  }

  /**
   * Convierte una secuencia de nodos en bloques. Las corridas inline se separan
   * en párrafos por `parbreak`. Con `exigirParrafo` (cuerpo de `item`) el
   * primer bloque es siempre un `parrafo`.
   */
  bloques(nodos: Ast.Node[], exigirParrafo = false): DocJSON[] {
    const salida: DocJSON[] = [];
    let corrida: Ast.Node[] = [];
    const empujarBloque = (crear: () => DocJSON) => {
      if (exigirParrafo && salida.length === 0) salida.push(this.parrafo([]));
      salida.push(crear());
    };
    const cerrar = () => {
      const r = recortar(corrida);
      corrida = [];
      if (r.length === 0) return;
      // Comentarios aislados (sin texto en su párrafo): bloques `especial`.
      if (r.every((n) => n.type === 'comment' || n.type === 'whitespace')) {
        for (const c of r) if (c.type === 'comment') empujarBloque(() => this.especial(c));
      } else salida.push(this.parrafo(r));
    };
    const bloque = (crear: () => DocJSON) => {
      cerrar();
      empujarBloque(crear);
    };

    // Tras una lista sólo han venido espacios: una `\footnote` se adjunta a ella.
    let trasLista = false;
    for (const n of nodos) {
      if (
        trasLista &&
        esMacro(n, 'footnote') &&
        recortar(corrida).length === 0 &&
        this.adjuntarNota(ultimo(salida), n)
      ) {
        continue;
      }
      if (n.type !== 'whitespace') trasLista = false;
      if (n.type === 'parbreak') cerrar();
      else if (n.type === 'macro' && n.content === 'section') bloque(() => this.seccion(n));
      else if (n.type === 'macro' && SECCIONAMIENTO_OTRO.has(n.content))
        bloque(() => this.especial(n));
      else if (n.type === 'environment' && LISTAS[n.env]) {
        bloque(() => this.lista(n, LISTAS[n.env]));
        trasLista = esLista(ultimo(salida));
      } else if (n.type === 'environment' && n.env === 'tabular') bloque(() => this.tabla(n));
      else if (n.type === 'displaymath') bloque(() => this.ecuacion(n));
      else if (n.type === 'environment' || n.type === 'mathenv' || n.type === 'verbatim')
        bloque(() => this.especial(n));
      else corrida.push(n);
    }
    cerrar();
    if (exigirParrafo && salida.length === 0) salida.push(this.parrafo([]));
    return salida;
  }

  /** Extrae `\nombre{...}` del nivel superior; devuelve su contenido o null. */
  extraerCabecera(nodos: Ast.Node[], nombre: string): Ast.Node[] | null {
    const i = nodos.findIndex((n) => esMacro(n, nombre));
    if (i < 0) return null;
    let j = i + 1;
    while (nodos[j]?.type === 'whitespace') j++;
    const grupo = nodos[j];
    if (grupo?.type !== 'group') return null;
    nodos.splice(i, j - i + 1);
    return grupo.content;
  }

  cabecera(nodos: Ast.Node[], nombre: 'analito' | 'metodo'): DocJSON {
    const contenido = this.extraerCabecera(nodos, nombre);
    if (contenido === null) this.ctx.avisos.push(`falta \\${nombre}`);
    return { type: nombre, content: convertirInline(recortar(contenido ?? []), this.ctx) };
  }
}

/**
 * Convierte un capítulo LaTeX en el JSON TipTap del esquema del manual.
 * Los `bid` se asignan en orden de documento (`b1`, `b2`, …).
 */
export function importarLatex(tex: string): ResultadoImportacion {
  // unified-latex cuenta `\r\n` como dos saltos (párrafo nuevo). Se reemplaza
  // por ` \n`, de igual longitud, para conservar los offsets sobre `tex`.
  const ast = parse(tex.replace(/\r\n/g, ' \n'));
  const imp = new Importador(tex);
  const nodos = [...ast.content];
  const analito = imp.cabecera(nodos, 'analito');
  const metodo = imp.cabecera(nodos, 'metodo');
  return {
    doc: { type: 'doc', content: [analito, metodo, ...imp.bloques(nodos)] },
    avisos: imp.ctx.avisos,
  };
}
