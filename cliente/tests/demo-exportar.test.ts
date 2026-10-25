import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Node } from '@tiptap/pm/model';
import { esquemaManual } from '../src/esquema/esquema';
import { estadoVacio, type ContextoModo, type Modo } from '../src/demo/almacen';
import { montarRevisor } from '../src/demo/revisor';
import type { DocJSON } from '../src/tipos';
import { doc, item, lista, parrafo, ref } from './ayudantes-doc';

/** Demo (jsdom): aviso en la página antes de exportar si hay caracteres no soportados o referencias colgantes. */

const normalizar = (d: DocJSON): DocJSON => Node.fromJSON(esquemaManual, d).toJSON() as DocJSON;

const montados: Modo[] = [];
let descargas: string[];

beforeEach(() => {
  descargas = [];
  URL.createObjectURL = vi.fn(() => 'blob:prueba');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    descargas.push(this.download);
  });
});
afterEach(() => {
  for (const m of montados.splice(0)) m.destruir({ descartar: true });
  vi.restoreAllMocks();
});

function montar(base: DocJSON, copiaLabA?: DocJSON): HTMLElement {
  const estado = estadoVacio();
  estado.base = normalizar(base);
  if (copiaLabA) estado.copias.labA = normalizar(copiaLabA);
  estado.archivo = 'cap.tex';
  const ctx: ContextoModo = { estado, guardar: () => true };
  const raiz = document.createElement('div');
  document.body.append(raiz);
  montados.push(montarRevisor(raiz, ctx));
  return raiz;
}

const botonCon = (raiz: HTMLElement, texto: string) =>
  [...raiz.querySelectorAll('button')].find((b) => b.textContent === texto) as HTMLButtonElement | undefined;

describe('demo revisor: exportación segura', () => {
  it('sin problemas exporta directo y no muestra aviso', () => {
    const raiz = montar(doc(parrafo('p1', 'Calentar a 20°C ± 1, ≤ 5 µm.'), lista(item('itm:x:a', parrafo('i1', 'Paso.')))));
    botonCon(raiz, 'Exportar .tex final')!.click();
    expect(descargas).toEqual(['cap-revisado.tex']);
    expect((raiz.querySelector('.aviso-exportar') as HTMLElement).hidden).toBe(true);
  });

  it('con caracteres no soportados o referencias colgantes avisa en la página y no exporta', () => {
    const confirmar = vi.spyOn(window, 'confirm');
    const raiz = montar(doc(parrafo('p1', 'Sonrisa ☺ y ver ', ref('itm:x:z'), '.')));
    botonCon(raiz, 'Exportar .tex final')!.click();
    expect(descargas).toEqual([]);
    expect(confirmar).not.toHaveBeenCalled();
    const aviso = raiz.querySelector('.aviso-exportar') as HTMLElement;
    expect(aviso.hidden).toBe(false);
    expect(aviso.textContent).toContain('☺');
    expect(aviso.textContent).toContain('p1');
    expect(aviso.textContent).toContain('itm:x:z');

    botonCon(raiz, 'Exportar de todos modos')!.click();
    expect(descargas).toEqual(['cap-revisado.tex']);
    expect(aviso.hidden).toBe(true);
  });

  it('cambiar una decisión oculta el aviso: hay que volver a revisar antes de exportar', () => {
    const raiz = montar(doc(parrafo('p1', 'Sonrisa ☺ uno.')), doc(parrafo('p1', 'Sonrisa ☺ dos ∑.')));
    botonCon(raiz, 'Exportar .tex final')!.click();
    const aviso = raiz.querySelector('.aviso-exportar') as HTMLElement;
    expect(aviso.hidden).toBe(false);
    expect(aviso.textContent).not.toContain('∑');

    (raiz.querySelector('li.tarjeta button.aceptar') as HTMLButtonElement).click();
    expect(aviso.hidden).toBe(true);
    expect(descargas).toEqual([]);

    // La nueva revisión incluye lo recién aceptado.
    botonCon(raiz, 'Exportar .tex final')!.click();
    expect(aviso.hidden).toBe(false);
    expect(aviso.textContent).toContain('∑');
  });
});
