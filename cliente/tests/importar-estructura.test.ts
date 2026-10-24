import { describe, it, expect } from 'vitest';
import { importarLatex } from '../src/latex/importar';
import { validarDocumento } from '../src/esquema/esquema';
import type { DocJSON } from '../src/tipos';
import fuente from './fixtures/estructura.tex?raw';

// Se fuerza CRLF aunque git (core.autocrlf) haya normalizado el fixture a LF.
const fixture = fuente.replace(/\r?\n/g, '\r\n');

function texto(n: DocJSON): string {
  if (n.type === 'text') return n.text ?? '';
  return (n.content ?? []).map(texto).join('');
}

function todos(n: DocJSON, acc: DocJSON[] = []): DocJSON[] {
  acc.push(n);
  for (const h of n.content ?? []) todos(h, acc);
  return acc;
}

describe('importarLatex — estructura', () => {
  it('importa analito y metodo', () => {
    const { doc } = importarLatex(fixture);
    expect(doc.content![0].type).toBe('analito');
    expect(texto(doc.content![0])).toBe('pH');
    expect(doc.content![1].type).toBe('metodo');
    expect(texto(doc.content![1])).toBe('SUSPENSIÓN EN AGUA Y LECTURA CON ELECTRODO');
  });

  it('secciones y listas anidadas', () => {
    const { doc, avisos } = importarLatex(fixture);
    const tipos = doc.content!.map((n) => n.type);
    expect(tipos).toEqual([
      'analito',
      'metodo',
      'seccion',
      'parrafo',
      'seccion',
      'listaOrdenada',
      'listaVinetas',
    ]);
    expect(texto(doc.content![2])).toBe('Alcance del ejemplo');
    const lista = doc.content![5];
    expect(lista.content!.map((n) => n.type)).toEqual(['item', 'item']);
    const primero = lista.content![0];
    expect(primero.content!.map((n) => n.type)).toEqual(['parrafo', 'listaOrdenada']);
    expect(texto(primero.content![0])).toBe('Preparar la muestra de prueba.');
    expect(primero.content![1].content!.map(texto)).toEqual([
      'Pesar el material.',
      'Agregar el líquido.',
    ]);
    expect(doc.content![6].content!.map(texto)).toEqual(['Primera viñeta.', 'Segunda viñeta.']);
    expect(avisos).toEqual([]);
  });

  it('label al final del item se vuelve atributo etiqueta', () => {
    const { doc } = importarLatex(fixture);
    const item = doc.content![5].content![1];
    expect(item.attrs?.etiqueta).toBe('itm:X:a');
    expect(texto(item)).toBe('Registrar el valor observado.');
    const textos = todos(doc).filter((n) => n.type === 'text');
    expect(textos.some((n) => n.text!.includes('label'))).toBe(false);
  });

  it('importa CRLF y saltos de línea internos como un solo párrafo', () => {
    const { doc } = importarLatex(fixture);
    const p = doc.content![3];
    expect(p.type).toBe('parrafo');
    const t = texto(p);
    expect(t).toBe(
      'Este párrafo de prueba está cortado a mitad de frase y continúa en otra línea sin dejar espacios dobles.',
    );
    expect(t).not.toMatch(/[\r\n]|  /);
  });

  it('bid deterministas', () => {
    const a = importarLatex(fixture);
    const b = importarLatex(fixture);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const bids = todos(a.doc)
      .map((n) => n.attrs?.bid)
      .filter((x): x is string => typeof x === 'string');
    expect(bids).toEqual(bids.map((_, i) => `b${i + 1}`));
    expect(a.doc.content![2].attrs?.bid).toBe('b1');
  });

  it('entorno desconocido va a especial con aviso', () => {
    const figura = '\\begin{figure}[h]\r\n\t\\centering\r\n\t\\includegraphics{x.png}\r\n\\end{figure}';
    const tex = `\\analito{A}\r\n\r\n\\metodo{M}\r\n\r\nAntes.\r\n\r\n${figura}\r\n\r\nDespués.\r\n`;
    const { doc, avisos } = importarLatex(tex);
    expect(doc.content!.map((n) => n.type)).toEqual([
      'analito',
      'metodo',
      'parrafo',
      'especial',
      'parrafo',
    ]);
    expect(doc.content![3].attrs?.latex).toBe(figura);
    expect(avisos).toEqual(['línea 7: \\begin{figure}']);
  });

  it('comentario en linea propia no parte el parrafo', () => {
    const { doc } = importarLatex('\\analito{A}\n\\metodo{M}\n\nuno\n% nota\ndos\n');
    const cuerpo = doc.content!.slice(2);
    expect(cuerpo.map((n) => n.type)).toEqual(['parrafo']);
    const especiales = cuerpo[0].content!.filter((n) => n.type === 'especialInline');
    expect(especiales.map((n) => n.attrs?.latex)).toEqual(['% nota']);
    expect(validarDocumento(doc)).toEqual({ ok: true });
  });

  it('comentario aislado entre lineas en blanco', () => {
    const { doc, avisos } = importarLatex(
      '\\analito{A}\r\n\\metodo{M}\r\n\r\nuno\r\n\r\n% nota\r\n\r\ndos\r\n',
    );
    const cuerpo = doc.content!.slice(2);
    expect(cuerpo.map((n) => n.type)).toEqual(['parrafo', 'especial', 'parrafo']);
    expect(cuerpo[1].attrs?.latex).toBe('% nota');
    expect(avisos).toEqual(['línea 6: %']);
  });

  it('comando inline desconocido conserva sus bytes exactos', () => {
    const { doc } = importarLatex('\\analito{A}\n\\metodo{M}\n\nx \\foo{ a  b } y\n');
    const p = doc.content![2];
    const especiales = p.content!.filter((n) => n.type === 'especialInline');
    expect(especiales.map((n) => n.attrs?.latex)).toEqual(['\\foo{ a  b }']);
  });

  it('resultado valida contra el esquema', () => {
    const { doc } = importarLatex(fixture);
    expect(validarDocumento(doc)).toEqual({ ok: true });
  });
});
