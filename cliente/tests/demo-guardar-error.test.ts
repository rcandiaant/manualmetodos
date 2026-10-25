import { afterEach, describe, expect, it, vi } from 'vitest';
import { estadoVacio, type ContextoModo, type Modo } from '../src/demo/almacen';
import { montarLaboratorio } from '../src/demo/laboratorio';
import { doc, parrafo } from './ayudantes-doc';

/** R5: si guardarCopia lanza, el laboratorio muestra la caja de error en vez de una excepción sin manejar. */

vi.mock('../src/demo/almacen', async (original) => ({
  ...(await original<typeof import('../src/demo/almacen')>()),
  guardarCopia: vi.fn(() => {
    throw new Error('fallo simulado');
  }),
}));

const montados: Modo[] = [];
afterEach(() => {
  for (const m of montados.splice(0)) m.destruir({ descartar: true });
});

describe('demo laboratorio: error al guardar', () => {
  it('muestra el error visible y no marca la copia como guardada', () => {
    const estado = estadoVacio();
    estado.base = doc(parrafo('p1', 'Uno.'));
    const guardar = vi.fn(() => true);
    const ctx: ContextoModo = { estado, guardar };
    const raiz = document.createElement('div');
    montados.push(montarLaboratorio(raiz, ctx, 'labA'));
    const boton = [...raiz.querySelectorAll('button')].find((b) => b.textContent === 'Guardar copia')!;

    const errores: unknown[] = [];
    const alError = (ev: ErrorEvent) => {
      errores.push(ev.error);
      ev.preventDefault();
    };
    window.addEventListener('error', alError);
    try {
      boton.click();
    } finally {
      window.removeEventListener('error', alError);
    }

    expect(errores).toEqual([]);
    const caja = raiz.querySelector('.error') as HTMLElement;
    expect(caja.hidden).toBe(false);
    expect(caja.textContent).toContain('no se pudo guardar la copia: fallo simulado');
    expect(guardar).not.toHaveBeenCalled();
    expect(raiz.querySelector('.estado-guardado')?.textContent).not.toBe('Copia guardada');
  });
});
