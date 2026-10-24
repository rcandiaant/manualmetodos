import { describe, expect, it } from 'vitest';
import { aplicarSugerencias } from '../src/cambios/aplicar';
import { detectarConflictos } from '../src/cambios/conflictos';
import { calcularSugerencias } from '../src/cambios/sugerencias';
import { esquemaManual, validarDocumento } from '../src/esquema/esquema';
import { exportarLatex } from '../src/latex/exportar';
import { importarLatex } from '../src/latex/importar';
import type { DocJSON } from '../src/tipos';
import casos from './fixtures/exportar-casos.tex?raw';
import estructura from './fixtures/estructura.tex?raw';
import inline from './fixtures/inline.tex?raw';

/** Fixture sintético: se le introduce una cantidad para que dos laboratorios la editen. */
const TEX = estructura.replace('Pesar el material.', 'Pesar 42,0 g del material.');

/** Bloque con ese `bid` (o null). */
function buscar(n: DocJSON, bid: string): DocJSON | null {
  if (n.attrs?.bid === bid) return n;
  for (const h of n.content ?? []) {
    const r = buscar(h, bid);
    if (r) return r;
  }
  return null;
}

function reemplazarTexto(doc: DocJSON, bid: string, de: string, a: string): void {
  const bloque = buscar(doc, bid);
  const nodo = bloque?.content?.find((h) => h.type === 'text' && h.text?.includes(de));
  if (!nodo) throw new Error(`No se encontró "${de}" en ${bid}`);
  nodo.text = (nodo.text ?? '').replace(de, a);
}

function textoPlano(n: DocJSON): string {
  if (n.type === 'text') return n.text ?? '';
  return (n.content ?? []).map(textoPlano).join('\n');
}

describe('integración: importar → sugerir → conflicto → aplicar → exportar', () => {
  it('dos laboratorios editan el mismo token; se elige al laboratorio A', () => {
    const { doc: base } = importarLatex(TEX);
    expect(validarDocumento(base)).toEqual({ ok: true });
    const bid = 'b5';
    expect(textoPlano(buscar(base, bid) as DocJSON)).toBe('Pesar 42,0 g del material.');

    const copiaA = structuredClone(base);
    reemplazarTexto(copiaA, bid, '42,0', '42,00');
    const iParrafo = (copiaA.content ?? []).findIndex((b) => b.attrs?.bid === 'b2');
    copiaA.content?.splice(iParrafo + 1, 0, {
      type: 'parrafo',
      attrs: { bid: null, pegado: false },
      content: [{ type: 'text', text: 'Párrafo agregado por el laboratorio A.' }],
    });

    const copiaB = structuredClone(base);
    reemplazarTexto(copiaB, bid, '42,0', '42,01');

    const sugA = calcularSugerencias(base, copiaA, 'labA');
    const sugB = calcularSugerencias(base, copiaB, 'labB');
    expect(sugA.map((s) => s.tipo).sort()).toEqual(['bloque-insertado', 'contenido']);
    expect(sugB.map((s) => s.tipo)).toEqual(['contenido']);

    const edicionA = sugA.find((s) => s.tipo === 'contenido') as (typeof sugA)[number];
    const conflictos = detectarConflictos([...sugA, ...sugB]);
    expect(conflictos).toEqual([{ bloqueId: bid, ids: [edicionA.id, sugB[0].id] }]);

    const final = aplicarSugerencias(base, sugA);
    const tex = exportarLatex(final);
    expect(tex).toContain('42,00 g');
    expect(tex).not.toContain('42,01');

    const { doc: reimportado } = importarLatex(tex);
    expect(validarDocumento(reimportado)).toEqual({ ok: true });
    const texto = textoPlano(reimportado);
    expect(texto).toContain('Pesar 42,00 g del material.');
    expect(texto).toContain('Párrafo agregado por el laboratorio A.');
    expect(texto).toContain('Agregar el líquido.');
  });
});

describe('JSON crudo del importador frente al normalizado por el esquema', () => {
  it.each([
    ['estructura', estructura],
    ['inline', inline],
    ['exportar-casos', casos],
  ])('%s: no genera sugerencias fantasma', (_nombre, tex) => {
    const { doc } = importarLatex(tex);
    const normalizado = esquemaManual.nodeFromJSON(doc).toJSON() as DocJSON;
    expect(calcularSugerencias(doc, normalizado, 'labA')).toEqual([]);
    expect(calcularSugerencias(normalizado, doc, 'labA')).toEqual([]);
  });
});
