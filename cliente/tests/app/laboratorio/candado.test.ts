import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirCandado, claveCandado, type Candado } from '../../../src/app/laboratorio/candado';
import { crearLocksFalsos } from './candados-falsos';

const abiertos: Candado[] = [];
async function abrir(...a: Parameters<typeof abrirCandado>): Promise<Candado> {
  const c = await abrirCandado(...a);
  abiertos.push(c);
  return c;
}
const pasar = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  localStorage.clear();
});
afterEach(() => {
  for (const c of abiertos.splice(0)) c.liberar();
  vi.useRealTimers();
  localStorage.clear();
});

describe('candado de escritura por usuario y capitulo', () => {
  it('la clave lleva usuario y capitulo', () => {
    expect(claveCandado(12, 3)).toBe('mm:candado:12:3');
  });

  describe('con navigator.locks', () => {
    it('la segunda pestaña queda sin control y lo toma sola cuando la primera lo suelta', async () => {
      const locks = crearLocksFalsos();
      const a = await abrir('mm:candado:12:3', { locks });
      const b = await abrir('mm:candado:12:3', { locks });
      expect(a.propio()).toBe(true);
      expect(b.propio()).toBe(false);
      const cambios: boolean[] = [];
      b.alCambiar((p) => cambios.push(p));
      a.liberar();
      await pasar();
      expect(b.propio()).toBe(true);
      expect(cambios).toEqual([true]);
    });

    it('tomar el control deja a la otra pestaña sin control (y esta espera para volver)', async () => {
      const locks = crearLocksFalsos();
      const a = await abrir('mm:candado:12:3', { locks });
      const b = await abrir('mm:candado:12:3', { locks });
      const deA: boolean[] = [];
      a.alCambiar((p) => deA.push(p));
      b.tomar();
      await pasar();
      expect(b.propio()).toBe(true);
      expect(a.propio()).toBe(false);
      expect(deA).toEqual([false]);
      // Al cerrar B, A vuelve a tenerlo.
      b.liberar();
      await pasar();
      expect(a.propio()).toBe(true);
      expect(deA).toEqual([false, true]);
    });

    it('otro capitulo u otro usuario no comparten candado', async () => {
      const locks = crearLocksFalsos();
      const a = await abrir(claveCandado(12, 3), { locks });
      const b = await abrir(claveCandado(12, 4), { locks });
      const c = await abrir(claveCandado(13, 3), { locks });
      expect([a.propio(), b.propio(), c.propio()]).toEqual([true, true, true]);
    });

    it('liberar una pestaña sin control no deja pedidos vivos', async () => {
      const locks = crearLocksFalsos();
      const a = await abrir('k', { locks });
      const b = await abrir('k', { locks });
      b.liberar();
      a.liberar();
      await pasar();
      const c = await abrir('k', { locks });
      expect(c.propio()).toBe(true);
    });
  });

  describe('sin navigator.locks (localStorage con latido)', () => {
    it('la segunda pestaña queda sin control y lo toma cuando la primera lo suelta', async () => {
      const a = await abrir('mm:candado:12:3', { locks: null, almacen: localStorage, latidoMs: 1000 });
      const b = await abrir('mm:candado:12:3', { locks: null, almacen: localStorage, latidoMs: 1000 });
      expect(a.propio()).toBe(true);
      expect(b.propio()).toBe(false);
      await vi.advanceTimersByTimeAsync(5000); // el latido de A lo mantiene
      expect(b.propio()).toBe(false);
      a.liberar();
      await vi.advanceTimersByTimeAsync(1000);
      expect(b.propio()).toBe(true);
    });

    it('una pestaña que se cerró sin soltar (latido viejo) deja de bloquear', async () => {
      localStorage.setItem('k', JSON.stringify({ pestana: 'otra', latido: Date.now() - 60_000 }));
      const a = await abrir('k', { locks: null, almacen: localStorage, latidoMs: 1000 });
      expect(a.propio()).toBe(true);
    });

    it('tomar el control deja a la otra sin control en el siguiente latido', async () => {
      const a = await abrir('k', { locks: null, almacen: localStorage, latidoMs: 1000 });
      const b = await abrir('k', { locks: null, almacen: localStorage, latidoMs: 1000 });
      const deA: boolean[] = [];
      a.alCambiar((p) => deA.push(p));
      b.tomar();
      expect(b.propio()).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(a.propio()).toBe(false);
      expect(deA).toEqual([false]);
    });
  });

  it('sin locks ni almacen siempre hay control', async () => {
    const a = await abrir('k', { locks: null });
    const b = await abrir('k', { locks: null });
    expect(a.propio() && b.propio()).toBe(true);
  });
});
