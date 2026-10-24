import { describe, expect, it } from 'vitest';
import { calcularSugerencias, listarBloques } from '../src/cambios/sugerencias';
import { tokenizarBloque } from '../src/cambios/tokens';
import type { DocJSON } from '../src/tipos';
import { doc, ecuacion, item, lista, parrafo, ref, texto } from './ayudantes-doc';

const AUTOR = 'lab-01';

describe('tokenizarBloque', () => {
  it('separa palabras, espacios, puntuación y átomos', () => {
    const t = tokenizarBloque(parrafo('p1', 'Ver ', ref('itm:a'), '.'));
    expect(t.map((x) => x.clave)).toEqual(['Ver', ' ', 'referencia:{"etiqueta":"itm:a"}', '.']);
  });

  it('un bloque atómico es un solo token sin bid en la clave', () => {
    const t = tokenizarBloque(ecuacion('e1', 'x^2'));
    expect(t).toHaveLength(1);
    expect(t[0].clave).toBe('ecuacion:{"latex":"x^2"}');
  });
});

describe('listarBloques', () => {
  it('lista bloques de texto y atómicos en orden con su anterior', () => {
    const d = doc(parrafo('p1', 'a'), lista(item(null, parrafo('p2', 'b'))), ecuacion('e1', 'x'));
    expect(listarBloques(d).map((b) => [b.bid, b.anteriorBid])).toEqual([
      ['@analito', null],
      ['@metodo', '@analito'],
      ['p1', '@metodo'],
      ['p2', 'p1'],
      ['e1', 'p2'],
    ]);
  });
});

describe('calcularSugerencias', () => {
  it('copia sin cambios produce cero sugerencias', () => {
    const base = doc(parrafo('p1', 'Disolver 42,0 g de NaCl.'), ecuacion('e1', 'x'));
    expect(calcularSugerencias(base, structuredClone(base), AUTOR)).toEqual([]);
  });

  it('cambio de una palabra', () => {
    const base = doc(parrafo('p1', 'Disolver 42,0 g de'));
    const copia = doc(parrafo('p1', 'Disolver 42,00 g de'));
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      tipo: 'contenido',
      bloqueId: 'p1',
      autor: AUTOR,
      id: 'lab-01:p1:2',
      base: { desde: 2, hasta: 3 },
      copia: { desde: 2, hasta: 3 },
      original: [{ type: 'text', text: '42,0' }],
      propuesta: [{ type: 'text', text: '42,00' }],
    });
  });

  it('insercion al final del bloque', () => {
    const base = doc(parrafo('p1', 'Conservar a 4 °C'));
    const copia = doc(parrafo('p1', 'Conservar a 4 °C por un máximo de 30 días'));
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s).toHaveLength(1);
    expect(s[0].tipo).toBe('contenido');
    expect(s[0].base.desde).toBe(s[0].base.hasta);
    expect(s[0].original).toEqual([]);
    expect(s[0].propuesta).toEqual([{ type: 'text', text: ' por un máximo de 30 días' }]);
  });

  it('solo negrita es formato', () => {
    const base = doc(parrafo('p1', 'Agitar durante 5 min'));
    const copia = doc(parrafo('p1', 'Agitar ', texto('durante', ['negrita']), ' 5 min'));
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s).toHaveLength(1);
    expect(s[0].tipo).toBe('formato');
    expect(s[0].original).toEqual([{ type: 'text', text: 'durante' }]);
    expect(s[0].propuesta).toEqual([
      { type: 'text', text: 'durante', marks: [{ type: 'negrita' }] },
    ]);
  });

  it('parrafo nuevo es bloque-insertado anclado al anterior', () => {
    const base = doc(parrafo('p1', 'Uno.'), parrafo('p2', 'Dos.'));
    const copia = doc(parrafo('p1', 'Uno.'), parrafo(null, 'Nuevo.'), parrafo('p2', 'Dos.'));
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      tipo: 'bloque-insertado',
      bloqueId: 'p1',
      base: { desde: 0, hasta: 0 },
      original: [],
    });
    expect(s[0].propuesta).toEqual([parrafo(null, 'Nuevo.')]);
  });

  it('parrafo nuevo tras la cabecera se ancla a @metodo', () => {
    const base = doc(parrafo('p1', 'Uno.'));
    const copia = doc(parrafo(null, 'Antes.'), parrafo('p1', 'Uno.'));
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      tipo: 'bloque-insertado',
      bloqueId: '@metodo',
      id: 'lab-01:@metodo:+0',
    });
  });

  it('sin ningún bloque anterior se ancla a @inicio', () => {
    const base: DocJSON = { type: 'doc', content: [parrafo('p1', 'Uno.')] };
    const copia: DocJSON = { type: 'doc', content: [parrafo(null, 'Antes.'), parrafo('p1', 'Uno.')] };
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ tipo: 'bloque-insertado', bloqueId: '@inicio' });
  });

  it('cambio en posicion 0 e insercion tras el mismo bloque tienen ids distintos', () => {
    const base = doc(parrafo('p1', 'Uno dos.'));
    const copia = doc(parrafo('p1', 'Tres dos.'), parrafo(null, 'Nuevo.'));
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s.map((x) => [x.tipo, x.id])).toEqual([
      ['contenido', 'lab-01:p1:0'],
      ['bloque-insertado', 'lab-01:p1:+0'],
    ]);
  });

  it('dos parrafos nuevos seguidos reciben +0 y +1 en orden de documento', () => {
    const base = doc(parrafo('p1', 'Uno.'));
    const copia = doc(parrafo('p1', 'Uno.'), parrafo(null, 'A.'), parrafo(null, 'B.'));
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s.map((x) => [x.id, x.propuesta[0].content?.[0].text])).toEqual([
      ['lab-01:p1:+0', 'A.'],
      ['lab-01:p1:+1', 'B.'],
    ]);
  });

  it('cambio en metodo genera sugerencia con bloqueId @metodo', () => {
    const base = doc(parrafo('p1', 'Uno.'));
    const copia = structuredClone(base);
    copia.content![1].content = [texto('Potenciometría en agua')];
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      tipo: 'contenido',
      bloqueId: '@metodo',
      id: 'lab-01:@metodo:1',
      propuesta: [{ type: 'text', text: ' en agua' }],
    });
  });

  it('los nodos devueltos no comparten referencias con la copia', () => {
    const base = doc(parrafo('p1', 'Ver ', ref('itm:a'), '.'));
    const copia = doc(parrafo('p1', 'Ver ', ref('itm:b'), '.'), parrafo(null, 'Nuevo.'));
    const antes = structuredClone(copia);
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s).toHaveLength(2);
    s[0].propuesta[0].attrs!.etiqueta = 'mutada';
    s[1].propuesta[0].content![0].text = 'mutado';
    expect(copia).toEqual(antes);
  });

  it('nuevo item en lista es bloque-insertado con el item completo', () => {
    const base = doc(lista(item(null, parrafo('p1', 'Uno.'))));
    const nuevo = item(null, parrafo(null, 'Dos.'));
    const copia = doc(lista(item(null, parrafo('p1', 'Uno.')), nuevo));
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s).toHaveLength(1);
    expect(s[0].tipo).toBe('bloque-insertado');
    expect(s[0].bloqueId).toBe('p1');
    expect(s[0].propuesta[0].type).toBe('item');
    expect(s[0].propuesta).toEqual([nuevo]);
  });

  it('parrafo borrado es bloque-eliminado', () => {
    const base = doc(parrafo('p1', 'Uno.'), parrafo('p2', 'Dos.'));
    const copia = doc(parrafo('p1', 'Uno.'));
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      tipo: 'bloque-eliminado',
      bloqueId: 'p2',
      id: 'lab-01:p2:0',
      propuesta: [],
    });
    expect(s[0].original).toEqual([parrafo('p2', 'Dos.')]);
  });

  it('item borrado da un bloque-eliminado por cada bid', () => {
    const base = doc(lista(item(null, parrafo('p1', 'Uno.')), item(null, parrafo('p2', 'Dos.'), parrafo('p3', 'Tres.'))));
    const copia = doc(lista(item(null, parrafo('p1', 'Uno.'))));
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s.map((x) => [x.tipo, x.bloqueId])).toEqual([
      ['bloque-eliminado', 'p2'],
      ['bloque-eliminado', 'p3'],
    ]);
  });

  it('cambiar una referencia cuenta como un token', () => {
    const base = doc(parrafo('p1', 'Ver ', ref('itm:a'), '.'));
    const copia = doc(parrafo('p1', 'Ver ', ref('itm:b'), '.'));
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s).toHaveLength(1);
    expect(s[0].tipo).toBe('contenido');
    expect(s[0].base).toEqual({ desde: 2, hasta: 3 });
    expect(s[0].copia).toEqual({ desde: 2, hasta: 3 });
    expect(s[0].original).toEqual([ref('itm:a')]);
    expect(s[0].propuesta).toEqual([ref('itm:b')]);
  });

  it('escribir y deshacer no deja rastro', () => {
    const base = doc(parrafo('p1', 'Disolver 42,0 g de NaCl.'));
    // tras escribir y deshacer, el editor puede dejar el texto partido en varios nodos
    const copia = doc(parrafo('p1', 'Disol', 'ver 42,0 g ', 'de NaCl.'));
    expect(calcularSugerencias(base, copia, AUTOR)).toEqual([]);
  });

  it('cambio en ecuación es contenido de un token', () => {
    const base = doc(ecuacion('e1', 'x^2'));
    const copia = doc(ecuacion('e1', 'x^3'));
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ tipo: 'contenido', bloqueId: 'e1', base: { desde: 0, hasta: 1 } });
    expect(s[0].propuesta).toEqual([ecuacion('e1', 'x^3')]);
  });
});
