import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Conflicto } from '../cambios/conflictos';
import { ANCLA_INICIO, listarBloques } from '../cambios/sugerencias';
import { jsonEstable, tokenizarBloque } from '../cambios/tokens';
import type { DocJSON, Sugerencia } from '../tipos';

/** Pseudo-bids de la cabecera (mismos que en `calcularSugerencias`). */
const TIPO_CABECERA: Record<string, string> = { '@analito': 'analito', '@metodo': 'metodo' };

export interface BloqueUbicado {
  pos: number;
  node: ProseMirrorNode;
}

/** Posición (antes del nodo) del bloque con ese bid, o del pseudo-bloque de cabecera. */
export function ubicarBloque(doc: ProseMirrorNode, bid: string): BloqueUbicado | null {
  const tipoCabecera = TIPO_CABECERA[bid];
  let hallado: BloqueUbicado | null = null;
  doc.descendants((node, pos) => {
    if (hallado) return false;
    const coincide = tipoCabecera
      ? node.type.name === tipoCabecera
      : node.attrs.bid === bid && !Object.values(TIPO_CABECERA).includes(node.type.name);
    if (coincide) {
      hallado = { pos, node };
      return false;
    }
    return !node.isTextblock && !node.isAtom;
  });
  return hallado;
}

/** Posición ProseMirror del inicio del token N del bloque `bid` (N = nº de tokens → fin). */
export function posicionEnDoc(doc: ProseMirrorNode, bid: string, offsetToken: number): number {
  const ubicado = ubicarBloque(doc, bid);
  if (!ubicado) throw new Error(`Bloque no encontrado en el documento: ${bid}`);
  const { pos, node } = ubicado;
  if (!node.isTextblock) return offsetToken === 0 ? pos : pos + node.nodeSize; // bloque atómico
  const tokens = tokenizarBloque(node.toJSON() as DocJSON);
  let p = pos + 1;
  for (const t of tokens.slice(0, offsetToken)) p += t.nodo ? 1 : t.texto.length;
  return p;
}

/** Tipos inline del esquema. */
const INLINE = new Set(['text', 'matematica', 'referencia', 'notaPie', 'especialInline']);

/** Texto legible de nodos JSON (para widgets y tarjetas): átomos en forma abreviada. */
export function textoVisible(nodos: DocJSON[]): string {
  return nodos
    .map((n): string => {
      switch (n.type) {
        case 'text':
          return n.text ?? '';
        case 'matematica':
          return `$${n.attrs?.latex ?? ''}$`;
        case 'referencia':
          return `[${n.attrs?.etiqueta ?? ''}]`;
        case 'notaPie':
          return '*';
        case 'especialInline':
        case 'especial':
        case 'ecuacion':
          return String(n.attrs?.latex ?? '');
        default:
          return textoVisible(n.content ?? []);
      }
    })
    .join(nodos.some((n) => INLINE.has(n.type ?? '')) ? '' : ' '); // bloques: separados por espacio
}

function widget(
  pos: number,
  texto: string,
  clase: string,
  spec: Record<string, unknown>,
  bloque = false,
  side = -1,
  atributos: Record<string, string> = {},
): Decoration {
  const crear = () => {
    const el = document.createElement(bloque ? 'div' : 'span');
    el.className = clase;
    el.textContent = texto;
    for (const [k, v] of Object.entries(atributos)) el.setAttribute(k, v);
    el.contentEditable = 'false';
    if (typeof spec.id === 'string') el.dataset.sug = spec.id;
    return el;
  };
  return Decoration.widget(pos, crear, {
    side,
    ignoreSelection: true,
    key: `${String(spec.id)}|${String(spec.tipo)}|${clase}|${texto}|${atributos['data-lab'] ?? ''}|${atributos.title ?? ''}`,
    texto,
    ...spec,
  });
}

/** Posición (tras el bloque) donde mostrar un bloque eliminado: tras su bid previo en la base. */
function posicionTrasPrevio(doc: ProseMirrorNode, bid: string, base: DocJSON | undefined): number {
  const bloques = base ? listarBloques(base) : [];
  const i = bloques.findIndex((b) => b.bid === bid);
  for (let k = i - 1; k >= 0; k--) {
    const previo = bloques[k].bid;
    const u = previo !== null ? ubicarBloque(doc, previo) : null;
    if (u) return u.pos + u.node.nodeSize;
  }
  const metodo = ubicarBloque(doc, '@metodo');
  return metodo ? metodo.pos + metodo.node.nodeSize : 0;
}

/**
 * Decoraciones de la copia de un laboratorio (estilo Word): inserciones en verde
 * subrayado sobre `copia`; eliminaciones como widget rojo tachado en `copia.desde`.
 * Bloques insertados: decoración de nodo. Bloques eliminados: widget tras el bloque
 * previo (requiere `base` para ubicarlo; sin ella, tras la cabecera).
 */
export function decoracionesDeCambios(
  doc: ProseMirrorNode,
  sugerencias: Sugerencia[],
  base?: DocJSON,
): DecorationSet {
  const decos: Decoration[] = [];
  // Bloques insertados: se emparejan por contenido, en orden de documento.
  const pendientes = new Map<string, Sugerencia[]>();
  for (const s of sugerencias) {
    if (s.tipo !== 'bloque-insertado' || !s.propuesta[0]) continue;
    const clave = jsonEstable(s.propuesta[0]);
    pendientes.set(clave, [...(pendientes.get(clave) ?? []), s]);
  }
  if (pendientes.size > 0) {
    doc.descendants((node, pos) => {
      const cola = pendientes.get(jsonEstable(node.toJSON()));
      const s = cola?.shift();
      if (s) {
        decos.push(
          Decoration.node(pos, pos + node.nodeSize, { class: 'cambio-bloque-insertado', 'data-sug': s.id }, {
            tipo: 'bloque-insertado',
            id: s.id,
          }),
        );
        return false;
      }
      return !node.isTextblock;
    });
  }
  for (const s of sugerencias) {
    if (s.tipo === 'bloque-insertado') continue;
    if (s.tipo === 'bloque-eliminado') {
      decos.push(
        widget(posicionTrasPrevio(doc, s.bloqueId, base), textoVisible(s.original), 'cambio-bloque-eliminado', {
          tipo: 'bloque-eliminado',
          id: s.id,
        }, true, 1),
      );
      continue;
    }
    const desde = posicionEnDoc(doc, s.bloqueId, s.copia.desde);
    if (s.original.length > 0) {
      decos.push(widget(desde, textoVisible(s.original), 'cambio-eliminado', { tipo: 'eliminacion', id: s.id }));
    }
    if (s.copia.hasta > s.copia.desde) {
      const hasta = posicionEnDoc(doc, s.bloqueId, s.copia.hasta);
      const clase = s.tipo === 'formato' ? 'cambio-formato' : 'cambio-insertado';
      decos.push(Decoration.inline(desde, hasta, { class: clase, 'data-sug': s.id }, { tipo: 'insercion', id: s.id }));
    }
  }
  return DecorationSet.create(doc, decos);
}

export interface OpcionesRevisor {
  conflictos?: Conflicto[];
  /** Clase CSS por autor (color del laboratorio). */
  claseAutor?: (autor: string) => string;
  /** Decisión del revisor sobre cada sugerencia, si la hay. */
  decision?: (id: string) => 'aceptada' | 'rechazada' | undefined;
  /**
   * Etiqueta del autor (opcional): `titulo` va como `title` en todas las marcas de la
   * sugerencia y `abreviatura` como `data-lab` en su última marca (la propuesta, o el
   * tachado si no hay propuesta), para identificar al laboratorio sin depender del color.
   * Recibe también el id de la sugerencia: una propuesta idéntica de varios laboratorios
   * se dibuja una sola vez con la etiqueta de todos.
   */
  etiquetaAutor?: (autor: string, id: string) => { titulo: string; abreviatura: string } | undefined;
}

/**
 * Decoraciones del revisor sobre la BASE (rangos `base`): texto original tachado,
 * propuesta como widget tras el rango, bloques insertados como widget tras su ancla,
 * bloques eliminados tachados enteros, y un recuadro por conflicto.
 */
export function decoracionesRevisor(
  doc: ProseMirrorNode,
  sugerencias: Sugerencia[],
  opciones: OpcionesRevisor = {},
): DecorationSet {
  const enConflicto = new Set((opciones.conflictos ?? []).flatMap((c) => c.ids));
  const clases = (s: Sugerencia, base: string): string =>
    [
      base,
      opciones.claseAutor?.(s.autor) ?? '',
      enConflicto.has(s.id) ? 'en-conflicto' : '',
      opciones.decision?.(s.id) ? `decision-${opciones.decision(s.id)}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  /** Atributos de etiqueta: `title` siempre; `data-lab` solo si `ultima`. */
  const etiqueta = (s: Sugerencia, ultima: boolean): Record<string, string> => {
    const e = opciones.etiquetaAutor?.(s.autor, s.id);
    if (!e) return {};
    return ultima ? { title: e.titulo, 'data-lab': e.abreviatura } : { title: e.titulo };
  };
  const decos: Decoration[] = [];
  sugerencias.forEach((s, i) => {
    const side = 1 + i;
    if (s.tipo === 'bloque-insertado') {
      const ancla = ubicarBloque(doc, s.bloqueId === ANCLA_INICIO ? '@metodo' : s.bloqueId);
      if (!ancla) return;
      const pos = ancla.pos + ancla.node.nodeSize;
      decos.push(widget(pos, textoVisible(s.propuesta), clases(s, 'rev-bloque-insertado'), {
        tipo: 'bloque-insertado',
        id: s.id,
      }, true, side, etiqueta(s, true)));
      return;
    }
    if (s.tipo === 'bloque-eliminado') {
      const u = ubicarBloque(doc, s.bloqueId);
      if (!u) return;
      decos.push(
        Decoration.node(u.pos, u.pos + u.node.nodeSize, { class: clases(s, 'rev-bloque-eliminado'), 'data-sug': s.id, ...etiqueta(s, true) }, {
          tipo: 'bloque-eliminado',
          id: s.id,
        }),
      );
      return;
    }
    const desde = posicionEnDoc(doc, s.bloqueId, s.base.desde);
    const hasta = posicionEnDoc(doc, s.bloqueId, s.base.hasta);
    if (s.tipo === 'formato') {
      decos.push(Decoration.inline(desde, hasta, { class: clases(s, 'rev-formato'), 'data-sug': s.id, ...etiqueta(s, true) }, {
        tipo: 'formato',
        id: s.id,
      }));
      return;
    }
    if (hasta > desde) {
      decos.push(Decoration.inline(desde, hasta, { class: clases(s, 'rev-eliminado'), 'data-sug': s.id, ...etiqueta(s, s.propuesta.length === 0) }, {
        tipo: 'eliminacion',
        id: s.id,
      }));
    }
    if (s.propuesta.length > 0) {
      decos.push(widget(hasta, textoVisible(s.propuesta), clases(s, 'rev-insertado'), { tipo: 'insercion', id: s.id }, false, side, etiqueta(s, true)));
    }
  });
  // Recuadro naranjo por conflicto.
  for (const c of opciones.conflictos ?? []) {
    const sugs = sugerencias.filter((s) => c.ids.includes(s.id));
    const deTexto = sugs.filter((s) => s.tipo === 'contenido' || s.tipo === 'formato');
    if (deTexto.length === sugs.length) {
      const desde = Math.min(...sugs.map((s) => s.base.desde));
      const hasta = Math.max(...sugs.map((s) => s.base.hasta));
      if (hasta > desde) {
        decos.push(
          Decoration.inline(posicionEnDoc(doc, c.bloqueId, desde), posicionEnDoc(doc, c.bloqueId, hasta), {
            class: 'rev-conflicto',
          }, { tipo: 'conflicto', ids: c.ids }),
        );
      }
      continue;
    }
    const u = ubicarBloque(doc, c.bloqueId === ANCLA_INICIO ? '@metodo' : c.bloqueId);
    if (u) {
      decos.push(
        Decoration.node(u.pos, u.pos + u.node.nodeSize, { class: 'rev-conflicto-bloque' }, { tipo: 'conflicto', ids: c.ids }),
      );
    }
  }
  return DecorationSet.create(doc, decos);
}

/** Plugin que muestra un DecorationSet fijado desde fuera (se remapea en cada cambio). */
export const claveDecoraciones = new PluginKey<DecorationSet>('decoracionesCambios');

export function pluginDecoraciones(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: claveDecoraciones,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr: Transaction, previo: DecorationSet) =>
        (tr.getMeta(claveDecoraciones) as DecorationSet | undefined) ?? previo.map(tr.mapping, tr.doc),
    },
    props: {
      decorations: (state: EditorState) => claveDecoraciones.getState(state),
    },
  });
}
