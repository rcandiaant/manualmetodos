import type * as Ast from '@unified-latex/unified-latex-types';
import { printRaw } from '@unified-latex/unified-latex-util-print-raw';
import type { DocJSON } from '../tipos';

/** Contexto compartido durante una importación. */
export interface CtxImport {
  avisos: string[];
  siguienteBid(): string;
  /** LaTeX original byte a byte del nodo (para `especial`/`especialInline`). */
  crudo(n: Ast.Node): string;
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

/**
 * STUB (Task 3): convierte texto plano y espacios en nodos `text` (espacios
 * colapsados) y todo lo demás en `especialInline` con su LaTeX crudo + aviso.
 * Task 4 reemplaza el cuerpo manteniendo la firma.
 */
export function convertirInline(nodos: Ast.Node[], ctx: CtxImport): DocJSON[] {
  const salida: DocJSON[] = [];
  let texto = '';
  const volcar = () => {
    const t = texto.replace(/\s+/g, ' ');
    if (t) salida.push({ type: 'text', text: t });
    texto = '';
  };
  for (let i = 0; i < nodos.length; i++) {
    const n = nodos[i];
    if (n.type === 'string') texto += n.content;
    else if (n.type === 'whitespace' || n.type === 'parbreak') texto += ' ';
    else {
      // El salto de línea que precede a un comentario cuenta como espacio.
      if (n.type === 'comment' && (!n.sameline || n.leadingWhitespace)) texto += ' ';
      volcar();
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
      salida.push({ type: 'especialInline', attrs: { latex } });
      avisar(ctx, n);
    }
  }
  volcar();
  return salida;
}
