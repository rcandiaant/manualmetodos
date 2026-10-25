import { afterEach, describe, expect, it } from 'vitest';
import { Node } from '@tiptap/pm/model';
import { esquemaManual } from '../src/esquema/esquema';
import { estadoVacio, type ContextoModo, type Modo } from '../src/demo/almacen';
import { montarLaboratorio } from '../src/demo/laboratorio';
import { montarRevisor } from '../src/demo/revisor';
import type { DocJSON } from '../src/tipos';
import { doc, item, lista, parrafo } from './ayudantes-doc';

/** Humo de la demo (jsdom): un bloque unido con Backspace es UNA tarjeta con una sola decisión. */

const normalizar = (d: DocJSON): DocJSON => Node.fromJSON(esquemaManual, d).toJSON() as DocJSON;

const BASE = normalizar(
  doc(
    parrafo('p0', 'Introducción.'),
    lista(item(null, parrafo('i1', 'Pesar 10 g.')), item(null, parrafo('i2', 'Disolver 42,0 g.'))),
  ),
);
const COPIA = normalizar(
  doc(parrafo('p0', 'Introducción.'), lista(item(null, parrafo('i1', 'Pesar 10 g.'), parrafo('i2', 'Disolver 42,00 g.')))),
);

const montados: Modo[] = [];
afterEach(() => {
  for (const m of montados.splice(0)) m.destruir({ descartar: true });
});

function contexto(): ContextoModo {
  const estado = estadoVacio();
  estado.base = BASE;
  estado.copias.labA = COPIA;
  return { estado, guardar: () => true };
}

describe('demo: bloque movido o unido', () => {
  it('revisor: una tarjeta «Unido» con un solo Aceptar/Rechazar que decide todo el grupo', () => {
    const ctx = contexto();
    const raiz = document.createElement('div');
    montados.push(montarRevisor(raiz, ctx));
    const tarjetas = [...raiz.querySelectorAll('li.tarjeta')];
    expect(tarjetas).toHaveLength(1);
    const [t] = tarjetas;
    expect(t.querySelector('.etiqueta-tipo')?.textContent).toBe('Unido al ítem anterior');
    expect(t.textContent).toContain('42,00');
    const botones = [...t.querySelectorAll('button')].map((b) => b.textContent);
    expect(botones).toEqual(['Aceptar', 'Rechazar']);
    // Sin avisos de estructura: el cambio quedó cubierto por el par.
    expect((raiz.querySelector('.aviso-estructura') as HTMLElement).hidden).toBe(true);

    (t.querySelector('button.aceptar') as HTMLButtonElement).click();
    const decisiones = Object.values(ctx.estado.decisiones);
    expect(Object.keys(ctx.estado.decisiones)).toHaveLength(2);
    expect(decisiones).toEqual(['aceptada', 'aceptada']);

    (raiz.querySelector('li.tarjeta button.rechazar') as HTMLButtonElement).click();
    expect(Object.values(ctx.estado.decisiones)).toEqual(['rechazada', 'rechazada']);

    (raiz.querySelector('li.tarjeta button.rechazar') as HTMLButtonElement).click(); // alterna: sin decisión
    expect(ctx.estado.decisiones).toEqual({});
  });

  it('laboratorio: lista el par como una tarjeta «Unido» y no muestra la caja de avisos', () => {
    const raiz = document.createElement('div');
    montados.push(montarLaboratorio(raiz, contexto(), 'labA'));
    const tarjetas = [...raiz.querySelectorAll('li.tarjeta')];
    expect(tarjetas).toHaveLength(1);
    expect(tarjetas[0].querySelector('.etiqueta-tipo')?.textContent).toBe('Unido al ítem anterior');
    expect((raiz.querySelector('.aviso-estructura') as HTMLElement).hidden).toBe(true);
    expect(raiz.querySelector('.contador')?.textContent).toBe('1 sugerencia');
  });
});
