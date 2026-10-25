import { describe, expect, it } from 'vitest';
import { fnv1a, idSugerencia } from '../src/cambios/identidad';
import { calcularSugerencias } from '../src/cambios/sugerencias';
import { doc, item, lista, parrafo } from './ayudantes-doc';

const AUTOR = 'labA';
const BASE = doc(parrafo('p1', 'Uno dos tres cuatro cinco seis.'));
const ids = (base: ReturnType<typeof doc>, copia: ReturnType<typeof doc>) =>
  calcularSugerencias(base, copia, AUTOR).map((s) => s.id);

describe('identidad por contenido', () => {
  it('fnv1a da 8 caracteres hexadecimales (vector conocido)', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
  });

  it('insertar una sugerencia antes no cambia los ids de las demás', () => {
    const dos = doc(parrafo('p1', 'Uno DOS tres cuatro CINCO seis.'));
    const tres = doc(parrafo('p1', 'UNO DOS tres cuatro CINCO seis.'));
    const antes = ids(BASE, dos);
    const despues = ids(BASE, tres);
    expect(antes).toHaveLength(2);
    expect(despues).toHaveLength(3);
    for (const id of antes) expect(despues).toContain(id);
  });

  it('sugerencias idénticas en un bloque reciben ids distintos y estables', () => {
    const base = doc(parrafo('p1', 'a x b x c.'));
    const copia = doc(parrafo('p1', 'a y b y c.'));
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s).toHaveLength(2);
    expect(s[0].id).not.toBe(s[1].id);
    expect(calcularSugerencias(base, copia, AUTOR).map((x) => x.id)).toEqual(s.map((x) => x.id));
  });

  it('rehacer el mismo cambio da el mismo id', () => {
    const copia = doc(parrafo('p1', 'Uno DOS tres cuatro cinco seis.'));
    const primera = ids(BASE, copia);
    ids(BASE, BASE); // deshacer
    expect(ids(BASE, structuredClone(copia))).toEqual(primera);
  });

  it('cambiar la propuesta cambia el id', () => {
    const a = ids(BASE, doc(parrafo('p1', 'Uno DOS tres cuatro cinco seis.')));
    const b = ids(BASE, doc(parrafo('p1', 'Uno 2 tres cuatro cinco seis.')));
    expect(a[0]).not.toBe(b[0]);
  });

  it('el id cumple el formato del servidor (≤190, [A-Za-z0-9:@+_-])', () => {
    const s = calcularSugerencias(BASE, doc(parrafo('p1', 'Uno DOS tres cuatro cinco seis.'), parrafo(null, 'Nuevo.')), 'lab-01');
    for (const x of s) {
      expect(x.id.length).toBeLessThanOrEqual(190);
      expect(x.id).toMatch(/^[A-Za-z0-9:@+_-]+$/);
    }
  });

  it('inserciones idénticas en contenedores distintos tienen ids distintos e independientes', () => {
    // Dentro del ítem (profundidad 2) y tras la lista (profundidad 0): mismo ancla p1, mismo contenido.
    const base = doc(lista(item(null, parrafo('p1', 'Uno.'))), parrafo('p2', 'Dos.'));
    const ambas = doc(
      lista(item(null, parrafo('p1', 'Uno.'), parrafo(null, 'Igual.'))),
      parrafo(null, 'Igual.'),
      parrafo('p2', 'Dos.'),
    );
    const soloFuera = doc(lista(item(null, parrafo('p1', 'Uno.'))), parrafo(null, 'Igual.'), parrafo('p2', 'Dos.'));
    const s = calcularSugerencias(base, ambas, AUTOR);
    expect(s.map((x) => [x.bloqueId, x.profundidad])).toEqual([
      ['p1', 2],
      ['p1', 0],
    ]);
    expect(s[0].id).not.toBe(s[1].id);
    // Quitar la de dentro no cambia el id de la de fuera.
    expect(ids(base, soloFuera)).toEqual([s[1].id]);
  });

  it('el id depende de profundidad, primerHijo y siguiente', () => {
    const [s] = calcularSugerencias(
      BASE,
      doc(parrafo('p1', 'Uno dos tres cuatro cinco seis.'), parrafo(null, 'Nuevo.')),
      AUTOR,
    );
    const { id, ...resto } = s;
    expect(idSugerencia(resto, 0)).toBe(id);
    expect(idSugerencia({ ...resto, profundidad: 1 }, 0)).not.toBe(id);
    expect(idSugerencia({ ...resto, siguiente: 'x9' }, 0)).not.toBe(id);
    expect(idSugerencia({ ...resto, primerHijo: true }, 0)).not.toBe(id);
  });

  it('idSugerencia no depende de los rangos y sí de la ocurrencia', () => {
    const [s] = calcularSugerencias(BASE, doc(parrafo('p1', 'Uno DOS tres cuatro cinco seis.')), AUTOR);
    const { id: _id, ...resto } = s;
    expect(idSugerencia({ ...resto, base: { desde: 9, hasta: 9 }, copia: { desde: 9, hasta: 9 } }, 0)).toBe(s.id);
    expect(idSugerencia(resto, 1)).not.toBe(s.id);
  });
});
