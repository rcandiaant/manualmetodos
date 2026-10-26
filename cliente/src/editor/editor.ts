import { Extension, Node, type Editor, type Extensions, type NodeViewRenderer } from '@tiptap/core';
import { splitBlockAs } from '@tiptap/pm/commands';
import { history, redo, undo } from '@tiptap/pm/history';
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import katex from 'katex';
import { extensionesManual } from '../esquema/extensiones';
import type { DocJSON } from '../tipos';
import { pluginDecoraciones, textoVisible } from './decoraciones';

/* ---------- R27: bloques creados al partir (Enter) o pegar ---------- */

export interface Correccion {
  pos: number;
  attrs: Record<string, unknown>;
}

/**
 * Correcciones para bloques duplicados por un split: el `bid` repetido se anula
 * (conserva el primero en orden de documento) y su `pegado` vuelve a false; la
 * `etiqueta` repetida de un ítem se anula (un `\label` no puede repetirse).
 */
export function correccionesBloquesNuevos(doc: ProseMirrorNode): Correccion[] {
  const bids = new Set<string>();
  const etiquetas = new Set<string>();
  const res: Correccion[] = [];
  doc.descendants((n, pos) => {
    const bid = n.attrs.bid;
    if (typeof bid === 'string') {
      if (bids.has(bid)) {
        res.push({ pos, attrs: 'pegado' in n.attrs ? { bid: null, pegado: false } : { bid: null } });
      }
      bids.add(bid);
    }
    const etiqueta = n.type.name === 'item' ? n.attrs.etiqueta : null;
    if (typeof etiqueta === 'string') {
      if (etiquetas.has(etiqueta)) res.push({ pos, attrs: { etiqueta: null } });
      etiquetas.add(etiqueta);
    }
    return !n.isTextblock;
  });
  return res;
}

function limpiarFragmento(f: Fragment): Fragment {
  const nodos: ProseMirrorNode[] = [];
  f.forEach((n) => {
    if (n.isText) {
      nodos.push(n);
      return;
    }
    const attrs: Record<string, unknown> = { ...n.attrs };
    if ('bid' in attrs) attrs.bid = null;
    if ('pegado' in attrs) attrs.pegado = false;
    if (n.type.name === 'item') attrs.etiqueta = null;
    nodos.push(n.type.create(attrs, limpiarFragmento(n.content), n.marks));
  });
  return Fragment.fromArray(nodos);
}

/** Lo pegado entra siempre como bloques nuevos: sin bid, sin pegado, sin etiqueta. */
export function limpiarPegado(slice: Slice): Slice {
  return new Slice(limpiarFragmento(slice.content), slice.openStart, slice.openEnd);
}

/** R27 como extensión (exportada para el mini-editor de notas de `barra.ts`). */
export const BloquesNuevos = Extension.create({
  name: 'bloquesNuevos',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('bloquesNuevos'),
        props: { transformPasted: (slice) => limpiarPegado(slice) },
        appendTransaction(transacciones, _previo, estado) {
          if (!transacciones.some((t) => t.docChanged)) return null;
          const correcciones = correccionesBloquesNuevos(estado.doc);
          if (correcciones.length === 0) return null;
          const tr = estado.tr;
          for (const c of correcciones) {
            const nodo = tr.doc.nodeAt(c.pos);
            if (nodo) tr.setNodeMarkup(c.pos, undefined, { ...nodo.attrs, ...c.attrs });
          }
          return tr;
        },
      }),
    ];
  },
});

/* ---------- Enter ---------- */

/** Bloques donde Enter no hace nada (partirlos cambiaría la estructura: columnas, cabecera). */
const SIN_ENTER = new Set(['celda', 'analito', 'metodo']);

/**
 * Enter de la demo. El bloque original conserva su bid (R27): al inicio de un bloque con
 * texto se inserta uno vacío antes; al final se crea un párrafo (no el bloque por defecto
 * del esquema, que sería una sección); en el primer párrafo de un ítem se crea otro ítem.
 */
export function alPulsarEnter(ed: Editor): boolean {
  if (!ed.state.selection.empty && !(ed.state.selection instanceof NodeSelection)) {
    ed.commands.deleteSelection();
  }
  const sel = ed.state.selection;
  if (sel instanceof NodeSelection) {
    return sel.node.isBlock ? ed.commands.insertContentAt(sel.to, { type: 'parrafo' }) : false;
  }
  const { $from } = sel;
  const bloque = $from.parent;
  if (SIN_ENTER.has(bloque.type.name)) return true;
  if (!bloque.isTextblock) return false;
  const enItem = $from.depth >= 2 && $from.node(-1).type.name === 'item' && $from.index(-1) === 0;
  if ($from.parentOffset === 0 && bloque.content.size > 0) {
    const pos = enItem ? $from.before(-1) : $from.before();
    const vacio = enItem ? { type: 'item', content: [{ type: 'parrafo' }] } : { type: 'parrafo' };
    return ed.commands.insertContentAt(pos, vacio);
  }
  if (enItem) return ed.commands.splitListItem('item');
  const parrafo = ed.schema.nodes.parrafo;
  return splitBlockAs((n, alFinal) => (alFinal ? { type: parrafo } : { type: n.type, attrs: n.attrs }))(
    ed.state,
    ed.view.dispatch,
  );
}

/* ---------- Historial y atajos ---------- */

const Edicion = Extension.create({
  name: 'edicionDemo',
  addProseMirrorPlugins() {
    return [history()];
  },
  addKeyboardShortcuts() {
    const ed = this.editor;
    return {
      'Mod-z': () => undo(ed.state, ed.view.dispatch),
      'Mod-y': () => redo(ed.state, ed.view.dispatch),
      'Shift-Mod-z': () => redo(ed.state, ed.view.dispatch),
      'Mod-b': () => ed.commands.toggleMark('negrita'),
      'Mod-i': () => ed.commands.toggleMark('cursiva'),
      'Mod-,': () => ed.commands.toggleMark('subindice'),
      'Mod-.': () => ed.commands.toggleMark('superindice'),
      Enter: () => alPulsarEnter(ed),
    };
  },
});

const DecoracionesCambios = Extension.create({
  name: 'decoracionesCambios',
  addProseMirrorPlugins() {
    return [pluginDecoraciones()];
  },
});

/* ---------- NodeViews (solo lectura: editar fórmulas/notas queda fuera de Fase 0) ---------- */

function vistaAtomo(crear: (n: ProseMirrorNode) => HTMLElement): NodeViewRenderer {
  return ({ node }) => {
    const dom = crear(node);
    dom.contentEditable = 'false';
    return { dom, ignoreMutation: () => true, stopEvent: () => false };
  };
}

function katexEn(el: HTMLElement, latex: string, displayMode: boolean): HTMLElement {
  try {
    katex.render(latex, el, { displayMode, throwOnError: false });
  } catch {
    el.textContent = latex; // KaTeX no pudo: se muestra la fuente
  }
  el.title = latex;
  return el;
}

const VISTAS: Record<string, NodeViewRenderer> = {
  matematica: vistaAtomo((n) => {
    const el = document.createElement('span');
    el.className = 'vista-matematica';
    return katexEn(el, String(n.attrs.latex), false);
  }),
  ecuacion: vistaAtomo((n) => {
    const el = document.createElement('div');
    el.className = 'vista-ecuacion';
    return katexEn(el, String(n.attrs.latex), true);
  }),
  notaPie: vistaAtomo((n) => {
    const el = document.createElement('sup');
    el.className = 'vista-nota';
    el.title = textoVisible((n.attrs.bloques ?? []) as DocJSON[]);
    return el;
  }),
  referencia: vistaAtomo((n) => {
    const el = document.createElement('span');
    el.className = 'vista-referencia';
    el.textContent = String(n.attrs.etiqueta);
    el.title = `Referencia a ${String(n.attrs.etiqueta)}`;
    return el;
  }),
};

/** Extensiones del editor de la demo: esquema del manual + vistas + R27 + historial. */
export function extensionesDemo(): Extensions {
  const conVistas = extensionesManual.map((e) => {
    const vista = VISTAS[e.name];
    return vista ? (e as Node).extend({ addNodeView: () => vista }) : e;
  });
  return [...conVistas, BloquesNuevos, Edicion, DecoracionesCambios];
}
