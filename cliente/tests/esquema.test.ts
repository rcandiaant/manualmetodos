import { describe, it, expect } from 'vitest';
import { Node } from '@tiptap/pm/model';
import { esquemaManual, validarDocumento } from '../src/esquema/esquema';
import type { DocJSON } from '../src/tipos';

const t = (text: string): DocJSON => ({ type: 'text', text });
const p = (text: string): DocJSON => ({ type: 'parrafo', content: [t(text)] });
const doc = (...bloques: DocJSON[]): DocJSON => ({
  type: 'doc',
  content: [
    { type: 'analito', content: [t('Nitrógeno')] },
    { type: 'metodo', content: [t('Kjeldahl')] },
    ...bloques,
  ],
});

describe('esquema del manual', () => {
  it('documento mínimo válido', () => {
    expect(validarDocumento(doc(p('hola')))).toEqual({ ok: true });
  });

  it('rechaza doc sin metodo', () => {
    const r = validarDocumento({
      type: 'doc',
      content: [{ type: 'analito', content: [t('N')] }, p('x')],
    });
    expect(r.ok).toBe(false);
  });

  it('item requiere parrafo inicial', () => {
    const r = validarDocumento(
      doc({
        type: 'listaVinetas',
        content: [{ type: 'item', content: [{ type: 'listaVinetas', content: [] }] }],
      }),
    );
    expect(r.ok).toBe(false);
  });

  it('notaPie guarda bloques en atributo', () => {
    const bloques = [p('nota')];
    const d = doc({
      type: 'parrafo',
      content: [t('a'), { type: 'notaPie', attrs: { bloques } }],
    });
    expect(validarDocumento(d)).toEqual({ ok: true });
    const out = Node.fromJSON(esquemaManual, d).toJSON();
    expect(out.content[2].content[1].attrs.bloques).toEqual(bloques);
  });

  it('rechaza notaPie con bloques invalidos', () => {
    const d = doc({
      type: 'parrafo',
      content: [{ type: 'notaPie', attrs: { bloques: [{ type: 'item', content: [] }] } }],
    });
    const r = validarDocumento(d);
    expect(r.ok).toBe(false);
  });
});
