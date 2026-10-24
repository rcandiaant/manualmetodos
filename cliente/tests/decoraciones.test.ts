import { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Decoration } from '@tiptap/pm/view';
import { afterEach, describe, expect, it } from 'vitest';
import { detectarConflictos } from '../src/cambios/conflictos';
import { calcularSugerencias } from '../src/cambios/sugerencias';
import {
  decoracionesDeCambios,
  decoracionesRevisor,
  posicionEnDoc,
} from '../src/demo/decoraciones';
import { extensionesManual } from '../src/esquema/extensiones';
import type { DocJSON } from '../src/tipos';
import { doc, parrafo, ref } from './ayudantes-doc';

const editores: Editor[] = [];
afterEach(() => {
  while (editores.length > 0) editores.pop()?.destroy();
});

/** Doc ProseMirror de un `Editor` headless con el esquema del manual. */
function docPM(json: DocJSON): ProseMirrorNode {
  const editor = new Editor({ extensions: extensionesManual, content: json });
  editores.push(editor);
  return editor.state.doc;
}

const BASE = doc(
  parrafo('p1', 'Disolver 42,0 g de NaCl.'),
  parrafo('p2', 'Ver paso ', ref('itm:X:a'), ' y agitar.'),
);

const conTexto = (bid: string, ...contenido: (DocJSON | string)[]): DocJSON => {
  const d = structuredClone(BASE);
  const i = (d.content ?? []).findIndex((b) => b.attrs?.bid === bid);
  (d.content as DocJSON[])[i] = parrafo(bid, ...contenido);
  return d;
};

const tipo = (d: Decoration): string => (d.spec as { tipo: string }).tipo;

describe('posicionEnDoc', () => {
  it('posicionEnDoc ubica el token N del bloque', () => {
    const d = docPM(BASE);
    // Tokens de p1: «Disolver» « » «42,0» « » «g» …
    const p = posicionEnDoc(d, 'p1', 2);
    expect(d.textBetween(p, p + 4)).toBe('42,0');
    expect(d.textBetween(posicionEnDoc(d, 'p1', 0), p)).toBe('Disolver ');
    // Un átomo inline (referencia) ocupa un token y una posición.
    // Tokens de p2: «Ver» « » «paso» « » ref « » «y» « » «agitar» «.»
    const q = posicionEnDoc(d, 'p2', 8);
    expect(d.textBetween(q, q + 7)).toBe('agitar.');
    // offset = número de tokens → fin del contenido del bloque.
    const p1 = d.child(2);
    expect(posicionEnDoc(d, 'p1', 10)).toBe(posicionEnDoc(d, 'p1', 0) + p1.content.size);
    // Pseudo-bloques de la cabecera.
    expect(posicionEnDoc(d, '@metodo', 0)).toBe(d.child(0).nodeSize + 1);
  });

  it('lanza si el bloque no existe', () => {
    expect(() => posicionEnDoc(docPM(BASE), 'zz', 0)).toThrow(/zz/);
  });
});

describe('decoracionesDeCambios', () => {
  it('decoracionesDeCambios crea una inline por insercion y un widget por eliminacion', () => {
    const copia = conTexto('p1', 'Disolver 42,00 g.');
    const sugs = calcularSugerencias(BASE, copia, 'labA');
    expect(sugs).toHaveLength(2); // 42,0→42,00 y « de NaCl» eliminado
    const d = docPM(copia);
    const decos = decoracionesDeCambios(d, sugs).find();

    const inserciones = decos.filter((x) => tipo(x) === 'insercion');
    expect(inserciones).toHaveLength(1);
    expect(d.textBetween(inserciones[0].from, inserciones[0].to)).toBe('42,00');

    const eliminaciones = decos.filter((x) => tipo(x) === 'eliminacion');
    expect(eliminaciones.map((x) => (x.spec as { texto: string }).texto)).toEqual([
      '42,0',
      ' de NaCl',
    ]);
    expect(eliminaciones.every((x) => x.from === x.to)).toBe(true);
    expect(eliminaciones[0].from).toBe(inserciones[0].from);
    expect(d.textBetween(eliminaciones[1].from, eliminaciones[1].from + 1)).toBe('.');
  });

  it('marca bloques insertados y muestra los eliminados tras su bloque previo', () => {
    const copia = structuredClone(BASE);
    copia.content?.splice(3, 1, parrafo(null, 'Bloque nuevo.'));
    const d = docPM(copia);
    // Como en la demo: la copia es el JSON del editor (con todos los attrs).
    const sugs = calcularSugerencias(BASE, d.toJSON() as DocJSON, 'labA');
    const decos = decoracionesDeCambios(d, sugs, BASE).find();

    const nuevo = decos.find((x) => tipo(x) === 'bloque-insertado');
    expect(nuevo && d.nodeAt(nuevo.from)?.textContent).toBe('Bloque nuevo.');
    const borrado = decos.find((x) => tipo(x) === 'bloque-eliminado');
    expect((borrado?.spec as { texto: string }).texto).toBe('Ver paso [itm:X:a] y agitar.');
    // Tras p1, que es el bloque con bid anterior al eliminado en la base.
    const p1 = d.child(2);
    expect(borrado?.from).toBe(d.child(0).nodeSize + d.child(1).nodeSize + p1.nodeSize);
  });
});

describe('decoracionesRevisor', () => {
  it('superpone las sugerencias sobre la base y marca los conflictos', () => {
    const a = calcularSugerencias(BASE, conTexto('p1', 'Disolver 42,00 g de NaCl.'), 'labA');
    const b = calcularSugerencias(BASE, conTexto('p1', 'Disolver 42,01 g de NaCl.'), 'labB');
    const todas = [...a, ...b];
    const d = docPM(BASE);
    const decos = decoracionesRevisor(d, todas, {
      conflictos: detectarConflictos(todas),
      claseAutor: (autor) => `autor-${autor}`,
    }).find();

    const eliminados = decos.filter((x) => tipo(x) === 'eliminacion');
    expect(eliminados).toHaveLength(2);
    for (const x of eliminados) expect(d.textBetween(x.from, x.to)).toBe('42,0');
    const propuestas = decos.filter((x) => tipo(x) === 'insercion');
    expect(propuestas.map((x) => (x.spec as { texto: string }).texto).sort()).toEqual([
      '42,00',
      '42,01',
    ]);
    const conflicto = decos.filter((x) => tipo(x) === 'conflicto');
    expect(conflicto).toHaveLength(1);
    expect(d.textBetween(conflicto[0].from, conflicto[0].to)).toBe('42,0');
  });
});
