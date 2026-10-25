/**
 * Exporta el esquema del documento (`esquemaManual`) al formato que valida el servidor PHP.
 * Uso: npm run exportar-esquema [-- --fixtures]
 * Escribe ../servidor/config/esquema-documento.json (versionado; la CI comprueba que está al día).
 * Con --fixtures escribe además tres documentos sintéticos válidos en ../servidor/tests/fixtures/.
 * Los fixtures son inventados: nunca se usa contenido real del manual.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentMatch, NodeType } from '@tiptap/pm/model';
import { esquemaManual, validarDocumento } from '../src/esquema/esquema';
import type { DocJSON } from '../src/tipos';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SERVIDOR = resolve(AQUI, '..', '..', 'servidor');
const DESTINO_ESQUEMA = join(SERVIDOR, 'config', 'esquema-documento.json');
const DESTINO_FIXTURES = join(SERVIDOR, 'tests', 'fixtures');

type TipoAttr = 'string' | 'number' | 'boolean' | 'null|string' | 'json';

/**
 * Los atributos con default `null` no revelan su tipo: se declaran aquí.
 * Si aparece uno nuevo sin declarar, el script falla en vez de adivinar.
 */
const TIPOS_DE_NULOS: Record<string, TipoAttr> = {
  bid: 'null|string',
  etiqueta: 'null|string',
};

function tipoDeAttr(nodo: string, nombre: string, defecto: unknown): TipoAttr {
  if (defecto === null) {
    const t = TIPOS_DE_NULOS[nombre];
    if (!t) throw new Error(`Atributo ${nodo}.${nombre} con default null sin tipo declarado`);
    return t;
  }
  if (Array.isArray(defecto)) return 'json';
  switch (typeof defecto) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      throw new Error(`Atributo ${nodo}.${nombre}: tipo de default no soportado (${typeof defecto})`);
  }
}

function attrsDe(nombre: string, spec: Record<string, { default?: unknown }> | undefined) {
  const attrs: Record<string, TipoAttr> = {};
  for (const [a, def] of Object.entries(spec ?? {})) {
    if (!('default' in def)) throw new Error(`Atributo ${nombre}.${a} sin default`);
    attrs[a] = tipoDeAttr(nombre, a, def.default);
  }
  return attrs;
}

/** Todos los tipos que acepta alguna transición del autómata de contenido (recorrido en profundidad). */
function hijosDe(tipo: NodeType): string[] {
  const tipos = new Set<string>();
  const vistos = new Set<ContentMatch>();
  const pendientes: ContentMatch[] = [tipo.contentMatch];
  while (pendientes.length > 0) {
    const m = pendientes.pop()!;
    if (vistos.has(m)) continue;
    vistos.add(m);
    for (let i = 0; i < m.edgeCount; i++) {
      const { type, next } = m.edge(i);
      tipos.add(type.name);
      pendientes.push(next);
    }
  }
  return [...tipos].sort();
}

function exportarEsquema() {
  const nombresMarcas = Object.keys(esquemaManual.marks);
  const nodos: Record<string, unknown> = {};
  for (const [nombre, tipo] of Object.entries(esquemaManual.nodes)) {
    nodos[nombre] = {
      hijos: hijosDe(tipo),
      // Marcas que pueden llevar los hijos de este nodo (como `NodeType.allowsMarkType`).
      marcas: nombresMarcas.filter((m) => tipo.allowsMarkType(esquemaManual.marks[m])),
      attrs: attrsDe(nombre, tipo.spec.attrs as Record<string, { default?: unknown }> | undefined),
      texto: tipo.isText,
    };
  }
  const marcas: Record<string, unknown> = {};
  for (const [nombre, tipo] of Object.entries(esquemaManual.marks)) {
    marcas[nombre] = {
      attrs: attrsDe(nombre, tipo.spec.attrs as Record<string, { default?: unknown }> | undefined),
      // Marcas que no pueden convivir con esta en un mismo nodo (`MarkType.excludes`; incluye la propia).
      excluye: nombresMarcas.filter((m) => tipo.excludes(esquemaManual.marks[m])),
    };
  }
  return { nodos, marcas };
}

// ---------- fixtures sintéticos ----------

const t = (text: string, ...marcas: string[]): DocJSON =>
  marcas.length > 0 ? { type: 'text', text, marks: marcas.map((m) => ({ type: m })) } : { type: 'text', text };
const p = (bid: string | null, ...content: DocJSON[]): DocJSON => ({ type: 'parrafo', attrs: { bid, pegado: false }, content });
const item = (etiqueta: string | null, ...content: DocJSON[]): DocJSON => ({ type: 'item', attrs: { etiqueta }, content });
const ref = (etiqueta: string): DocJSON => ({ type: 'referencia', attrs: { etiqueta } });
const mat = (latex: string): DocJSON => ({ type: 'matematica', attrs: { latex } });
const celda = (bid: string, ...content: DocJSON[]): DocJSON => ({ type: 'celda', attrs: { bid }, content });
const doc = (analito: string, metodo: string, ...bloques: DocJSON[]): DocJSON => ({
  type: 'doc',
  content: [
    { type: 'analito', content: [t(analito)] },
    { type: 'metodo', content: [t(metodo)] },
    ...bloques,
  ],
});

function fixtures(): Record<string, DocJSON> {
  return {
    'doc-listas.json': doc(
      'Analito de ejemplo',
      'Método ficticio A',
      { type: 'seccion', attrs: { bid: 'f1-s1' }, content: [t('Principio')] },
      p('f1-p1', t('Texto con '), t('negrita', 'negrita'), t(', '), t('cursiva', 'cursiva'), t(' y H'), t('2', 'subindice'), t('O, ver '), ref('tab:ejemplo'), t('.')),
      {
        type: 'listaOrdenada',
        attrs: { pegado: true },
        content: [
          item('a)', p('f1-p2', t('Primer paso con '), mat('x^{2}'), t('.'))),
          item(
            null,
            p('f1-p3', t('Segundo paso:')),
            {
              type: 'listaVinetas',
              attrs: { pegado: false },
              content: [
                item(null, p('f1-p4', t('Subpaso uno.'))),
                item(null, p('f1-p5', t('Subpaso dos, 10'), t('-3', 'superindice'), t(' M.'))),
              ],
            },
          ),
        ],
      },
    ),
    'doc-tabla-ecuacion.json': doc(
      'Analito de ejemplo',
      'Método ficticio B',
      p('f2-p1', t('La concentración se calcula con la ecuación '), ref('eq:ejemplo'), t('.')),
      { type: 'ecuacion', attrs: { latex: 'C = \\frac{A - B}{m}', bid: 'f2-e1', pegado: true } },
      {
        type: 'tabla',
        attrs: { columnas: 'l c', pegado: false },
        content: [
          { type: 'filaTabla', content: [celda('f2-c1', t('Reactivo', 'negrita')), celda('f2-c2', t('Cantidad', 'negrita'))] },
          { type: 'filaTabla', content: [celda('f2-c3', t('Solución tampón')), celda('f2-c4', mat('10\\,\\mathrm{mL}'))] },
          { type: 'filaTabla', content: [celda('f2-c5'), celda('f2-c6', t('—'))] },
        ],
      },
      { type: 'especial', attrs: { latex: '\\begin{center}\\rule{2cm}{0.4pt}\\end{center}', bid: 'f2-x1', pegado: false } },
      p(null, t('Comando sin equivalente: '), { type: 'especialInline', attrs: { latex: '\\hfill' } }, t('.')),
    ),
    'doc-nota-pie.json': doc(
      'Analito de ejemplo',
      'Método ficticio C',
      p(
        'f3-p1',
        t('Secar la muestra'),
        {
          type: 'notaPie',
          attrs: {
            bloques: [
              p(null, t('La temperatura puede variar'), {
                type: 'notaPie',
                attrs: { bloques: [p(null, t('Nota anidada de ejemplo.'))] },
              }, t('.')),
              {
                type: 'listaVinetas',
                attrs: { pegado: false },
                content: [item(null, p(null, t('Opción uno.'))), item(null, p(null, t('Opción dos.')))],
              },
              { type: 'ecuacion', attrs: { latex: 'T = 105', bid: null, pegado: false } },
            ],
          },
        },
        t(' hasta peso constante (ver '),
        ref('sec:ejemplo'),
        t(').'),
      ),
    ),
  };
}

function escribirJson(ruta: string, datos: unknown) {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, JSON.stringify(datos, null, 2) + '\n', 'utf8');
}

function principal() {
  escribirJson(DESTINO_ESQUEMA, exportarEsquema());
  console.log(`Esquema escrito en ${DESTINO_ESQUEMA}`);
  if (process.argv.includes('--fixtures')) {
    for (const [nombre, d] of Object.entries(fixtures())) {
      const r = validarDocumento(d);
      if (!r.ok) throw new Error(`Fixture ${nombre} inválido: ${r.error}`);
      escribirJson(join(DESTINO_FIXTURES, nombre), d);
      console.log(`Fixture escrito: ${nombre}`);
    }
  }
}

principal();
