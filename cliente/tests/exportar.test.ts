import { describe, it, expect } from 'vitest';
import { importarLatex } from '../src/latex/importar';
import { exportarLatex } from '../src/latex/exportar';
import { compararLatex, normalizarLatex } from '../src/latex/normalizar';
import type { DocJSON } from '../src/tipos';
import estructura from './fixtures/estructura.tex?raw';
import inline from './fixtures/inline.tex?raw';
import casos from './fixtures/exportar-casos.tex?raw';

const crlf = (t: string) => t.replace(/\r?\n/g, '\r\n');
const lf = (t: string) => t.replace(/\r\n/g, '\n');

const fixtures: Record<string, string> = {
  'estructura (CRLF)': crlf(estructura),
  'estructura (LF)': lf(estructura),
  'inline (CRLF)': crlf(inline),
  'inline (LF)': lf(inline),
  'casos (CRLF)': crlf(casos),
  'casos (LF)': lf(casos),
};

const cab = (bloques: DocJSON[]): DocJSON => ({
  type: 'doc',
  content: [
    { type: 'analito', content: [{ type: 'text', text: 'A' }] },
    { type: 'metodo', content: [{ type: 'text', text: 'M' }] },
    ...bloques,
  ],
});

const parrafo = (...content: DocJSON[]): DocJSON => ({ type: 'parrafo', attrs: { bid: 'b1' }, content });

const idaYVuelta = (tex: string) => {
  const doc = importarLatex(tex).doc;
  const exportado = exportarLatex(doc);
  return { doc, exportado, otra: importarLatex(exportado).doc };
};

describe('exportarLatex — ida y vuelta', () => {
  for (const [nombre, tex] of Object.entries(fixtures)) {
    it(`ida y vuelta conserva el documento: ${nombre}`, () => {
      const { doc, otra } = idaYVuelta(tex);
      expect(otra).toEqual(doc);
    });

    it(`ida y vuelta conserva el LaTeX normalizado: ${nombre}`, () => {
      const { exportado } = idaYVuelta(tex);
      const r = compararLatex(tex, exportado);
      expect(r.primeraDiferencia).toBeUndefined();
      expect(r.igual).toBe(true);
    });
  }

  it.each([
    'texto % comentario\nsigue aquí.',
    'texto%pegado\nsigue.',
    'Usar \\foo bar y \\baz{q} r.',
    'Párrafo.\n% comentario\nOtro.',
    '\\section{T}\n% c\nTexto.',
    '\\begin{enumerate}\n\\item a\n\\end{enumerate}\n\n\\footnote{x} después',
    '\\begin{tabular}{ll}\na & b \\\\\n\\\\\nc & d\n\\end{tabular}',
    '\\begin{enumerate}\n\\item \\textbf{a $x$} \\textit{b \\textbf{c}}\n\\end{enumerate}',
    'a \\textbf{ b} c 5\\,\\% y ~x~',
  ])('ida y vuelta de caso límite: %j', (c) => {
    const { doc, exportado, otra } = idaYVuelta(`\\analito{A}\n\n\\metodo{M}\n\n${c}\n`);
    expect(otra).toEqual(doc);
    expect(compararLatex(`\\analito{A}\n\n\\metodo{M}\n\n${c}\n`, exportado).igual).toBe(true);
  });

  // R22: la línea en blanco (o su ausencia) junto a ecuaciones, tablas y
  // listas viaja en el atributo `pegado` y se reproduce al exportar.
  it.each([
    'Según:\n\n\\[ x = 1 \\]\ndonde: y.',
    'Según:\n\\[ x = 1 \\]\n\ndonde: y.',
    'Texto.\n\n\\begin{tabular}{l}\na \\\\\n\\end{tabular}\n\nSigue.',
    'Texto.\n\\begin{tabular}{l}\na \\\\\n\\end{tabular}\nSigue.',
    '\\begin{itemize}\n\\item a\n\\end{itemize}\nSigue el texto.',
    '\\begin{itemize}\n\\item a\n\\end{itemize}\n\nSigue el texto.',
    '\\begin{enumerate}\n\\item a\n\\[ x \\]\n\n\\begin{itemize}\n\\item b\n\\end{itemize}\n\\end{enumerate}',
  ])('pegado reproduce el fin de párrafo junto a un bloque: %j', (c) => {
    const tex = `\\analito{A}\n\n\\metodo{M}\n\n${c}\n`;
    const { doc, exportado, otra } = idaYVuelta(tex);
    expect(otra).toEqual(doc);
    expect(compararLatex(tex, exportado).primeraDiferencia).toBeUndefined();
  });

  it('exporta salto simple ante un bloque pegado y línea en blanco si no', () => {
    const eq = (pegado: boolean): DocJSON => ({
      type: 'ecuacion',
      attrs: { latex: 'x', bid: 'b2', pegado },
    });
    expect(exportarLatex(cab([parrafo({ type: 'text', text: 'a' }), eq(true)]))).toContain('a\n\\[');
    expect(exportarLatex(cab([parrafo({ type: 'text', text: 'a' }), eq(false)]))).toContain('a\n\n\\[');
  });

  it('escapa caracteres especiales del texto del usuario', () => {
    const tex = exportarLatex(cab([parrafo({ type: 'text', text: '50 % & más_x $ #' })]));
    expect(tex).toContain('50 \\% \\& más\\_x \\$ \\#');
  });

  it('escapa barra, llaves, tilde y circunflejo; inversos tipográficos', () => {
    const tex = exportarLatex(
      cab([parrafo({ type: 'text', text: 'a\\b {c} ~ ^ 5 g – 1—2 “x” 10 ml' })]),
    );
    expect(tex).toContain(
      'a\\textbackslash{}b \\{c\\} \\textasciitilde{} \\textasciicircum{} 5~g -- 1---2 ``x\'\' 10\\,ml',
    );
  });

  it('subindice con caracteres especiales exporta compilable y vuelve igual', () => {
    const doc = cab([
      parrafo(
        { type: 'text', text: 'x' },
        { type: 'text', text: 'a%b', marks: [{ type: 'subindice' }] },
        { type: 'text', text: '°', marks: [{ type: 'superindice' }] },
        { type: 'text', text: ' y K' },
        { type: 'text', text: '(s)', marks: [{ type: 'subindice' }] },
      ),
    ]);
    const tex = exportarLatex(doc);
    expect(tex).toContain('x\\textsubscript{a\\%b}\\textsuperscript{\\degree{}} y K$_{(s)}$');
    const vuelta = importarLatex(tex);
    expect(vuelta.avisos).toEqual([]);
    expect(vuelta.doc).toEqual(importarLatex(exportarLatex(vuelta.doc)).doc);
    expect(vuelta.doc.content![2].content).toEqual(doc.content![2].content);
  });

  it('texto de usuario con \\ { } ~ ^ sobrevive ida y vuelta', () => {
    const doc = cab([parrafo({ type: 'text', text: 'a\\b {x} ~y^ z\\' })]);
    const vuelta = importarLatex(exportarLatex(doc));
    expect(vuelta.avisos).toEqual([]);
    expect(vuelta.doc.content![2].content).toEqual(doc.content![2].content);
  });

  it('\\degree lleva {} antes de cualquier blanco o letra', () => {
    const tex = exportarLatex(
      cab([parrafo({ type: 'text', text: '5°\t' }, { type: 'text', text: 'C', marks: [{ type: 'negrita' }] })]),
    );
    expect(tex).toContain('5\\degree{}\t\\textbf{C}');
  });

  it('especial se exporta byte a byte', () => {
    const latex = '\\begin{figure}[h]\r\n  \\centering % x\r\n\\end{figure}';
    const tex = exportarLatex(cab([{ type: 'especial', attrs: { latex, bid: 'b1' } }]));
    expect(tex).toContain(latex);
  });

  it('\\degree nunca queda pegado a una letra', () => {
    const tex = exportarLatex(cab([parrafo({ type: 'text', text: '20°C y 30° C, 40°.' })]));
    expect(tex).not.toMatch(/\\degree[A-Za-z]/);
    expect(importarLatex(tex).doc.content![2].content).toEqual([
      { type: 'text', text: '20°C y 30° C, 40°.' },
    ]);
  });

  it('une corridas contiguas de sub y superíndice en una sola fórmula', () => {
    const tex = exportarLatex(
      cab([
        parrafo(
          { type: 'text', text: 'NH' },
          { type: 'text', text: '4', marks: [{ type: 'subindice' }] },
          { type: 'text', text: '+', marks: [{ type: 'superindice' }] },
          { type: 'text', text: ' y x' },
          { type: 'text', text: '12', marks: [{ type: 'subindice' }] },
        ),
      ]),
    );
    expect(tex).toContain('NH$_4^+$ y x$_{12}$');
  });

  describe('Task 4: símbolos del texto de usuario', () => {
    const SIMBOLOS = '≤ ≥ → × ± µ μ ° " < >';
    const texto0 = (d: DocJSON) => d.content![2].content;

    it('mapea símbolos comunes', () => {
      const tex = exportarLatex(cab([parrafo({ type: 'text', text: SIMBOLOS })]));
      expect(tex).toContain(
        '$\\leq$ $\\geq$ $\\rightarrow$ $\\times$ $\\pm$ $\\mu$ $\\mu$ \\degree{} \\textquotedbl{} \\textless{} \\textgreater{}',
      );
      const vuelta = importarLatex(tex);
      expect(vuelta.avisos).toEqual([]);
      // `$\mu$` se lee como µ (U+00B5): μ (U+03BC) vuelve como µ, el mismo glifo.
      expect(texto0(vuelta.doc)).toEqual([{ type: 'text', text: SIMBOLOS.replace('μ', 'µ') }]);
    });

    it('sin el μ griego la ida y vuelta JSON es identidad', () => {
      const d = cab([parrafo({ type: 'text', text: 'a≤b, 5±0,1 µm; x→y 2×3 "q" <<c>> 20°C' })]);
      const vuelta = importarLatex(exportarLatex(d));
      expect(vuelta.avisos).toEqual([]);
      expect(vuelta.doc).toEqual(d);
    });

    it('evita los atajos << y >> de babel-spanish', () => {
      const tex = exportarLatex(cab([parrafo({ type: 'text', text: '<<x>>' })]));
      expect(tex).toContain('\\textless{}\\textless{}x\\textgreater{}\\textgreater{}');
      expect(tex).not.toMatch(/<|>/);
    });

    it('símbolos contiguos o junto a una fórmula no forman $$', () => {
      const d = cab([
        parrafo(
          { type: 'text', text: '≤≥' },
          { type: 'matematica', attrs: { latex: 'x' } },
          { type: 'text', text: '±' },
          { type: 'text', text: '2', marks: [{ type: 'subindice' }] },
          { type: 'text', text: '×', marks: [{ type: 'negrita' }] },
        ),
      ]);
      const tex = exportarLatex(d);
      expect(tex).not.toContain('$$');
      expect(tex).toContain('$\\leq${}$\\geq${}$x${}$\\pm${}$_2$\\textbf{$\\times$}');
      const vuelta = importarLatex(tex);
      expect(vuelta.avisos).toEqual([]);
      expect(vuelta.doc).toEqual(d);
    });

    it('símbolos con marcas y en sub/superíndice vuelven iguales', () => {
      const d = cab([
        parrafo(
          { type: 'text', text: 'x' },
          { type: 'text', text: '±', marks: [{ type: 'superindice' }] },
          { type: 'text', text: ' a ' },
          { type: 'text', text: '≤ "y"', marks: [{ type: 'cursiva' }] },
        ),
      ]);
      const vuelta = importarLatex(exportarLatex(d));
      expect(vuelta.avisos).toEqual([]);
      expect(vuelta.doc).toEqual(d);
    });

    it('el importador lee \\textless{}, \\textgreater{} y \\textquotedbl{} como el carácter', () => {
      const tex = '\\analito{A}\n\n\\metodo{M}\n\nx \\textless{} y \\textgreater{}z \\textquotedbl{}q\\textquotedbl{}.\n';
      const { doc: d, avisos } = importarLatex(tex);
      expect(avisos).toEqual([]);
      expect(texto0(d)).toEqual([{ type: 'text', text: 'x < y >z "q".' }]);
    });

    it.each(['\\(a\\){}$b$', '$a${}\\(b\\)', '$a${}$b$ y \\(a\\){}\\(b\\)'])(
      'el {} del autor junto a \\(…\\) se conserva: %j',
      (c) => {
        const tex = `\\analito{A}\n\n\\metodo{M}\n\n${c}\n`;
        const exportado = exportarLatex(importarLatex(tex).doc);
        expect(compararLatex(tex, exportado).igual).toBe(true);
      },
    );

    it('la matemática escrita a mano en un capítulo vuelve byte a byte', () => {
      const tex =
        '\\analito{A}\n\n\\metodo{M}\n\n' +
        'CE $\\leq$ 0,5 dS/m, pH 7,30 $ \\pm $ 0,05, a 25$\\degree$C, pH $\\leq 6,5$ y $(105 \\pm 5)\\degree C$; $\\geq 20\\%$ y $>$ 2.\n';
      const { doc: d, avisos } = importarLatex(tex);
      expect(avisos).toEqual([]);
      const exportado = exportarLatex(d);
      expect(exportado).toContain(tex.split('\n\n')[2]);
      expect(compararLatex(tex, exportado).igual).toBe(true);
      expect(importarLatex(exportado).doc).toEqual(d);
    });
  });

  describe('I2: `[` al inicio de un \\item o de una fila de tabla', () => {
    const t = (text: string): DocJSON => ({ type: 'text', text });
    const p = (bid: string, text: string): DocJSON => ({ type: 'parrafo', attrs: { bid }, content: [t(text)] });
    const celda = (bid: string, text: string): DocJSON => ({ type: 'celda', attrs: { bid }, content: [t(text)] });
    const fila = (...celdas: DocJSON[]): DocJSON => ({ type: 'filaTabla', content: celdas });
    const docItem = cab([
      {
        type: 'listaOrdenada',
        content: [
          { type: 'item', attrs: { etiqueta: null }, content: [p('b1', 'uno')] },
          { type: 'item', attrs: { etiqueta: null }, content: [p('b2', '[H+] dos [x]')] },
        ],
      },
    ]);
    const docTabla = cab([
      {
        type: 'tabla',
        attrs: { columnas: 'll' },
        content: [fila(celda('b1', '[a]'), celda('b2', 'b')), fila(celda('b3', '[c]'), celda('b4', '[d]'))],
      },
    ]);

    it('exporta {[} en esas posiciones y nada más', () => {
      expect(exportarLatex(docItem)).toContain('\\item {[}H+] dos [x]\n');
      const tex = exportarLatex(docTabla);
      expect(tex).toContain('\t{[}a] & b \\\\\n\t{[}c] & [d] \\\\\n');
    });

    it.each([
      ['ítem', docItem],
      ['tabla', docTabla],
    ])('ida y vuelta JSON y LaTeX: %s', (_n, d) => {
      const tex = exportarLatex(d);
      const vuelta = importarLatex(tex);
      expect(vuelta.avisos).toEqual([]);
      expect(vuelta.doc).toEqual(d);
      const otra = exportarLatex(vuelta.doc);
      expect(otra).toBe(tex);
      expect(compararLatex(tex, otra).igual).toBe(true);
    });

    it('el importador lee {[} como [ en esas posiciones', () => {
      const tex =
        '\\analito{A}\n\n\\metodo{M}\n\n\\begin{itemize}\n\t\\item {[}NH4+] x\n\\end{itemize}\n\n' +
        '\\begin{tabular}{l}\n\t{[}c] \\\\\n\\end{tabular}\n';
      const { doc: d, avisos } = importarLatex(tex);
      expect(avisos).toEqual([]);
      expect(d.content![2].content![0].content![0].content).toEqual([t('[NH4+] x')]);
      expect(d.content![3].content![0].content![0].content).toEqual([t('[c]')]);
      expect(compararLatex(tex, exportarLatex(d)).igual).toBe(true);
    });
  });

  it('emite el estilo del manual', () => {
    const tex = exportarLatex(importarLatex(crlf(inline)).doc);
    expect(tex.startsWith('\\analito{Ejemplo}\n\n\\metodo{MÉTODO SINTÉTICO DE PRUEBA}\n')).toBe(true);
    expect(tex).toMatch(/\n\t*\\\[\n/);
    expect(tex).toMatch(/\n\t*\\\]\n/);
    expect(tex).toContain('\\begin{tabular}{cl}');
    expect(tex).toContain('$a$ & = masa del primer recipiente \\\\');
    expect(tex).toMatch(/\n\t\\item Primer paso con nota\\footnote\{/);
  });
});

describe('normalizarLatex', () => {
  it('quita comentarios, CRLF y espacios', () => {
    expect(normalizarLatex('a  % c\r\n\tb \\% d\r\n\r\n e')).toBe(normalizarLatex('a b \\% d\n\ne'));
  });

  it('R20: no oculta cambios de párrafo ni de espacios con efecto', () => {
    const distintos: [string, string][] = [
      ['Uno.\n\nDos.', 'Uno. Dos.'],
      ['\\textbf{a} b', '\\textbf{a}b'],
      ['A \\& B', 'A \\&B'],
      ['a {b} c', 'a{b}c'],
      ['x \\footnote{a}', 'x\\footnote{a}'],
    ];
    for (const [a, b] of distintos) expect(compararLatex(a, b).igual, `${a} vs ${b}`).toBe(false);
  });

  it('R20: los fines de párrafo sin efecto en LaTeX son neutros', () => {
    const pares: [string, string][] = [
      ['\\section{S}\n\nTexto.', '\\section{S}\nTexto.'],
      ['Texto.\n\n\\section{S}', 'Texto.\n\\section{S}'],
      ['\\item a\n\n\\item b\n\n\\end{enumerate}', '\\item a \\item b\\end{enumerate}'],
      ['\\footnote{\n\nNota.\n\n}', '\\footnote{Nota.}'],
    ];
    for (const [a, b] of pares) expect(compararLatex(a, b).igual, a).toBe(true);
  });

  it('R23: un comentario seguido de línea en blanco no esconde el fin de párrafo', () => {
    expect(compararLatex('Uno. % c\n\nDos.', 'Uno. Dos.').igual).toBe(false);
    const tex = '\\analito{A}\n\n\\metodo{M}\n\nUno. % c\n\nDos.\n';
    expect(compararLatex(tex, exportarLatex(importarLatex(tex).doc)).igual).toBe(true);
    expect(compararLatex('Uno. % c\n\nDos.', 'Uno.\n\nDos.').igual).toBe(true);
  });

  it('R21: \\degree pegado a una letra no equivale a las formas válidas', () => {
    expect(compararLatex('30\\degreeC', '30\\degree C').igual).toBe(false);
    expect(compararLatex('30\\degree{}C', '30\\degree C').igual).toBe(true);
    expect(compararLatex('30\\degree{} C', '30\\degree C').igual).toBe(false);
  });

  it('equivalencias de R16 y del brief', () => {
    const pares: [string, string][] = [
      ['\\emph{x}', '\\textit{x}'],
      ['“x”', "``x''"],
      ['a \\\\\n\\end{tabular}', 'a\\end{tabular}'],
      ['20\\degree C', '20\\degree{}C'],
      ['H$_{2}$O', 'H$_2$O'],
      ['x \\label{a}', 'x\\label{a}'],
      [
        '\\item a \\begin{enumerate}\\item b\\end{enumerate} c\n\\label{x}',
        '\\item \\label{x}a \\begin{enumerate}\\item b\\end{enumerate} c',
      ],
      ['\\end{enumerate}\\footnote{a}', '\\footnote{a}\\end{enumerate}'],
      ['\\end{itemize} \\end{enumerate}\n\\footnote{a {b}}', '\\footnote{a {b}}\\end{itemize}\\end{enumerate}'],
    ];
    for (const [a, b] of pares) expect(normalizarLatex(a), a).toBe(normalizarLatex(b));
  });

  it('compararLatex informa la primera diferencia con contexto', () => {
    const r = compararLatex('uno dos tres', 'uno dos cuatro');
    expect(r.igual).toBe(false);
    expect(r.primeraDiferencia!.posicion).toBe(8);
    expect(r.primeraDiferencia!.a).toContain('tres');
    expect(r.primeraDiferencia!.b).toContain('cuatro');
  });
});
