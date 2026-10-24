import { describe, it, expect } from 'vitest';
import { importarLatex } from '../src/latex/importar';
import { validarDocumento } from '../src/esquema/esquema';
import type { DocJSON } from '../src/tipos';
import fuente from './fixtures/inline.tex?raw';

// Se fuerza CRLF aunque git (core.autocrlf) haya normalizado el fixture a LF.
const fixture = fuente.replace(/\r?\n/g, '\r\n');

function texto(n: DocJSON): string {
  if (n.type === 'text') return n.text ?? '';
  return (n.content ?? []).map(texto).join('');
}

/** Recorre el árbol incluyendo los bloques de las notas al pie. */
function todos(n: DocJSON, acc: DocJSON[] = []): DocJSON[] {
  acc.push(n);
  for (const h of n.content ?? []) todos(h, acc);
  if (n.type === 'notaPie') for (const b of n.attrs?.bloques ?? []) todos(b, acc);
  return acc;
}

const deTipo = (doc: DocJSON, tipo: string) => todos(doc).filter((n) => n.type === tipo);

const marcas = (n: DocJSON) => (n.marks ?? []).map((m) => m.type);

/** Importa un cuerpo envuelto en cabeceras mínimas y devuelve sus bloques. */
function cuerpo(tex: string) {
  const r = importarLatex(`\\analito{A}\n\\metodo{M}\n\n${tex}\n`);
  return { bloques: r.doc.content!.slice(2), avisos: r.avisos, doc: r.doc };
}

describe('importarLatex — inline, ecuaciones y tablas', () => {
  it('subindices simples se vuelven marcas', () => {
    const { doc } = importarLatex(fixture);
    const p = doc.content![3];
    const [h, dos, so, cuatro] = p.content!;
    expect(h).toEqual({ type: 'text', text: 'Se agrega H' });
    expect(dos).toEqual({ type: 'text', text: '2', marks: [{ type: 'subindice' }] });
    expect(so.text).toBe('SO');
    expect(marcas(so)).toEqual([]);
    expect(cuatro).toEqual({ type: 'text', text: '4', marks: [{ type: 'subindice' }] });
  });

  it('sub y superindice combinados y con llaves', () => {
    const { bloques } = cuerpo('NH$_4^+$ y Ca$^{2+}$ y x$_{12}$');
    expect(bloques[0].content).toEqual([
      { type: 'text', text: 'NH' },
      { type: 'text', text: '4', marks: [{ type: 'subindice' }] },
      { type: 'text', text: '+', marks: [{ type: 'superindice' }] },
      { type: 'text', text: ' y Ca' },
      { type: 'text', text: '2+', marks: [{ type: 'superindice' }] },
      { type: 'text', text: ' y x' },
      { type: 'text', text: '12', marks: [{ type: 'subindice' }] },
    ]);
  });

  it('math compleja queda como nodo matematica', () => {
    const { doc } = importarLatex(fixture);
    const mats = deTipo(doc, 'matematica');
    expect(mats[0].attrs?.latex).toBe('(105 \\pm 5)\\degree C');
    const { bloques } = cuerpo('$R^2$ y $_2\\cdot$');
    expect(bloques[0].content!.filter((n) => n.type === 'matematica').map((n) => n.attrs?.latex)).toEqual([
      'R^2',
      '_2\\cdot',
    ]);
  });

  it('ref se vuelve nodo referencia', () => {
    const { doc } = importarLatex(fixture);
    const refs = deTipo(doc, 'referencia');
    expect(refs).toEqual([{ type: 'referencia', attrs: { etiqueta: 'itm:X:a' } }]);
  });

  it('footnote con itemize interno y footnote suelto entre bloques', () => {
    const { doc } = importarLatex(fixture);
    const notas = deTipo(doc, 'notaPie');
    expect(notas).toHaveLength(2);
    const [conLista, suelta] = notas;
    const bl = conLista.attrs!.bloques as DocJSON[];
    expect(bl.map((b) => b.type)).toEqual(['parrafo', 'listaVinetas']);
    expect(texto(bl[0])).toBe('Nota con lista:');
    expect(bl[1].content!.map(texto)).toEqual(['opción uno;', 'opción dos.']);
    // La nota queda dentro del párrafo del primer item, seguida del punto.
    const item1 = doc.content![5].content![0];
    expect(item1.content![0].content!.map((n) => n.type)).toEqual(['text', 'notaPie', 'text']);
    // La suelta queda al final del último párrafo del último item.
    const lista = doc.content![5];
    expect(doc.content!.length).toBe(6);
    const ultimoItem = lista.content![lista.content!.length - 1];
    const ultimoParrafo = ultimoItem.content![ultimoItem.content!.length - 1];
    expect(ultimoParrafo.type).toBe('parrafo');
    const fin = ultimoParrafo.content![ultimoParrafo.content!.length - 1];
    expect(fin).toBe(suelta);
    expect(texto((suelta.attrs!.bloques as DocJSON[])[0])).toBe('Nota suelta tras la lista.');
  });

  it('footnote suelto sin parrafo final queda en un parrafo propio', () => {
    const tex = '\\begin{itemize}\n\\item a\n\\[ x \\]\n\\end{itemize}\\footnote{n}';
    const { bloques } = cuerpo(tex);
    expect(bloques.map((b) => b.type)).toEqual(['listaVinetas', 'parrafo']);
    expect(bloques[1].content!.map((n) => n.type)).toEqual(['notaPie']);
  });

  it('bid de las notas siguen el orden del documento', () => {
    const { doc } = importarLatex(fixture);
    const bids = todos(doc)
      .map((n) => n.attrs?.bid)
      .filter((x): x is string => typeof x === 'string')
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    expect(bids).toEqual(bids.map((_, i) => `b${i + 1}`));
    const item1 = doc.content![5].content![0];
    expect(item1.content![0].attrs?.bid).toBe('b4');
    const nota = deTipo(doc, 'notaPie')[0];
    expect((nota.attrs!.bloques as DocJSON[])[0].attrs?.bid).toBe('b5');
  });

  it('ecuacion destacada', () => {
    const { doc } = importarLatex(fixture);
    const item2 = doc.content![5].content![1];
    expect(item2.content!.map((n) => n.type)).toEqual(['parrafo', 'ecuacion', 'parrafo', 'tabla']);
    expect(item2.content![1].attrs?.latex).toBe('SA\\,(\\%) = \\frac{a-b}{b-c} \\times 100');
    expect(texto(item2.content![0])).toBe('Calcular según:');
    expect(texto(item2.content![2])).toBe('donde:');
  });

  it('ecuacion a mitad de parrafo lo divide en dos', () => {
    const { bloques } = cuerpo('antes\n\\[\n  a + b\n\\]\ndespués');
    expect(bloques.map((b) => b.type)).toEqual(['parrafo', 'ecuacion', 'parrafo']);
    expect(bloques[1].attrs?.latex).toBe('a + b');
  });

  it('pegado: el párrafo dividido por una ecuación queda pegado; con línea en blanco no', () => {
    const { bloques } = cuerpo('antes\n\\[\n  a + b\n\\]\ndespués\n\notro');
    expect(bloques.map((b) => b.attrs?.pegado ?? false)).toEqual([false, true, true, false]);
    const sep = cuerpo('antes\n\n\\[ a \\]\n\ndespués').bloques;
    expect(sep.map((b) => b.attrs?.pegado ?? false)).toEqual([false, false, false]);
  });

  it('pegado: texto justo tras una lista y tabla en el flujo del párrafo', () => {
    const { bloques } = cuerpo(
      '\\begin{itemize}\n\\item a\n\\end{itemize}\nsigue\n\\begin{tabular}{l}\nx \\\\\n\\end{tabular}\n\nfin',
    );
    expect(bloques.map((b) => [b.type, b.attrs?.pegado ?? false])).toEqual([
      ['listaVinetas', false],
      ['parrafo', true],
      ['tabla', true],
      ['parrafo', false],
    ]);
  });

  it('tabular a tabla', () => {
    const { doc } = importarLatex(fixture);
    const [tabla] = deTipo(doc, 'tabla');
    expect(tabla.attrs?.columnas).toBe('cl');
    expect(tabla.content!.map((f) => f.content!.length)).toEqual([2, 2, 2]);
    const celda = tabla.content![0].content![0];
    expect(celda.type).toBe('celda');
    expect(typeof celda.attrs?.bid).toBe('string');
    expect(celda.content).toEqual([{ type: 'matematica', attrs: { latex: 'a' } }]);
    expect(texto(tabla.content![2].content![1])).toBe('= masa del recipiente vacío');
  });

  it('tabular con barra final no crea fila vacia; celdas vacias se conservan', () => {
    const { bloques } = cuerpo('\\begin{tabular}{cl}\n$a$ & uno \\\\\n & dos \\\\\n\\end{tabular}');
    const tabla = bloques[0];
    expect(tabla.type).toBe('tabla');
    expect(tabla.content!.length).toBe(2);
    expect(tabla.content![1].content![0].content ?? []).toEqual([]);
  });

  it('tabular con hline queda como especial con aviso', () => {
    const tab = '\\begin{tabular}{cl}\\hline\na & b \\\\\n\\end{tabular}';
    const { bloques, avisos } = cuerpo(tab);
    expect(bloques[0]).toMatchObject({ type: 'especial', attrs: { latex: tab } });
    expect(avisos).toEqual(['línea 4: \\begin{tabular}']);
  });

  it('negrita, cursiva y escapes', () => {
    const { bloques } = cuerpo(
      '\\textbf{ojo} \\textit{a} \\emph{b} 5\\,\\% \\& \\_ \\$ \\# a--b---c ``q\'\' x~y 20\\degree C',
    );
    expect(bloques[0].content).toEqual([
      { type: 'text', text: 'ojo', marks: [{ type: 'negrita' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'a', marks: [{ type: 'cursiva' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'b', marks: [{ type: 'cursiva' }] },
      { type: 'text', text: ' 5\u202F% & _ $ # a–b—c “q” x\u00A0y 20°C' },
    ]);
  });

  it('marcas anidadas y atomos dentro de negrita', () => {
    const { bloques } = cuerpo('\\textbf{H$_2$O y \\textit{x}}');
    expect(bloques[0].content).toEqual([
      { type: 'text', text: 'H', marks: [{ type: 'negrita' }] },
      { type: 'text', text: '2', marks: [{ type: 'negrita' }, { type: 'subindice' }] },
      { type: 'text', text: 'O y ', marks: [{ type: 'negrita' }] },
      { type: 'text', text: 'x', marks: [{ type: 'negrita' }, { type: 'cursiva' }] },
    ]);
  });

  it('comando desconocido a especialInline con aviso', () => {
    const { doc, avisos } = importarLatex(fixture);
    const esp = deTipo(doc, 'especialInline');
    expect(esp.map((n) => n.attrs?.latex)).toEqual(['\\foo{bar}']);
    expect(avisos).toEqual(['línea 7: \\foo']);
  });

  it('resultado valida contra el esquema (incluidas las notas)', () => {
    const { doc } = importarLatex(fixture);
    expect(validarDocumento(doc)).toEqual({ ok: true });
  });
});
