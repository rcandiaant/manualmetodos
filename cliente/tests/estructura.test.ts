import { describe, expect, it } from 'vitest';
import { aplicarSugerencias } from '../src/cambios/aplicar';
import { avisosNoCubiertos, bidsMovidos, detectarCambiosEstructura, tipoMovimiento } from '../src/cambios/estructura';
import { calcularSugerencias } from '../src/cambios/sugerencias';
import type { DocJSON } from '../src/tipos';
import { doc, ecuacion, item, lista, parrafo } from './ayudantes-doc';

const AUTOR = 'lab-01';

const BASE = doc(
  parrafo('p0', 'Introducción del método.'),
  lista(
    item(null, parrafo('i1', 'Pesar 10 g de suelo.')),
    item(null, parrafo('i2', 'Agregar 25 mL de agua.'), parrafo('i2b', 'Usar agua destilada.')),
    item(null, parrafo('i3', 'Agitar 5 minutos.')),
  ),
  ecuacion('e1', 'x^2'),
  parrafo('p9', 'Leer el pH.'),
);

/** Ítems de la lista de BASE (índice 3 del doc: analito, metodo, p0, lista). */
const items = (d: DocJSON): DocJSON[] => d.content![3].content!;

describe('detectarCambiosEstructura (I1)', () => {
  it('copia sin cambios: sin avisos', () => {
    expect(detectarCambiosEstructura(BASE, structuredClone(BASE))).toEqual([]);
  });

  it('bidsMovidos da los bids de los avisos', () => {
    expect(bidsMovidos(BASE, structuredClone(BASE))).toEqual(new Set());
    const copia = structuredClone(BASE);
    const [it1, it2] = items(copia);
    it1.content!.push(it2.content!.pop()!); // i2b al final del ítem 1
    expect(bidsMovidos(BASE, copia)).toEqual(new Set(['i2b']));
    const c = copia.content!;
    c.splice(2, 0, ...c.splice(4, 1)); // y la ecuación antes de p0
    expect(bidsMovidos(BASE, copia)).toEqual(new Set(['i2b', 'e1']));
  });

  it('avisosNoCubiertos conserva los avisos sin par completo', () => {
    const copia = structuredClone(BASE);
    const c = copia.content!;
    c.splice(2, 0, ...c.splice(4, 1)); // ecuación antes de p0
    const sugs = calcularSugerencias(BASE, copia, AUTOR);
    expect(avisosNoCubiertos(BASE, copia, sugs)).toEqual([]);
    expect(tipoMovimiento(BASE, copia, 'e1')).toBe('movido');
    const sinInsercion = sugs.filter((s) => s.tipo !== 'bloque-insertado');
    expect(avisosNoCubiertos(BASE, copia, sinInsercion)).toEqual(detectarCambiosEstructura(BASE, copia));
    expect(avisosNoCubiertos(BASE, copia, [])).toHaveLength(1);
  });

  it('cambio de tipo con el mismo bid es un par aplicable', () => {
    const copia = structuredClone(BASE);
    copia.content![2] = { type: 'seccion', attrs: { bid: 'p0' }, content: copia.content![2].content };
    const sugs = calcularSugerencias(BASE, copia, AUTOR);
    expect(sugs.every((s) => s.grupo === 'mov:p0')).toBe(true);
    expect(aplicarSugerencias(BASE, sugs)).toEqual(copia);
  });

  it('Backspace al inicio de un ítem (lo une al anterior) da aviso y un par por bloque movido', () => {
    const copia = structuredClone(BASE);
    const [it1, it2] = items(copia);
    it1.content!.push(...it2.content!); // joinBackward: item1 = [i1, i2, i2b]
    items(copia).splice(1, 1);
    const sugs = calcularSugerencias(BASE, copia, AUTOR);
    expect(sugs.map((s) => [s.tipo, s.grupo]).sort()).toEqual([
      ['bloque-eliminado', 'mov:i2'],
      ['bloque-eliminado', 'mov:i2b'],
      ['bloque-insertado', 'mov:i2'],
      ['bloque-insertado', 'mov:i2b'],
    ]);
    expect(aplicarSugerencias(BASE, sugs)).toEqual(copia);
    expect(avisosNoCubiertos(BASE, copia, sugs)).toEqual([]);
    expect(tipoMovimiento(BASE, copia, 'i2')).toBe('unido');
    expect(tipoMovimiento(BASE, copia, 'i2b')).toBe('unido');
    const avisos = detectarCambiosEstructura(BASE, copia);
    expect(avisos).toHaveLength(2); // i2 e i2b cambiaron de ítem; i1 no
    expect(avisos[0]).toContain('Agregar 25 mL de agua.');
    expect(avisos[1]).toContain('Usar agua destilada.');
    expect(avisos.join('\n')).not.toContain('Pesar');
  });

  it('bloque movido a un ítem anterior da aviso solo para ese bloque', () => {
    const copia = structuredClone(BASE);
    const [it1, it2] = items(copia);
    it1.content!.push(it2.content!.pop()!); // i2b al final del ítem 1
    const avisos = detectarCambiosEstructura(BASE, copia);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('Usar agua destilada.');
  });

  it('bloque movido a un ítem posterior da aviso (puede nombrar también a sus nuevos vecinos)', () => {
    const copia = structuredClone(BASE);
    const [, it2, it3] = items(copia);
    it3.content!.unshift(it2.content!.pop()!); // i2b al inicio del ítem 3
    const avisos = detectarCambiosEstructura(BASE, copia);
    expect(avisos.some((a) => a.includes('Usar agua destilada.'))).toBe(true);
    expect(avisos.join(' ')).not.toContain('Pesar');
  });

  it('bloque sacado de la lista al nivel superior da aviso', () => {
    const copia = structuredClone(BASE);
    const i3 = items(copia).pop()!.content![0];
    copia.content!.splice(4, 0, i3); // tras la lista
    const avisos = detectarCambiosEstructura(BASE, copia);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('Agitar 5 minutos.');
  });

  it('reordenar bloques hermanos da aviso para el bloque movido', () => {
    const copia = structuredClone(BASE);
    const c = copia.content!;
    const [e1] = c.splice(4, 1);
    c.splice(2, 0, e1); // ecuación antes de p0
    const avisos = detectarCambiosEstructura(BASE, copia);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('x^2');
  });

  it('cambio de tipo con el mismo bid da aviso', () => {
    const copia = structuredClone(BASE);
    copia.content![2] = { type: 'seccion', attrs: { bid: 'p0' }, content: copia.content![2].content };
    const avisos = detectarCambiosEstructura(BASE, copia);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('Introducción');
  });

  it('extracto largo se recorta', () => {
    const largo = 'a'.repeat(200);
    const base = doc(parrafo('p1', largo), parrafo('p2', 'b'), parrafo('p3', 'c'));
    const copia = doc(parrafo('p2', 'b'), parrafo('p3', 'c'), parrafo('p1', largo));
    const avisos = detectarCambiosEstructura(base, copia);
    expect(avisos).toHaveLength(1);
    const [aviso] = avisos;
    expect(aviso).toContain('…');
    expect(aviso.length).toBeLessThan(200);
  });

  describe('ediciones normales: sin avisos', () => {
    it('edición de texto', () => {
      const copia = structuredClone(BASE);
      items(copia)[1].content![0] = parrafo('i2', 'Agregar 50 mL de agua.');
      expect(detectarCambiosEstructura(BASE, copia)).toEqual([]);
    });

    it('inserción de bloques e ítems nuevos', () => {
      const copia = structuredClone(BASE);
      items(copia).splice(0, 0, item(null, parrafo('n2', 'Ítem nuevo primero.')));
      items(copia)[2].content!.splice(0, 0, parrafo('n3', 'Nuevo dentro del ítem.'));
      items(copia).push(item(null, parrafo('n4', 'Ítem nuevo final.')));
      copia.content!.splice(2, 0, parrafo('n1', 'Nuevo al inicio.'));
      expect(detectarCambiosEstructura(BASE, copia)).toEqual([]);
    });

    it('eliminación de bloques e ítems', () => {
      const copia = structuredClone(BASE);
      items(copia).splice(0, 1); // ítem 1 entero
      items(copia)[0].content!.splice(0, 1); // i2 (queda i2b como primer párrafo)
      copia.content!.splice(4, 1); // ecuación
      expect(detectarCambiosEstructura(BASE, copia)).toEqual([]);
    });

    it('eliminación de la lista completa', () => {
      const copia = structuredClone(BASE);
      copia.content!.splice(3, 1);
      expect(detectarCambiosEstructura(BASE, copia)).toEqual([]);
    });
  });

  it('documentos sintéticos grandes sin editar: sin avisos', () => {
    for (let n = 0; n < 15; n++) {
      const bloques: DocJSON[] = [];
      for (let k = 0; k < 20; k++) {
        bloques.push(parrafo(`c${n}p${k}`, `Párrafo ${k}.`));
        bloques.push(lista(item(null, parrafo(`c${n}i${k}a`, 'a'), lista(item(null, parrafo(`c${n}i${k}b`, 'b'))))));
      }
      const d = doc(...bloques);
      expect(detectarCambiosEstructura(d, structuredClone(d))).toEqual([]);
    }
  });
});
