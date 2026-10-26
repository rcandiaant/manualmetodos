import { Editor } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';
import { correccionesBloquesNuevos, extensionesDemo, limpiarPegado } from '../src/editor/editor';
import { esquemaManual } from '../src/esquema/esquema';
import type { DocJSON } from '../src/tipos';
import { doc, item, lista, parrafo } from './ayudantes-doc';

const editores: Editor[] = [];
afterEach(() => {
  while (editores.length > 0) editores.pop()?.destroy();
});

const pegado = (p: DocJSON): DocJSON => ({ ...p, attrs: { ...p.attrs, pegado: true } });

describe('correccionesBloquesNuevos', () => {
  it('anula el bid repetido (conserva el primero) y resetea pegado', () => {
    const d = esquemaManual.nodeFromJSON(
      doc(parrafo('p1', 'uno'), pegado(parrafo('p1', 'dos')), parrafo('p2', 'tres')),
    );
    const segundo = d.child(0).nodeSize + d.child(1).nodeSize + d.child(2).nodeSize;
    expect(correccionesBloquesNuevos(d)).toEqual([{ pos: segundo, attrs: { bid: null, pegado: false } }]);
  });

  it('anula la etiqueta repetida de un ítem', () => {
    const d = esquemaManual.nodeFromJSON(
      doc(lista(item('itm:a', parrafo('p1', 'uno')), item('itm:a', parrafo(null, 'dos')))),
    );
    const c = correccionesBloquesNuevos(d);
    expect(c).toHaveLength(1);
    expect(d.nodeAt(c[0].pos)?.type.name).toBe('item');
    expect(c[0].attrs).toEqual({ etiqueta: null });
  });

  it('sin duplicados no corrige nada', () => {
    const d = esquemaManual.nodeFromJSON(doc(parrafo('p1', 'uno'), parrafo(null, 'x'), parrafo(null, 'y')));
    expect(correccionesBloquesNuevos(d)).toEqual([]);
  });
});

describe('limpiarPegado', () => {
  it('quita bid, pegado y etiqueta de los bloques pegados', () => {
    const d = esquemaManual.nodeFromJSON(
      doc(pegado(parrafo('p1', 'uno')), lista(item('itm:a', parrafo('p2', 'dos')))),
    );
    const s = limpiarPegado(d.slice(d.child(0).nodeSize + d.child(1).nodeSize, d.content.size));
    expect(s).toBeInstanceOf(Slice);
    const attrs: Record<string, unknown>[] = [];
    s.content.descendants((n) => {
      if (!n.isText) attrs.push(n.attrs);
    });
    expect(attrs.length).toBeGreaterThan(0);
    for (const a of attrs) {
      if ('bid' in a) expect(a.bid).toBeNull();
      if ('pegado' in a) expect(a.pegado).toBe(false);
      if ('etiqueta' in a) expect(a.etiqueta).toBeNull();
    }
  });
});

describe('editor de la demo: Enter', () => {
  function editorCon(json: DocJSON): Editor {
    const editor = new Editor({ extensions: extensionesDemo(), content: json });
    editores.push(editor);
    return editor;
  }
  /** Posición del inicio del contenido del bloque i-ésimo del cuerpo (tras la cabecera). */
  const inicioCuerpo = (e: Editor, i: number): number => {
    let p = 0;
    for (let k = 0; k < 2 + i; k++) p += e.state.doc.child(k).nodeSize;
    return p + 1;
  };
  const cuerpo = (e: Editor) => ((e.getJSON() as DocJSON).content ?? []).slice(2);

  it('al final de un párrafo: nuevo párrafo con bid null y pegado false', () => {
    const editor = editorCon(doc(pegado(parrafo('p1', 'Primera frase.'))));
    editor.commands.setTextSelection(inicioCuerpo(editor, 0) + 'Primera frase.'.length);
    editor.commands.keyboardShortcut('Enter');
    expect(cuerpo(editor).map((b) => [b.type, b.attrs])).toEqual([
      ['parrafo', { bid: 'p1', pegado: true }],
      ['parrafo', { bid: null, pegado: false }],
    ]);
  });

  it('en medio de un párrafo: el original conserva el bid', () => {
    const editor = editorCon(doc(pegado(parrafo('p1', 'Uno dos'))));
    editor.commands.setTextSelection(inicioCuerpo(editor, 0) + 3);
    editor.commands.keyboardShortcut('Enter');
    expect(cuerpo(editor)).toEqual([
      { type: 'parrafo', attrs: { bid: 'p1', pegado: true }, content: [{ type: 'text', text: 'Uno' }] },
      { type: 'parrafo', attrs: { bid: null, pegado: false }, content: [{ type: 'text', text: ' dos' }] },
    ]);
  });

  it('al inicio de un párrafo: inserta uno vacío antes y el texto conserva su bid', () => {
    const editor = editorCon(doc(parrafo('p1', 'Texto')));
    editor.commands.setTextSelection(inicioCuerpo(editor, 0));
    editor.commands.keyboardShortcut('Enter');
    expect(cuerpo(editor).map((b) => [b.attrs?.bid, b.content?.[0]?.text])).toEqual([
      [null, undefined],
      ['p1', 'Texto'],
    ]);
  });

  it('en un ítem: crea otro ítem sin bid ni etiqueta', () => {
    const editor = editorCon(doc(lista(item('itm:a', parrafo('p1', 'Paso')))));
    editor.commands.setTextSelection(inicioCuerpo(editor, 0) + 2 + 'Paso'.length);
    editor.commands.keyboardShortcut('Enter');
    const items = cuerpo(editor)[0].content ?? [];
    expect(items.map((it) => [it.attrs?.etiqueta, it.content?.[0]?.attrs?.bid])).toEqual([
      ['itm:a', 'p1'],
      [null, null],
    ]);
  });

  it('en la cabecera (analito) no hace nada', () => {
    const editor = editorCon(doc(parrafo('p1', 'x')));
    const antes = editor.getJSON();
    editor.commands.setTextSelection(2);
    editor.commands.keyboardShortcut('Enter');
    expect(editor.getJSON()).toEqual(antes);
  });
});
