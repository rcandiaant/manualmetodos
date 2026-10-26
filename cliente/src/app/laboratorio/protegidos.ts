/**
 * Contenido especial protegido (spec §5.1): los bloques `especial` y los átomos
 * `especialInline` se ven grises y no se pueden editar ni borrar desde el editor del
 * laboratorio (se pueden comentar, Task 5). Una transacción que haría desaparecer
 * alguno se descarta, salvo que lleve la meta `PERMITIR_ESPECIAL` (cargar un borrador).
 */
import { Extension, Node, type Extensions, type NodeViewRenderer } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { extensionesDemo } from '../../editor/editor';

export const PERMITIR_ESPECIAL = 'permitirEspecial';
const ESPECIALES = new Set(['especial', 'especialInline']);

function contar(doc: ProseMirrorNode): number {
  let n = 0;
  doc.descendants((nodo) => {
    if (ESPECIALES.has(nodo.type.name)) n++;
  });
  return n;
}

/** ¿Algún paso de la transacción reemplaza un rango que contiene contenido especial? */
function tocaEspecial(tr: Transaction): boolean {
  let toca = false;
  tr.steps.forEach((paso, i) => {
    if (toca) return;
    const antes = tr.docs[i];
    paso.getMap().forEach((desde, hasta) => {
      if (toca || hasta <= desde) return;
      antes.nodesBetween(desde, hasta, (n) => {
        if (ESPECIALES.has(n.type.name)) toca = true;
        return !toca;
      });
    });
  });
  return toca;
}

export function permiteTransaccion(tr: Transaction): boolean {
  if (!tr.docChanged || tr.getMeta(PERMITIR_ESPECIAL)) return true;
  if (!tocaEspecial(tr)) return true;
  return contar(tr.doc) >= contar(tr.before);
}

const ProtegerEspeciales = Extension.create({
  name: 'protegerEspeciales',
  addProseMirrorPlugins() {
    return [new Plugin({ key: new PluginKey('protegerEspeciales'), filterTransaction: permiteTransaccion })];
  },
});

function vistaEspecial(tag: 'div' | 'span'): NodeViewRenderer {
  return ({ node }) => {
    const dom = document.createElement(tag);
    dom.dataset.tipo = node.type.name;
    dom.className = 'bloque-especial';
    dom.setAttribute('contenteditable', 'false');
    dom.textContent = String(node.attrs.latex ?? '');
    dom.title = 'Contenido especial: no se puede editar (sí comentar).';
    return { dom, ignoreMutation: () => true, stopEvent: () => false };
  };
}

/** Extensiones del editor del laboratorio: las de `editor.ts` + contenido especial protegido. */
export function extensionesLaboratorio(): Extensions {
  return [
    ...extensionesDemo().map((e) => {
      if (e.name === 'especial') return (e as Node).extend({ addNodeView: () => vistaEspecial('div') });
      if (e.name === 'especialInline') return (e as Node).extend({ addNodeView: () => vistaEspecial('span') });
      return e;
    }),
    ProtegerEspeciales,
  ];
}
