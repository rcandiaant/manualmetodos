import { Editor } from '@tiptap/core';
import type { Decoration } from '@tiptap/pm/view';
import { afterEach, describe, expect, it } from 'vitest';
import { calcularSugerencias } from '../../../src/cambios/sugerencias';
import { decoracionesRevisor } from '../../../src/editor/decoraciones';
import { extensionesManual } from '../../../src/esquema/extensiones';
import { doc, parrafo } from '../../ayudantes-doc';

const editores: Editor[] = [];
afterEach(() => {
  while (editores.length > 0) editores.pop()?.destroy();
});

const BASE = doc(parrafo('p1', 'Disolver 42,0 g de NaCl.'), parrafo('p2', 'Agitar bien.'));

/** Atributos que cada decoración pone en el DOM (inline/nodo: `type.attrs`; widget: el elemento creado). */
function atributos(d: Decoration): Record<string, string> {
  const t = (d as unknown as { type: { attrs?: Record<string, string>; toDOM?: unknown } }).type;
  if (t.attrs) return t.attrs;
  const crear = t.toDOM as () => HTMLElement;
  const e = crear();
  return Object.fromEntries([...e.attributes].map((a) => [a.name, a.value]));
}

describe('decoracionesRevisor con etiqueta de autor', () => {
  it('pone title en todas las marcas y data-lab en la ultima de cada sugerencia', () => {
    const editor = new Editor({ extensions: extensionesManual, content: BASE });
    editores.push(editor);
    const copia = doc(parrafo('p1', 'Disolver 43,0 g de NaCl.'), parrafo('p2', 'Agitar.'));
    const sugs = calcularSugerencias(BASE, copia, 'u12');
    const decos = decoracionesRevisor(editor.state.doc, sugs, {
      etiquetaAutor: (autor) => (autor === 'u12' ? { titulo: 'Laboratorio Norte', abreviatura: 'Nor' } : undefined),
    }).find();
    expect(decos.length).toBeGreaterThan(0);
    for (const d of decos) expect(atributos(d).title).toBe('Laboratorio Norte');
    const conLab = decos.filter((d) => atributos(d)['data-lab'] === 'Nor');
    // Un reemplazo (tachado + propuesta) lleva una sola abreviatura: en la propuesta.
    // Una eliminación pura la lleva en el tachado.
    expect(conLab.length).toBe(sugs.length);
  });

  it('sin etiquetaAutor no agrega atributos', () => {
    const editor = new Editor({ extensions: extensionesManual, content: BASE });
    editores.push(editor);
    const copia = doc(parrafo('p1', 'Disolver 43,0 g de NaCl.'), parrafo('p2', 'Agitar bien.'));
    const decos = decoracionesRevisor(editor.state.doc, calcularSugerencias(BASE, copia, 'u12')).find();
    for (const d of decos) {
      expect(atributos(d).title).toBeUndefined();
      expect(atributos(d)['data-lab']).toBeUndefined();
    }
  });
});
