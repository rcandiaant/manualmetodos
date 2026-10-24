import { describe, expect, it } from 'vitest';
import { aplicarSugerencias } from '../src/cambios/aplicar';
import { detectarConflictos } from '../src/cambios/conflictos';
import { calcularSugerencias } from '../src/cambios/sugerencias';
import type { DocJSON } from '../src/tipos';
import { doc, ecuacion, item, lista, parrafo, texto } from './ayudantes-doc';

/** Texto plano del documento: un bloque por línea (sustituye a exportarLatex en esta rama, R10). */
function textoDoc(d: DocJSON): string {
  const lineas: string[] = [];
  const visitar = (n: DocJSON) => {
    if (n.content?.some((h) => h.type === 'text')) {
      lineas.push(n.content.map((h) => h.text ?? '').join(''));
      return;
    }
    for (const h of n.content ?? []) visitar(h);
  };
  visitar(d);
  return lineas.join('\n');
}

const BASE = doc(
  parrafo('p1', 'Disolver 42,0 g de NaCl en agua.'),
  parrafo('p2', 'Agitar durante 5 minutos.'),
  ecuacion('e1', 'x^2'),
);

const conCambio = (bid: string, nuevo: string): DocJSON => {
  const d = structuredClone(BASE);
  for (const b of d.content ?? []) if (b.attrs?.bid === bid) b.content = [texto(nuevo)];
  return d;
};

describe('detectarConflictos', () => {
  it('mismo fragmento de dos laboratorios es conflicto', () => {
    const a = calcularSugerencias(BASE, conCambio('p1', 'Disolver 42,00 g de NaCl en agua.'), 'labA');
    const b = calcularSugerencias(BASE, conCambio('p1', 'Disolver 42,01 g de NaCl en agua.'), 'labB');
    const c = detectarConflictos([...a, ...b]);
    expect(c).toEqual([{ bloqueId: 'p1', ids: [a[0].id, b[0].id] }]);
  });

  it('cambios en zonas distintas no son conflicto', () => {
    const a = calcularSugerencias(BASE, conCambio('p1', 'Disolver 42,00 g de NaCl en agua.'), 'labA');
    const b = calcularSugerencias(BASE, conCambio('p1', 'Disolver 42,0 g de NaCl en agua destilada.'), 'labB');
    const otro = calcularSugerencias(BASE, conCambio('p2', 'Agitar durante 10 minutos.'), 'labC');
    expect(detectarConflictos([...a, ...b, ...otro])).toEqual([]);
  });

  it('mismo autor nunca entra en conflicto consigo mismo', () => {
    const a = calcularSugerencias(BASE, conCambio('p1', 'Disolver 42,00 g de NaCl en agua.'), 'labA');
    const a2 = a.map((s) => ({ ...s, id: `${s.id}-bis`, propuesta: [texto('43')] }));
    expect(detectarConflictos([...a, ...a2])).toEqual([]);
  });

  it('inserciones de bloque en la misma posición son conflicto', () => {
    const copiaA = structuredClone(BASE);
    copiaA.content?.splice(3, 0, parrafo('nA', 'Nuevo A.'));
    const copiaB = structuredClone(BASE);
    copiaB.content?.splice(3, 0, parrafo('nB', 'Nuevo B.'));
    const a = calcularSugerencias(BASE, copiaA, 'labA');
    const b = calcularSugerencias(BASE, copiaB, 'labB');
    expect(detectarConflictos([...a, ...b])).toEqual([{ bloqueId: 'p1', ids: [a[0].id, b[0].id] }]);
  });

  it('una inserción dentro del texto no choca con una inserción de bloque del mismo ancla', () => {
    const copiaA = structuredClone(BASE);
    copiaA.content?.splice(3, 0, parrafo('nA', 'Nuevo A.'));
    const a = calcularSugerencias(BASE, copiaA, 'labA');
    const b = calcularSugerencias(BASE, conCambio('p1', 'Ya Disolver 42,0 g de NaCl en agua.'), 'labB');
    expect(b[0].base).toEqual({ desde: 0, hasta: 0 });
    expect(detectarConflictos([...a, ...b])).toEqual([]);
  });

  it('eliminar un bloque choca con cualquier cambio de otro autor en ese bloque', () => {
    const copiaA = structuredClone(BASE);
    copiaA.content?.splice(3, 1); // elimina p2
    const a = calcularSugerencias(BASE, copiaA, 'labA');
    const b = calcularSugerencias(BASE, conCambio('p2', 'Agitar durante 10 minutos.'), 'labB');
    expect(detectarConflictos([...a, ...b])).toEqual([{ bloqueId: 'p2', ids: [a[0].id, b[0].id] }]);
  });

  it('agrupa transitivamente', () => {
    const [plantilla] = calcularSugerencias(BASE, conCambio('p1', 'Diluir 42,0 g de NaCl en agua.'), 'labA');
    const s = (autor: string, desde: number, hasta: number) => ({
      ...plantilla,
      id: `${autor}:p1:${desde}`,
      autor,
      base: { desde, hasta },
    });
    // A [0,1) choca con B [0,3), que choca con C [2,3); A y C no se tocan entre sí.
    const lista = [s('labA', 0, 1), s('labB', 0, 3), s('labC', 2, 3), s('labD', 5, 6)];
    expect(detectarConflictos(lista)).toEqual([
      { bloqueId: 'p1', ids: ['labA:p1:0', 'labB:p1:0', 'labC:p1:2'] },
    ]);
  });
});

describe('aplicarSugerencias', () => {
  it('aplicar una sugerencia produce el texto propuesto', () => {
    const a = calcularSugerencias(BASE, conCambio('p1', 'Disolver 42,00 g de NaCl en agua.'), 'labA');
    const t = textoDoc(aplicarSugerencias(BASE, a));
    expect(t).toContain('42,00 g');
    expect(t).not.toContain('42,0 g');
  });

  it('aplicar varias del mismo bloque respeta posiciones', () => {
    const a = calcularSugerencias(BASE, conCambio('p1', 'Disolver 42,00 g de KCl en agua.'), 'labA');
    expect(a).toHaveLength(2);
    const r = aplicarSugerencias(BASE, a);
    expect(r.content?.[2]).toEqual(parrafo('p1', 'Disolver 42,00 g de KCl en agua.'));
  });

  it('aplica sugerencias no solapadas de autores distintos en el mismo bloque', () => {
    const a = calcularSugerencias(BASE, conCambio('p1', 'Disolver 42,00 g de NaCl en agua.'), 'labA');
    const b = calcularSugerencias(BASE, conCambio('p1', 'Disolver 42,0 g de NaCl en agua destilada.'), 'labB');
    const r = aplicarSugerencias(BASE, [...b, ...a]);
    expect(textoDoc(r)).toContain('Disolver 42,00 g de NaCl en agua destilada.');
  });

  it('aplicar sugerencias en conflicto lanza error', () => {
    const a = calcularSugerencias(BASE, conCambio('p1', 'Disolver 42,00 g de NaCl en agua.'), 'labA');
    const b = calcularSugerencias(BASE, conCambio('p1', 'Disolver 42,01 g de NaCl en agua.'), 'labB');
    expect(() => aplicarSugerencias(BASE, [...a, ...b])).toThrow(/^Sugerencias en conflicto: /);
  });

  it('aplicar ninguna devuelve la base', () => {
    expect(aplicarSugerencias(BASE, [])).toEqual(BASE);
  });

  it('no muta la base', () => {
    const copiaBase = structuredClone(BASE);
    const a = calcularSugerencias(BASE, conCambio('p1', 'Otro texto.'), 'labA');
    aplicarSugerencias(BASE, a);
    expect(BASE).toEqual(copiaBase);
  });

  it('cambio de formato fusiona nodos de texto adyacentes', () => {
    const base = doc(parrafo('p1', 'uno ', texto('dos', ['negrita']), ' tres'));
    const copia = doc(parrafo('p1', 'uno dos tres'));
    const s = calcularSugerencias(base, copia, 'labA');
    expect(s[0].tipo).toBe('formato');
    expect(aplicarSugerencias(base, s).content?.[2]).toEqual(parrafo('p1', 'uno dos tres'));
  });

  it('cambio en un bloque atómico y en la cabecera', () => {
    const copia = structuredClone(BASE);
    copia.content![0] = { type: 'analito', content: [texto('pH en agua')] };
    copia.content![4] = ecuacion('e1', 'y^2');
    const s = calcularSugerencias(BASE, copia, 'labA');
    expect(aplicarSugerencias(BASE, s)).toEqual(copia);
  });

  it('inserta bloques nuevos en orden de documento tras su ancla (R8)', () => {
    const copia = structuredClone(BASE);
    copia.content?.splice(3, 0, parrafo('n1', 'Primero.'), parrafo('n2', 'Segundo.'));
    const s = calcularSugerencias(BASE, copia, 'labA');
    expect(aplicarSugerencias(BASE, s)).toEqual(copia);
  });

  it('inserta un item nuevo como hermano del item del ancla (R4)', () => {
    const base = doc(lista(item(null, parrafo('p1', 'a')), item(null, parrafo('p2', 'b'))));
    const copia = doc(
      lista(item(null, parrafo('p1', 'a')), item(null, parrafo('n1', 'nuevo')), item(null, parrafo('p2', 'b'))),
    );
    const s = calcularSugerencias(base, copia, 'labA');
    expect(s[0].propuesta[0].type).toBe('item');
    expect(aplicarSugerencias(base, s)).toEqual(copia);
  });

  it('inserta una lista nueva tras un párrafo dentro de un item, en el item', () => {
    const base = doc(lista(item(null, parrafo('p1', 'a'))), parrafo('p2', 'b'));
    const copia = doc(lista(item(null, parrafo('p1', 'a'), lista(item(null, parrafo('n1', 'sub'))))), parrafo('p2', 'b'));
    const s = calcularSugerencias(base, copia, 'labA');
    expect(aplicarSugerencias(base, s)).toEqual(copia);
  });

  it('inserción sin ubicación válida lanza error', () => {
    const base = doc(parrafo('p1', 'a'));
    const s = calcularSugerencias(base, doc(parrafo('p1', 'a'), parrafo('n1', 'b')), 'labA');
    s[0].propuesta = [{ type: 'celda', attrs: { bid: 'c9' }, content: [texto('x')] }];
    expect(() => aplicarSugerencias(base, s)).toThrow(/^No se puede ubicar la inserción/);
  });

  it('inserta al inicio de un documento sin cabecera', () => {
    const base: DocJSON = { type: 'doc', content: [parrafo('p1', 'a')] };
    const copia: DocJSON = { type: 'doc', content: [parrafo('n1', 'nuevo'), parrafo('p1', 'a')] };
    const s = calcularSugerencias(base, copia, 'labA');
    expect(s[0].bloqueId).toBe('@inicio');
    expect(aplicarSugerencias(base, s)).toEqual(copia);
  });

  it('elimina un bloque', () => {
    const copia = structuredClone(BASE);
    copia.content?.splice(3, 1);
    const s = calcularSugerencias(BASE, copia, 'labA');
    expect(aplicarSugerencias(BASE, s)).toEqual(copia);
  });

  it('eliminar el párrafo de un item elimina el item y la lista vaciada', () => {
    const base = doc(parrafo('p0', 'x'), lista(item(null, parrafo('p1', 'a')), item(null, parrafo('p2', 'b'))));
    const sinItem = doc(parrafo('p0', 'x'), lista(item(null, parrafo('p2', 'b'))));
    const s1 = calcularSugerencias(base, sinItem, 'labA');
    expect(aplicarSugerencias(base, s1)).toEqual(sinItem);
    const sinLista = doc(parrafo('p0', 'x'));
    const s2 = calcularSugerencias(base, sinLista, 'labA');
    expect(aplicarSugerencias(base, s2)).toEqual(sinLista);
  });

  it('eliminar parrafo inicial de item con sublista lanza error', () => {
    const base = doc(lista(item(null, parrafo('p1', 'Uno.'), lista(item(null, parrafo('p3', 'Tres.'))))));
    const copiaB = doc(lista(item(null, lista(item(null, parrafo('p3', 'Tres.'))))));
    const copiaA = doc(lista(item(null, parrafo('p1', 'Uno.'), lista(item(null, parrafo('p3', 'Tres bis.'))))));
    const s = [...calcularSugerencias(base, copiaB, 'labB'), ...calcularSugerencias(base, copiaA, 'labA')];
    expect(() => aplicarSugerencias(base, s)).toThrow(
      'No se puede eliminar el párrafo inicial de un ítem con contenido anidado: p1',
    );
  });

  it('eliminar un item completo con su sublista no lanza error', () => {
    const base = doc(
      parrafo('p0', 'x'),
      lista(item(null, parrafo('p1', 'Uno.'), lista(item(null, parrafo('p3', 'Tres.')))), item(null, parrafo('p2', 'Dos.'))),
    );
    const copia = doc(parrafo('p0', 'x'), lista(item(null, parrafo('p2', 'Dos.'))));
    const s = calcularSugerencias(base, copia, 'labA');
    expect(aplicarSugerencias(base, s)).toEqual(copia);
  });

  it('item nuevo tras item con sublista va en la lista exterior', () => {
    const base = doc(
      lista(item(null, parrafo('p1', 'Uno.'), lista(item(null, parrafo('p3', 'Tres.')))), item(null, parrafo('p2', 'Dos.'))),
    );
    const copia = doc(
      lista(
        item(null, parrafo('p1', 'Uno.'), lista(item(null, parrafo('p3', 'Tres.')))),
        item(null, parrafo('n1', 'Nuevo.')),
        item(null, parrafo('p2', 'Dos.')),
      ),
    );
    const s = calcularSugerencias(base, copia, 'labA');
    expect(s[0]).toMatchObject({ bloqueId: 'p3', profundidad: 1 });
    expect(aplicarSugerencias(base, s)).toEqual(copia);
  });

  it('parrafo nuevo tras una lista queda despues de la lista', () => {
    const base = doc(lista(item(null, parrafo('p1', 'Uno.'))), parrafo('p2', 'Dos.'));
    const copia = doc(lista(item(null, parrafo('p1', 'Uno.'))), parrafo('n1', 'Nuevo.'), parrafo('p2', 'Dos.'));
    const s = calcularSugerencias(base, copia, 'labA');
    expect(s[0]).toMatchObject({ bloqueId: 'p1', profundidad: 0 });
    expect(aplicarSugerencias(base, s)).toEqual(copia);
  });

  it('inserciones del mismo ancla a distinta profundidad respetan el orden (R8)', () => {
    const base = doc(lista(item(null, parrafo('p1', 'Uno.'))), parrafo('p2', 'Dos.'));
    const copia = doc(
      lista(item(null, parrafo('p1', 'Uno.'), parrafo('n1', 'Dentro.')), item(null, parrafo('n2', 'Item.'))),
      parrafo('n3', 'Fuera.'),
      parrafo('p2', 'Dos.'),
    );
    const s = calcularSugerencias(base, copia, 'labA');
    expect(s.map((x) => [x.id, x.profundidad])).toEqual([
      ['labA:p1:+0', 2],
      ['labA:p1:+1', 1],
      ['labA:p1:+2', 0],
    ]);
    expect(aplicarSugerencias(base, s)).toEqual(copia);
  });

  it('profundidad sin contenedor válido lanza error', () => {
    const base = doc(parrafo('p1', 'a'));
    const s = calcularSugerencias(base, doc(parrafo('p1', 'a'), parrafo('n1', 'b')), 'labA');
    s[0].propuesta = [item(null, parrafo('n1', 'b'))];
    expect(() => aplicarSugerencias(base, s)).toThrow(/^No se puede ubicar la inserción/);
  });

  it('id de inserción malformado lanza error', () => {
    const base = doc(parrafo('p1', 'a'));
    const s = calcularSugerencias(base, doc(parrafo('p1', 'a'), parrafo('n1', 'b')), 'labA');
    s[0].id = 'labA:p1:x';
    expect(() => aplicarSugerencias(base, s)).toThrow(/Id de inserción malformado/);
  });

  it('combina cambios, inserciones y eliminaciones de varios laboratorios', () => {
    const copiaA = conCambio('p1', 'Disolver 42,00 g de NaCl en agua.');
    copiaA.content?.splice(4, 0, parrafo('nA', 'Reposar.'));
    const copiaB = structuredClone(BASE);
    copiaB.content?.splice(4, 1); // elimina e1
    const s = [...calcularSugerencias(BASE, copiaA, 'labA'), ...calcularSugerencias(BASE, copiaB, 'labB')];
    expect(aplicarSugerencias(BASE, s)).toEqual(
      doc(parrafo('p1', 'Disolver 42,00 g de NaCl en agua.'), parrafo('p2', 'Agitar durante 5 minutos.'), parrafo('nA', 'Reposar.')),
    );
  });
});
