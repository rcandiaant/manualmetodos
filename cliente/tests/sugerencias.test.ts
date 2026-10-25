import { describe, expect, it } from 'vitest';
import { aplicarSugerencias, completarGrupo } from '../src/cambios/aplicar';
import { detectarConflictos } from '../src/cambios/conflictos';
import { avisosNoCubiertos, detectarCambiosEstructura, tipoMovimiento } from '../src/cambios/estructura';
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
      profundidad: 0,
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
      orden: 0,
      profundidad: 0,
    });
  });

  it('sin ningún bloque anterior se ancla a @inicio', () => {
    const base: DocJSON = { type: 'doc', content: [parrafo('p1', 'Uno.')] };
    const copia: DocJSON = { type: 'doc', content: [parrafo(null, 'Antes.'), parrafo('p1', 'Uno.')] };
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ tipo: 'bloque-insertado', bloqueId: '@inicio', profundidad: 0 });
  });

  it('cambio en posicion 0 e insercion tras el mismo bloque tienen ids distintos', () => {
    const base = doc(parrafo('p1', 'Uno dos.'));
    const copia = doc(parrafo('p1', 'Tres dos.'), parrafo(null, 'Nuevo.'));
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s.map((x) => x.tipo)).toEqual(['contenido', 'bloque-insertado']);
    expect(s[0].id).toMatch(/^lab-01:p1:[0-9a-f]{8}$/);
    expect(s[1].id).toMatch(/^lab-01:p1:[0-9a-f]{8}$/);
    expect(s[0].id).not.toBe(s[1].id);
  });

  it('dos parrafos nuevos seguidos reciben orden 0 y 1 en orden de documento', () => {
    const base = doc(parrafo('p1', 'Uno.'));
    const copia = doc(parrafo('p1', 'Uno.'), parrafo(null, 'A.'), parrafo(null, 'B.'));
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s.map((x) => [x.orden, x.propuesta[0].content?.[0].text])).toEqual([
      [0, 'A.'],
      [1, 'B.'],
    ]);
    expect(s[0].id).not.toBe(s[1].id);
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
    expect(s[0].profundidad).toBe(1);
  });

  it('profundidad cuenta los ancestros (sin doc) del nodo insertado en la copia', () => {
    const base = doc(lista(item(null, parrafo('p1', 'Uno.'), lista(item(null, parrafo('p3', 'Tres.'))))));
    const copia = doc(
      lista(item(null, parrafo('p1', 'Uno.'), lista(item(null, parrafo('p3', 'Tres.')), item(null, parrafo(null, 'N.'))))),
    );
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ bloqueId: 'p3', profundidad: 3 });
  });

  it('parrafo borrado es bloque-eliminado', () => {
    const base = doc(parrafo('p1', 'Uno.'), parrafo('p2', 'Dos.'));
    const copia = doc(parrafo('p1', 'Uno.'));
    const s = calcularSugerencias(base, copia, AUTOR);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      tipo: 'bloque-eliminado',
      bloqueId: 'p2',
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

describe('bloques movidos o unidos (pares con grupo)', () => {
  const BASE = doc(
    parrafo('p0', 'Introducción.'),
    lista(
      item(null, parrafo('i1', 'Pesar 10 g de suelo.')),
      item(null, parrafo('i2', 'Disolver 42,0 g de NaCl.')),
      item(null, parrafo('i3', 'Agitar 5 minutos.')),
    ),
    parrafo('p9', 'Leer el pH.'),
  );
  /** Backspace al inicio de i2: su contenido pasa al ítem 1. */
  const unirI2 = (texto2 = 'Disolver 42,0 g de NaCl.') =>
    doc(
      parrafo('p0', 'Introducción.'),
      lista(
        item(null, parrafo('i1', 'Pesar 10 g de suelo.'), parrafo('i2', texto2)),
        item(null, parrafo('i3', 'Agitar 5 minutos.')),
      ),
      parrafo('p9', 'Leer el pH.'),
    );

  it('backspace al inicio de un ítem produce un par movido aplicable', () => {
    const copia = unirI2();
    const s = calcularSugerencias(BASE, copia, AUTOR);
    expect(s).toHaveLength(2);
    const ins = s.find((x) => x.tipo === 'bloque-insertado')!;
    const eli = s.find((x) => x.tipo === 'bloque-eliminado')!;
    expect(ins.grupo).toBe('mov:i2');
    expect(eli.grupo).toBe('mov:i2');
    expect(eli.bloqueId).toBe('i2');
    expect(ins.propuesta[0].attrs?.bid).toBe('i2');
    expect(aplicarSugerencias(BASE, s)).toEqual(copia);
    expect(detectarCambiosEstructura(BASE, copia)).toHaveLength(1);
    expect(avisosNoCubiertos(BASE, copia, s)).toEqual([]);
    expect(tipoMovimiento(BASE, copia, 'i2')).toBe('unido');
  });

  it('movido y editado conserva la edición en la propuesta', () => {
    const copia = unirI2('Disolver 42,00 g de NaCl.');
    const s = calcularSugerencias(BASE, copia, AUTOR);
    expect(s).toHaveLength(2);
    const ins = s.find((x) => x.tipo === 'bloque-insertado')!;
    expect(JSON.stringify(ins.propuesta)).toContain('42,00');
    expect(aplicarSugerencias(BASE, s)).toEqual(copia);
  });

  it('reordenar dos ítems produce un par por bloque movido', () => {
    const copia = doc(
      parrafo('p0', 'Introducción.'),
      lista(
        item(null, parrafo('i2', 'Disolver 42,0 g de NaCl.')),
        item(null, parrafo('i1', 'Pesar 10 g de suelo.')),
        item(null, parrafo('i3', 'Agitar 5 minutos.')),
      ),
      parrafo('p9', 'Leer el pH.'),
    );
    const s = calcularSugerencias(BASE, copia, AUTOR);
    const grupos = new Set(s.map((x) => x.grupo));
    expect(grupos.size).toBe(1);
    expect([...grupos][0]).toMatch(/^mov:i[12]$/);
    expect(s).toHaveLength(2);
    expect(aplicarSugerencias(BASE, s)).toEqual(copia);
    expect(avisosNoCubiertos(BASE, copia, s)).toEqual([]);
    const bid = [...grupos][0]!.slice(4);
    expect(tipoMovimiento(BASE, copia, bid)).toBe('movido');
  });

  it('completarGrupo agrega el miembro faltante', () => {
    const s = calcularSugerencias(BASE, unirI2(), AUTOR);
    const ins = s.find((x) => x.tipo === 'bloque-insertado')!;
    const completas = completarGrupo([ins], s);
    expect(completas).toHaveLength(2);
    expect(new Set(completas.map((x) => x.id))).toEqual(new Set(s.map((x) => x.id)));
    expect(aplicarSugerencias(BASE, completas)).toEqual(unirI2());
  });

  it('completarGrupo con un miembro rechazado lanza error', () => {
    const s = calcularSugerencias(BASE, unirI2(), AUTOR);
    const ins = s.find((x) => x.tipo === 'bloque-insertado')!;
    const eli = s.find((x) => x.tipo === 'bloque-eliminado')!;
    expect(() => completarGrupo([ins], s, [eli])).toThrow(/grupo/i);
  });

  it('aceptar solo una mitad del par lanza error visible', () => {
    const s = calcularSugerencias(BASE, unirI2(), AUTOR);
    const eli = s.find((x) => x.tipo === 'bloque-eliminado')!;
    expect(() => aplicarSugerencias(BASE, [eli])).toThrow(/grupo/i);
  });

  it('un grupo parcial (ítem con sublista movido) lanza error y el grupo completo reproduce la copia', () => {
    const base = doc(
      lista(
        item(null, parrafo('a1', 'a')),
        item(null, parrafo('x1', 'x'), lista(item(null, parrafo('s1', 's')))),
      ),
      lista(item(null, parrafo('b1', 'b'))),
    );
    const copia = doc(
      lista(item(null, parrafo('a1', 'a'))),
      lista(item(null, parrafo('b1', 'b')), item(null, parrafo('x1', 'x'), lista(item(null, parrafo('s1', 's'))))),
    );
    const s = calcularSugerencias(base, copia, AUTOR);
    const grupo = s.find((x) => x.tipo === 'bloque-insertado')!.grupo!;
    const miembros = s.filter((x) => x.grupo === grupo);
    const ins = miembros.filter((x) => x.tipo === 'bloque-insertado');
    const elis = miembros.filter((x) => x.tipo === 'bloque-eliminado');
    expect(ins).toHaveLength(1);
    expect(elis.map((x) => x.bloqueId).sort()).toEqual(['b1', 's1', 'x1']);
    const s1 = elis.find((x) => x.bloqueId === 's1')!;
    expect(() => aplicarSugerencias(base, [...ins, s1])).toThrow(/Grupo incompleto.*b1.*x1/);
    expect(() => aplicarSugerencias(base, [s1])).toThrow(/Grupo incompleto.*s1/);
    expect(aplicarSugerencias(base, miembros)).toEqual(copia);
    expect(aplicarSugerencias(base, s)).toEqual(copia);
  });

  it('un grupo choca si choca cualquiera de sus miembros', () => {
    const a = calcularSugerencias(BASE, unirI2(), 'labA');
    const editada = structuredClone(BASE);
    editada.content![3].content![1].content![0] = parrafo('i2', 'Disolver 42,00 g de NaCl.');
    const b = calcularSugerencias(BASE, editada, 'labB');
    expect(b).toHaveLength(1);
    const conflictos = detectarConflictos([...a, ...b]);
    expect(conflictos).toHaveLength(1);
    expect(new Set(conflictos[0].ids)).toEqual(new Set([...a, ...b].map((x) => x.id)));
  });

  it('dos autores que mueven el mismo bloque no comparten grupo', () => {
    const a = calcularSugerencias(BASE, unirI2(), 'labA');
    const b = calcularSugerencias(BASE, unirI2(), 'labB');
    const insA = a.find((x) => x.tipo === 'bloque-insertado')!;
    // labA completo; labB sin aceptar: completarGrupo no mezcla autores.
    expect(completarGrupo([insA], [...a, ...b]).map((x) => x.autor)).toEqual(['labA', 'labA']);
  });
});
