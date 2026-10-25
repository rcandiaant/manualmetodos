import { describe, expect, it } from 'vitest';
import { Node } from '@tiptap/pm/model';
import { aplicarSugerencias } from '../src/cambios/aplicar';
import { detectarCambiosEstructura } from '../src/cambios/estructura';
import { calcularSugerencias } from '../src/cambios/sugerencias';
import { esquemaManual, validarDocumento } from '../src/esquema/esquema';
import { exportarLatex } from '../src/latex/exportar';
import type { DocJSON } from '../src/tipos';
import { doc, ecuacion, item, lista, parrafo, texto } from './ayudantes-doc';

/**
 * M5: propiedad de identidad "calcular → aplicar todo = copia" sobre capítulos
 * sintéticos y copias mutadas al azar (PRNG con semilla: siempre los mismos casos).
 */

/** mulberry32: PRNG determinista de 32 bits. */
function prng(semilla: number) {
  let a = semilla >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const entero = (n: number) => Math.floor(r() * n);
  const elegir = <T>(xs: T[]): T => xs[entero(xs.length)];
  return { r, entero, elegir };
}
type Azar = ReturnType<typeof prng>;

const PALABRAS = ['Pesar', '10', 'g', 'de', 'suelo', 'agua', 'destilada', 'agitar', 'durante', '5', 'min', 'filtrar', 'la', 'solución', 'NaCl', 'pH', 'muestra', '42,0'];

const frase = (az: Azar, n = 3 + az.entero(8)) =>
  Array.from({ length: n }, () => az.elegir(PALABRAS)).join(' ') + '.';

/** Contenido inline con algo de formato. */
function enlinea(az: Azar): DocJSON[] {
  const nodos: DocJSON[] = [texto(frase(az) + ' ')];
  if (az.r() < 0.3) nodos.push(texto(az.elegir(PALABRAS), ['negrita']), texto(' y '));
  if (az.r() < 0.2) nodos.push(texto('NH'), texto('4', ['subindice']), texto(' '));
  nodos.push(texto(frase(az)));
  return nodos;
}

const conInline = (b: DocJSON, az: Azar): DocJSON => ({ ...b, content: enlinea(az) });
const seccion = (bid: string, t: string): DocJSON => ({ type: 'seccion', attrs: { bid }, content: [texto(t)] });
const listaDe = (tipo: string, items: DocJSON[]): DocJSON => ({ type: tipo, content: items });

function capitulo(az: Azar, c: number): DocJSON {
  let n = 0;
  const bid = () => `c${c}b${++n}`;
  const p = () => conInline(parrafo(bid()), az);
  const lst = (prof: number): DocJSON =>
    listaDe(
      az.elegir(['listaOrdenada', 'listaVinetas']),
      Array.from({ length: 2 + az.entero(3) }, () => {
        const hijos = [p()];
        if (az.r() < 0.3) hijos.push(p());
        if (prof === 0 && az.r() < 0.3) hijos.push(lst(1));
        return item(null, ...hijos);
      }),
    );
  const tabla = (): DocJSON => ({
    type: 'tabla',
    attrs: { columnas: 'll' },
    content: [0, 1].map(() => ({
      type: 'filaTabla',
      content: [0, 1].map(() => ({ type: 'celda', attrs: { bid: bid() }, content: [texto(az.elegir(PALABRAS))] })),
    })),
  });
  const bloques: DocJSON[] = [];
  for (let k = 0; k < 4; k++) {
    bloques.push(seccion(bid(), `Sección ${k}`), p());
    for (let j = 0; j < 3; j++) bloques.push(az.elegir([p, p, () => lst(0), tabla, () => ecuacion(bid(), `x_${j}`)])());
  }
  return doc(...bloques);
}

/** JSON tal como lo deja el editor (el esquema completa defaults y une textos). */
const normalizar = (d: DocJSON): DocJSON => Node.fromJSON(esquemaManual, d).toJSON() as DocJSON;

interface Lugares {
  textos: DocJSON[];
  listas: DocJSON[];
  items: DocJSON[];
}

function lugares(d: DocJSON): Lugares {
  const l: Lugares = { textos: [], listas: [], items: [] };
  const visitar = (n: DocJSON) => {
    if (['parrafo', 'seccion', 'celda'].includes(n.type ?? '')) l.textos.push(n);
    if (n.type === 'listaOrdenada' || n.type === 'listaVinetas') l.listas.push(n);
    if (n.type === 'item') l.items.push(n);
    for (const h of n.content ?? []) visitar(h);
  };
  visitar(d);
  return l;
}

let nuevos = 0;

/** Edita texto: reemplaza, inserta o borra una palabra, o pone negrita. */
function editarTexto(az: Azar, d: DocJSON): void {
  const b = az.elegir(lugares(d).textos);
  const textos = (b.content ?? []).filter((n) => n.type === 'text');
  if (textos.length === 0) {
    b.content = [texto(frase(az))];
    return;
  }
  const t = az.elegir(textos);
  const palabras = (t.text ?? '').split(' ');
  const i = az.entero(palabras.length);
  switch (az.entero(4)) {
    case 0:
      palabras[i] = az.elegir(PALABRAS);
      break;
    case 1:
      palabras.splice(i, 0, az.elegir(PALABRAS));
      break;
    case 2:
      if (palabras.length > 1) palabras.splice(i, 1);
      break;
    default:
      t.marks = [{ type: 'negrita' }];
  }
  t.text = palabras.join(' ') || 'x';
}

/**
 * Inserta un bloque nuevo: en el cuerpo, dentro de un ítem o como ítem nuevo
 * (en cualquier posición de una lista, también como primer ítem).
 */
function insertarBloque(az: Azar, d: DocJSON): void {
  const nuevo = (): DocJSON =>
    az.r() < 0.8 ? conInline(parrafo(`n${++nuevos}`), az) : ecuacion(`n${++nuevos}`, 'y');
  const { items, listas } = lugares(d);
  const opcion = az.entero(3);
  if (opcion === 1 && items.length > 0) {
    const it = az.elegir(items);
    it.content!.splice(1 + az.entero(it.content!.length), 0, nuevo());
  } else if (opcion === 2 && listas.length > 0) {
    const l = az.elegir(listas);
    l.content!.splice(az.entero(l.content!.length + 1), 0, item(null, conInline(parrafo(`n${++nuevos}`), az)));
  } else {
    d.content!.splice(2 + az.entero(d.content!.length - 1), 0, nuevo());
  }
}

/** Elimina un bloque del cuerpo, un bloque no inicial de un ítem o un ítem entero. */
function eliminarBloque(az: Azar, d: DocJSON): void {
  const { items, listas } = lugares(d);
  const opcion = az.entero(3);
  const itemsLargos = items.filter((it) => it.content!.length > 1);
  if (opcion === 1 && itemsLargos.length > 0) {
    const it = az.elegir(itemsLargos);
    it.content!.splice(1 + az.entero(it.content!.length - 1), 1);
  } else if (opcion === 2 && listas.some((l) => l.content!.length > 1)) {
    const l = az.elegir(listas.filter((x) => x.content!.length > 1));
    l.content!.splice(az.entero(l.content!.length), 1);
  } else if (d.content!.length > 3) {
    d.content!.splice(2 + az.entero(d.content!.length - 2), 1);
  }
}

const MUTACIONES = [editarTexto, editarTexto, insertarBloque, eliminarBloque];

describe('propiedad: aplicar todas las sugerencias reproduce la copia (M5)', () => {
  it('15 capítulos sintéticos × 20 copias mutadas', () => {
    let casos = 0;
    for (let c = 0; c < 15; c++) {
      const az = prng(1000 + c);
      const base = normalizar(capitulo(az, c));
      expect(validarDocumento(base)).toEqual({ ok: true });
      expect(calcularSugerencias(base, structuredClone(base), 'lab')).toEqual([]);
      expect(detectarCambiosEstructura(base, structuredClone(base))).toEqual([]);
      for (let k = 0; k < 20; k++) {
        const crudo = structuredClone(base);
        const n = 1 + az.entero(4);
        for (let m = 0; m < n; m++) az.elegir(MUTACIONES)(az, crudo);
        const copia = normalizar(crudo);
        expect(validarDocumento(copia)).toEqual({ ok: true });
        const caso = `capítulo ${c}, copia ${k}`;
        const aplicado = normalizar(aplicarSugerencias(base, calcularSugerencias(base, copia, 'lab')));
        expect(exportarLatex(aplicado), caso).toBe(exportarLatex(copia));
        expect(aplicado, caso).toEqual(copia);
        // Editar, insertar y eliminar no son cambios de estructura.
        expect(detectarCambiosEstructura(base, copia), caso).toEqual([]);
        casos++;
      }
    }
    expect(casos).toBe(300);
  });
});

/**
 * Un ítem nuevo como PRIMER ítem de una lista se ubica antes del bloque existente
 * siguiente (`primerHijo` + `siguiente`), no tras el bloque anterior a la lista.
 */
describe('ítem nuevo al inicio de una lista', () => {
  const nuevoItem = item(null, parrafo('n', 'Nuevo.'));

  it('tras un párrafo: inserta el primer ítem en la lista', () => {
    const base = doc(parrafo('p0', 'a'), lista(item(null, parrafo('i1', 'b'))));
    const copia = doc(parrafo('p0', 'a'), lista(nuevoItem, item(null, parrafo('i1', 'b'))));
    expect(aplicarSugerencias(base, calcularSugerencias(base, copia, 'lab'))).toEqual(copia);
  });

  it('tras otra lista: inserta el primer ítem en su propia lista', () => {
    const base = doc(lista(item(null, parrafo('i0', 'a'))), lista(item(null, parrafo('i1', 'b'))));
    const copia = doc(lista(item(null, parrafo('i0', 'a'))), lista(nuevoItem, item(null, parrafo('i1', 'b'))));
    expect(aplicarSugerencias(base, calcularSugerencias(base, copia, 'lab'))).toEqual(copia);
  });
});
