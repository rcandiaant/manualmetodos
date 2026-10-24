import { Node, Mark, type Extensions } from '@tiptap/core';
import Text from '@tiptap/extension-text';

const attr = <T>(def: T) => ({ default: def });

/** Atributo `bid` (ID de bloque) con default null. */
const bid = () => ({ bid: attr<string | null>(null) });

/**
 * Atributo `pegado` (R22) de los bloques: true si en la fuente LaTeX no hay
 * línea en blanco entre este bloque y el hermano anterior (cambia la sangría
 * y el espaciado del párrafo, así que es estructura real).
 */
const pegado = () => ({ pegado: attr<boolean>(false) });

/** parseHTML/renderHTML mínimos con `data-tipo` para la demo. */
function html(tipo: string, tag = 'div') {
  return {
    parseHTML: () => [{ tag: `${tag}[data-tipo="${tipo}"]` }],
    renderHTML: ({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) =>
      [tag, { ...HTMLAttributes, 'data-tipo': tipo }, 0] as const,
  };
}

function htmlAtomo(tipo: string, texto: (a: Record<string, any>) => string, tag = 'span') {
  return {
    parseHTML: () => [{ tag: `${tag}[data-tipo="${tipo}"]` }],
    renderHTML: ({ node }: { node: { attrs: Record<string, any> } }) =>
      [tag, { 'data-tipo': tipo }, texto(node.attrs)] as const,
  };
}

const Doc = Node.create({
  name: 'doc',
  topNode: true,
  content: 'analito metodo bloque*',
});

const Analito = Node.create({ name: 'analito', content: 'inline*', ...html('analito') });
const Metodo = Node.create({ name: 'metodo', content: 'inline*', ...html('metodo') });

const Seccion = Node.create({
  name: 'seccion',
  group: 'bloque',
  content: 'inline*',
  addAttributes: bid,
  ...html('seccion'),
});

const Parrafo = Node.create({
  name: 'parrafo',
  group: 'bloque',
  content: 'inline*',
  addAttributes: () => ({ ...bid(), ...pegado() }),
  ...html('parrafo', 'p'),
});

const ListaOrdenada = Node.create({
  name: 'listaOrdenada',
  group: 'bloque',
  content: 'item+',
  addAttributes: pegado,
  ...html('listaOrdenada', 'ol'),
});

const ListaVinetas = Node.create({
  name: 'listaVinetas',
  group: 'bloque',
  content: 'item+',
  addAttributes: pegado,
  ...html('listaVinetas', 'ul'),
});

const Item = Node.create({
  name: 'item',
  content: 'parrafo bloque*',
  addAttributes: () => ({ etiqueta: attr<string | null>(null) }),
  ...html('item', 'li'),
});

const Tabla = Node.create({
  name: 'tabla',
  group: 'bloque',
  content: 'filaTabla+',
  addAttributes: () => ({ columnas: attr<string>(''), ...pegado() }),
  ...html('tabla'),
});

const FilaTabla = Node.create({
  name: 'filaTabla',
  content: 'celda+',
  ...html('filaTabla'),
});

const Celda = Node.create({
  name: 'celda',
  content: 'inline*',
  addAttributes: bid,
  ...html('celda'),
});

const Ecuacion = Node.create({
  name: 'ecuacion',
  group: 'bloque',
  atom: true,
  addAttributes: () => ({ latex: attr<string>(''), ...bid(), ...pegado() }),
  ...htmlAtomo('ecuacion', (a) => a.latex, 'div'),
});

const Especial = Node.create({
  name: 'especial',
  group: 'bloque',
  atom: true,
  addAttributes: () => ({ latex: attr<string>(''), ...bid(), ...pegado() }),
  ...htmlAtomo('especial', (a) => a.latex, 'div'),
});

const Matematica = Node.create({
  name: 'matematica',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ latex: attr<string>('') }),
  ...htmlAtomo('matematica', (a) => a.latex),
});

const Referencia = Node.create({
  name: 'referencia',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ etiqueta: attr<string>('') }),
  ...htmlAtomo('referencia', (a) => a.etiqueta),
});

/** Átomo inline; los bloques de la nota viajan serializados en `attrs.bloques`. */
const NotaPie = Node.create({
  name: 'notaPie',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ bloques: attr<unknown[]>([]) }),
  ...htmlAtomo('notaPie', () => '*'),
});

const EspecialInline = Node.create({
  name: 'especialInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ latex: attr<string>('') }),
  ...htmlAtomo('especialInline', (a) => a.latex),
});

const marca = (name: string, tag: string) =>
  Mark.create({
    name,
    parseHTML: () => [{ tag: `${tag}[data-tipo="${name}"]` }],
    renderHTML: ({ HTMLAttributes }) => [tag, { ...HTMLAttributes, 'data-tipo': name }, 0],
  });

export const extensionesManual: Extensions = [
  Doc,
  Text,
  Analito,
  Metodo,
  Seccion,
  Parrafo,
  ListaOrdenada,
  ListaVinetas,
  Item,
  Tabla,
  FilaTabla,
  Celda,
  Ecuacion,
  Especial,
  Matematica,
  Referencia,
  NotaPie,
  EspecialInline,
  marca('negrita', 'strong'),
  marca('cursiva', 'em'),
  marca('subindice', 'sub'),
  marca('superindice', 'sup'),
];
