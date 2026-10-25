import { describe, expect, it } from 'vitest';
import { caracteresNoSoportados, referenciasColgantes } from '../src/latex/revision';
import type { DocJSON } from '../src/tipos';
import { doc, item, lista, parrafo, ref, texto } from './ayudantes-doc';

const nota = (...bloques: DocJSON[]): DocJSON => ({ type: 'notaPie', attrs: { bloques } });

describe('revisión antes de exportar', () => {
  it('avisa caracteres no soportados', () => {
    const d = doc(parrafo('p1', 'Sonrisa ☺.'), parrafo('p2', 'Suma ∑ y ☺ ☺.'));
    expect(caracteresNoSoportados(d)).toEqual([
      { caracter: '☺', bloqueId: 'p1' },
      { caracter: '∑', bloqueId: 'p2' },
      { caracter: '☺', bloqueId: 'p2' },
    ]);
    expect(caracteresNoSoportados(doc(parrafo('p1', 'á ñ Ü ő')))).toEqual([]);
  });

  it('R8: no avisa la puntuación y los signos de Latin-1 ni ‘ ’ … ‚ „', () => {
    const d = doc(parrafo('p1', '¿Qué? ¡Sí! «cita» a·b º ª § © ® ¬ ¶ ¹ ² ³ ¼ ½ ¾ ¢ £ ¥ ¦ ¨ ¯ ´ ¸ ¤ ‘x’ … ‚y„'));
    expect(caracteresNoSoportados(d)).toEqual([]);
    expect(caracteresNoSoportados(doc(parrafo('p1', '¿☺? ∑')))).toEqual([
      { caracter: '☺', bloqueId: 'p1' },
      { caracter: '∑', bloqueId: 'p1' },
    ]);
  });

  it('avisa las letras de Latin Extended-A que T1 no define', () => {
    expect(caracteresNoSoportados(doc(parrafo('p1', 'Ħ ő ſ')))).toEqual([
      { caracter: 'Ħ', bloqueId: 'p1' },
      { caracter: 'ſ', bloqueId: 'p1' },
    ]);
  });

  it('no avisa el mapa, los escapes ni los ordinales', () => {
    const d = doc(parrafo('p1', '≤ ≥ → × ± µ μ ° " < > % & $ # _ { } ~ ^ \\ – — “ ”     nº 1ª ÿ Ž ő\t'));
    expect(caracteresNoSoportados(d)).toEqual([]);
  });

  it('ubica el carácter en su bloque: nota al pie, ítem, encabezado', () => {
    const d = doc(
      parrafo('p1', 'Texto', nota(parrafo('n1', 'α')), '.'),
      lista(item(null, parrafo('i1', 'β'))),
    );
    d.content![0].content = [texto('pH ⊕')];
    expect(caracteresNoSoportados(d)).toEqual([
      { caracter: '⊕', bloqueId: null },
      { caracter: 'α', bloqueId: 'n1' },
      { caracter: 'β', bloqueId: 'i1' },
    ]);
  });

  it('detecta referencias colgantes', () => {
    expect(referenciasColgantes(doc(parrafo('p1', 'Ver ', ref('itm:x:a'), '.')))).toEqual(['itm:x:a']);
  });

  it('no avisa referencias declaradas; cada colgante una vez, también en notas', () => {
    const d = doc(
      parrafo('p1', 'Ver ', ref('itm:x:a'), ', ', ref('itm:x:b'), ' y ', ref('itm:x:b'), nota(parrafo('n1', ref('itm:x:c')))),
      lista(item('itm:x:a', parrafo('i1', 'Paso.'))),
    );
    expect(referenciasColgantes(d)).toEqual(['itm:x:b', 'itm:x:c']);
  });
});
