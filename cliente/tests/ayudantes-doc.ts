import type { DocJSON } from '../src/tipos';

/** Ayudantes mínimos para armar documentos de prueba (sustituyen a importarLatex en esta rama). */

type Inline = DocJSON | string;

const enlinea = (contenido: Inline[]): DocJSON[] =>
  contenido.map((c) => (typeof c === 'string' ? texto(c) : c));

export function texto(t: string, marcas: string[] = []): DocJSON {
  return marcas.length > 0
    ? { type: 'text', text: t, marks: marcas.map((m) => ({ type: m })) }
    : { type: 'text', text: t };
}

export function ref(etiqueta: string): DocJSON {
  return { type: 'referencia', attrs: { etiqueta } };
}

export function parrafo(bid: string | null, ...contenido: Inline[]): DocJSON {
  return { type: 'parrafo', attrs: { bid }, content: enlinea(contenido) };
}

export function ecuacion(bid: string | null, latex: string): DocJSON {
  return { type: 'ecuacion', attrs: { bid, latex } };
}

export function item(etiqueta: string | null, ...bloques: DocJSON[]): DocJSON {
  return { type: 'item', attrs: { etiqueta }, content: bloques };
}

export function lista(...items: DocJSON[]): DocJSON {
  return { type: 'listaVinetas', content: items };
}

export function doc(...bloques: DocJSON[]): DocJSON {
  return {
    type: 'doc',
    content: [
      { type: 'analito', content: [texto('pH')] },
      { type: 'metodo', content: [texto('Potenciometría')] },
      ...bloques,
    ],
  };
}
