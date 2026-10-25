import { describe, expect, it } from 'vitest';
import { Node } from '@tiptap/pm/model';
import { aplicarSugerencias } from '../src/cambios/aplicar';
import { avisosNoCubiertos, detectarCambiosEstructura } from '../src/cambios/estructura';
import { calcularSugerencias } from '../src/cambios/sugerencias';
import { esquemaManual, validarDocumento } from '../src/esquema/esquema';
import { exportarLatex } from '../src/latex/exportar';
import type { DocJSON } from '../src/tipos';
import { doc, ecuacion, item, lista, parrafo, texto } from './ayudantes-doc';
import { PALABRAS, conInline, mutar, prng, type Azar } from './ayudantes-mutacion';

/**
 * M5: propiedad de identidad "calcular → aplicar todo = copia" sobre capítulos
 * sintéticos y copias mutadas al azar (PRNG con semilla: siempre los mismos casos).
 */

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


describe('propiedad: aplicar todas las sugerencias reproduce la copia (M5)', () => {
  it('15 capítulos sintéticos × 20 copias mutadas', () => {
    let casos = 0;
    let conMovidos = 0;
    for (let c = 0; c < 15; c++) {
      const az = prng(1000 + c);
      const base = normalizar(capitulo(az, c));
      expect(validarDocumento(base)).toEqual({ ok: true });
      expect(calcularSugerencias(base, structuredClone(base), 'lab')).toEqual([]);
      expect(detectarCambiosEstructura(base, structuredClone(base))).toEqual([]);
      for (let k = 0; k < 20; k++) {
        const crudo = structuredClone(base);
        mutar(az, crudo);
        const copia = normalizar(crudo);
        expect(validarDocumento(copia)).toEqual({ ok: true });
        const caso = `capítulo ${c}, copia ${k}`;
        const aplicado = normalizar(aplicarSugerencias(base, calcularSugerencias(base, copia, 'lab')));
        expect(exportarLatex(aplicado), caso).toBe(exportarLatex(copia));
        expect(aplicado, caso).toEqual(copia);
        // Todo cambio de estructura (unir, mover) queda cubierto por un par aplicable.
        const sugs = calcularSugerencias(base, copia, 'lab');
        expect(avisosNoCubiertos(base, copia, sugs), caso).toEqual([]);
        if (detectarCambiosEstructura(base, copia).length > 0) conMovidos++;
        casos++;
      }
    }
    expect(casos).toBe(300);
    expect(conMovidos).toBeGreaterThan(50); // las mutaciones de estructura se ejercitan
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
