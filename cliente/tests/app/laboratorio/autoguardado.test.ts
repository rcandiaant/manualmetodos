import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearApi, ErrorApi, SIN_CONEXION, type Api } from '../../../src/app/api';
import {
  claveBorrador,
  claveConfirmado,
  COPIA_CAMBIADA,
  crearAutoguardado,
  leerBorrador,
  type InfoGuardado,
} from '../../../src/app/laboratorio/autoguardado';
import type { DocJSON } from '../../../src/tipos';
import { doc, parrafo } from '../../ayudantes-doc';

const BASE = doc(parrafo('p1', 'Uno.'), parrafo('p2', 'Dos.'));
const COPIA = doc(parrafo('p1', 'Uno cambiado.'), parrafo('p2', 'Dos.'));
const COPIA2 = doc(parrafo('p1', 'Uno cambiado otra vez.'), parrafo('p2', 'Dos.'));
const CLAVE = 'mm:borrador:12:3:7';

type Put = (ruta: string, cuerpo?: unknown) => Promise<unknown>;

function apiCon(put: Put) {
  const fn = vi.fn(put);
  const api = { put: fn } as unknown as Api;
  return { api, put: fn };
}

const ok = async () => ({ actualizado: '2026-11-03T15:20:00Z' });
const falla = (e: ErrorApi) => async () => {
  throw e;
};

function crear(api: Api, extra: Record<string, unknown> = {}) {
  const estados: InfoGuardado[] = [];
  const ag = crearAutoguardado({
    api,
    capituloId: 3,
    versionId: 7,
    base: BASE,
    autor: 'u12',
    almacen: localStorage,
    ...extra,
  });
  ag.alCambiarEstado((e) => estados.push(e));
  return { ag, estados };
}

/** Deja correr temporizadores y promesas pendientes. */
async function avanzar(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('autoguardado', () => {
  it('autoguardado espera 2 s y envia sugerencias calculadas con autor u<id>', async () => {
    const { api, put } = apiCon(ok);
    const { ag } = crear(api);
    ag.cambio(COPIA);
    expect(ag.estado().estado).toBe('pendiente');
    await avanzar(1999);
    expect(put).not.toHaveBeenCalled();
    await avanzar(1);
    expect(put).toHaveBeenCalledTimes(1);
    const [ruta, cuerpo] = put.mock.calls[0] as [string, { versionId: number; docJson: DocJSON; sugerencias: { id: string; autor: string; bloqueId: string }[] }];
    expect(ruta).toBe('/capitulos/3/copia');
    expect(cuerpo.versionId).toBe(7);
    expect(cuerpo.docJson).toEqual(COPIA);
    expect(cuerpo.sugerencias.length).toBeGreaterThan(0);
    for (const s of cuerpo.sugerencias) {
      expect(s.autor).toBe('u12');
      expect(s.id.startsWith('u12:')).toBe(true);
      expect(s.bloqueId).toBe('p1');
    }
    await avanzar(0);
    expect(ag.estado().estado).toBe('guardado');
    expect(ag.estado().ultimoGuardado).toBeInstanceOf(Date);
    expect(localStorage.getItem(CLAVE)).toBeNull();
  });

  it('cambios seguidos reinician la espera y se envia solo la ultima copia', async () => {
    const { api, put } = apiCon(ok);
    const { ag } = crear(api);
    ag.cambio(COPIA);
    await avanzar(1500);
    ag.cambio(COPIA2);
    await avanzar(1500);
    expect(put).not.toHaveBeenCalled();
    await avanzar(500);
    expect(put).toHaveBeenCalledTimes(1);
    expect((put.mock.calls[0][1] as { docJson: DocJSON }).docJson).toEqual(COPIA2);
  });

  it('autoguardado conserva el borrador ante 401 y fallo de red', async () => {
    const respuestas: Put[] = [
      falla(new ErrorApi(0, SIN_CONEXION, 'Sin conexión')),
      falla(new ErrorApi(0, SIN_CONEXION, 'Sin conexión')),
      falla(new ErrorApi(401, 'sin_sesion', 'Sesión vencida')),
      ok,
    ];
    const { api, put } = apiCon((r, c) => respuestas.shift()!(r, c));
    const { ag, estados } = crear(api);
    ag.cambio(COPIA);
    await avanzar(2000);
    // Fallo de red: borrador local y estado visible.
    expect(ag.estado().estado).toBe('sin-conexion');
    expect(ag.estado().mensaje).toContain('Sin guardar: sin conexión, reintentando');
    const borrador = leerBorrador(localStorage, CLAVE);
    expect(borrador?.docJson).toEqual(COPIA);
    // Reintentos con espera creciente: 2 s y luego 4 s.
    await avanzar(1999);
    expect(put).toHaveBeenCalledTimes(1);
    await avanzar(1);
    expect(put).toHaveBeenCalledTimes(2);
    expect(ag.estado().estado).toBe('sin-conexion');
    await avanzar(3999);
    expect(put).toHaveBeenCalledTimes(2);
    await avanzar(1);
    expect(put).toHaveBeenCalledTimes(3);
    // 401: sesión vencida; el borrador sigue ahí.
    expect(ag.estado().estado).toBe('sesion-vencida');
    expect(ag.estado().mensaje).toContain('Sesión vencida: vuelva a entrar');
    expect(localStorage.getItem(CLAVE)).not.toBeNull();
    // Un cambio mientras tanto también queda en el borrador.
    ag.cambio(COPIA2);
    expect(leerBorrador(localStorage, CLAVE)?.docJson).toEqual(COPIA2);
    // Tras volver a entrar, el reintento guarda solo la última copia.
    await avanzar(8000);
    expect(put).toHaveBeenCalledTimes(4);
    expect((put.mock.calls[3][1] as { docJson: DocJSON }).docJson).toEqual(COPIA2);
    expect(ag.estado().estado).toBe('guardado');
    expect(localStorage.getItem(CLAVE)).toBeNull();
    expect(estados.map((e) => e.estado)).toEqual(
      expect.arrayContaining(['pendiente', 'guardando', 'sin-conexion', 'sesion-vencida', 'guardado']),
    );
  });

  it('la espera entre reintentos crece hasta 60 s', async () => {
    const { api, put } = apiCon(falla(new ErrorApi(0, SIN_CONEXION, 'x')));
    const { ag } = crear(api);
    ag.cambio(COPIA);
    await avanzar(2000); // 1.er intento
    for (const espera of [2000, 4000, 8000, 16000, 32000, 60000, 60000]) {
      const antes = put.mock.calls.length;
      await avanzar(espera - 1);
      expect(put.mock.calls.length).toBe(antes);
      await avanzar(1);
      expect(put.mock.calls.length).toBe(antes + 1);
    }
    await ag.detener();
  });

  it('409 etapa_no_permite deja el estado cerrada sin mas reintentos', async () => {
    const { api, put } = apiCon(falla(new ErrorApi(409, 'etapa_no_permite', 'La consulta cerró.')));
    const { ag } = crear(api);
    ag.cambio(COPIA);
    await avanzar(2000);
    expect(ag.estado().estado).toBe('cerrada');
    await avanzar(120000);
    expect(put).toHaveBeenCalledTimes(1);
    expect(leerBorrador(localStorage, CLAVE)?.docJson).toEqual(COPIA);
    await ag.detener();
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('version_obsoleta muestra error sin reintentar', async () => {
    const { api, put } = apiCon(falla(new ErrorApi(409, 'version_obsoleta', 'La base cambió.')));
    const { ag } = crear(api);
    ag.cambio(COPIA);
    await avanzar(2000);
    expect(ag.estado().estado).toBe('error');
    expect(ag.estado().mensaje).toContain('La base cambió.');
    await avanzar(120000);
    ag.cambio(COPIA2); // tampoco reintenta tras otro cambio: la base ya no es la vigente
    await avanzar(120000);
    expect(put).toHaveBeenCalledTimes(1);
    expect(leerBorrador(localStorage, CLAVE)?.docJson).toEqual(COPIA2);
  });

  it.each([
    [413, 'cuerpo_muy_grande'],
    [422, 'documento_invalido'],
  ])('%i %s muestra error con el mensaje del servidor y no reintenta', async (estado, codigo) => {
    const { api, put } = apiCon(falla(new ErrorApi(estado, codigo, `Mensaje ${codigo}.`)));
    const { ag } = crear(api);
    ag.cambio(COPIA);
    await avanzar(2000);
    expect(ag.estado().estado).toBe('error');
    expect(ag.estado().mensaje).toContain(`Mensaje ${codigo}.`);
    await avanzar(120000);
    expect(put).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CLAVE)).not.toBeNull();
  });

  it('desmontar hace el ultimo guardado', async () => {
    const { api, put } = apiCon(ok);
    const { ag } = crear(api);
    ag.cambio(COPIA);
    await ag.detener();
    expect(put).toHaveBeenCalledTimes(1);
    expect(ag.estado().estado).toBe('guardado');
    ag.cambio(COPIA2); // detenido: se ignora
    await avanzar(5000);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('detener espera el envio en curso y luego manda lo pendiente', async () => {
    let soltar!: () => void;
    const lento = () => new Promise<unknown>((r) => (soltar = () => r({ actualizado: '2026-11-03T15:20:00Z' })));
    const respuestas: Put[] = [lento, ok];
    const { api, put } = apiCon((r, c) => respuestas.shift()!(r, c));
    const { ag } = crear(api);
    ag.cambio(COPIA);
    await avanzar(2000);
    expect(ag.estado().estado).toBe('guardando');
    ag.cambio(COPIA2);
    const fin = ag.detener();
    soltar();
    await fin;
    expect(put).toHaveBeenCalledTimes(2);
    expect((put.mock.calls[1][1] as { docJson: DocJSON }).docJson).toEqual(COPIA2);
    expect(localStorage.getItem(CLAVE)).toBeNull();
  });

  it('con un envio en curso, guardarYa escribe al momento el borrador con lo mas nuevo', async () => {
    let soltar!: () => void;
    const lento = () => new Promise<unknown>((r) => (soltar = () => r({ actualizado: '2026-11-03T15:20:00Z' })));
    const respuestas: Put[] = [lento, ok];
    const { api } = apiCon((r, c) => respuestas.shift()!(r, c));
    const { ag } = crear(api);
    ag.cambio(COPIA);
    await avanzar(2000);
    expect(ag.estado().estado).toBe('guardando');
    ag.cambio(COPIA2);
    void ag.guardarYa(); // p. ej. beforeunload: no hay tiempo de esperar
    expect(leerBorrador(localStorage, CLAVE)?.docJson).toEqual(COPIA2);
    soltar();
    await ag.detener();
  });

  it('un cambio durante el envio tambien va al borrador', async () => {
    let soltar!: () => void;
    const lento = () => new Promise<unknown>((r) => (soltar = () => r({ actualizado: '2026-11-03T15:20:00Z' })));
    const respuestas: Put[] = [lento, ok];
    const { api } = apiCon((r, c) => respuestas.shift()!(r, c));
    const { ag } = crear(api);
    ag.cambio(COPIA);
    await avanzar(2000);
    ag.cambio(COPIA2);
    expect(leerBorrador(localStorage, CLAVE)?.docJson).toEqual(COPIA2);
    soltar();
    await ag.detener();
  });

  it('version_obsoleta lleva el codigo del servidor en el estado', async () => {
    const { api } = apiCon(falla(new ErrorApi(409, 'version_obsoleta', 'La base cambió.')));
    const { ag } = crear(api);
    ag.cambio(COPIA);
    await avanzar(2000);
    expect(ag.estado().codigo).toBe('version_obsoleta');
  });

  it('el borrador lleva la marca del servidor sobre la que se edito', async () => {
    const { api } = apiCon(falla(new ErrorApi(0, SIN_CONEXION, 'x')));
    const { ag } = crear(api, { actualizado: '2026-11-03T10:00:00Z' });
    ag.cambio(COPIA);
    await avanzar(2000);
    const b = leerBorrador(localStorage, claveBorrador(12, 3, 7))!;
    expect(b.actualizadoServidor).toBe('2026-11-03T10:00:00Z');
    expect(typeof b.guardadoLocal).toBe('string');
    await ag.detener();
  });
});

describe('autoguardado con varias pestañas (I1)', () => {
  it('un guardado confirmado no borra el borrador que escribio otra pestaña', async () => {
    let soltar!: () => void;
    const lento = () => new Promise<unknown>((r) => (soltar = () => r({ actualizado: '2026-11-03T15:20:00Z' })));
    const { api } = apiCon(lento);
    const { ag } = crear(api);
    ag.cambio(COPIA);
    await avanzar(2000);
    expect(ag.estado().estado).toBe('guardando');
    // Mientras tanto, otra pestaña escribe su propio borrador en la misma clave.
    const ajeno = JSON.stringify({ docJson: COPIA2, guardadoLocal: 'x', actualizadoServidor: null });
    localStorage.setItem(CLAVE, ajeno);
    soltar();
    await avanzar(0);
    expect(ag.estado().estado).toBe('guardado');
    expect(localStorage.getItem(CLAVE)).toBe(ajeno);
  });

  it('confirmar deja la marca compartida con el actualizado del servidor', async () => {
    const { api } = apiCon(ok);
    const { ag } = crear(api);
    ag.cambio(COPIA);
    await avanzar(2000);
    expect(ag.estado().estado).toBe('guardado');
    expect(claveConfirmado(12, 3, 7)).toBe('mm:confirmado:12:3:7');
    expect(localStorage.getItem('mm:confirmado:12:3:7')).toBe('2026-11-03T15:20:00Z');
  });

  it('si otra pestaña confirmo una copia mas nueva, no se envia: solo lectura y el borrador queda', async () => {
    const { api, put } = apiCon(ok);
    const { ag } = crear(api, { actualizado: '2026-11-03T15:00:00Z' });
    localStorage.setItem('mm:confirmado:12:3:7', '2026-11-03T15:10:00Z');
    ag.cambio(COPIA);
    await avanzar(2000);
    expect(put).not.toHaveBeenCalled();
    expect(ag.estado().estado).toBe('error');
    expect(ag.estado().codigo).toBe(COPIA_CAMBIADA);
    expect(leerBorrador(localStorage, CLAVE)?.docJson).toEqual(COPIA);
    ag.cambio(COPIA2);
    await avanzar(120000);
    expect(put).not.toHaveBeenCalled();
    expect(leerBorrador(localStorage, CLAVE)?.docJson).toEqual(COPIA2);
  });

  it('una marca compartida mas vieja que la propia no detiene el guardado', async () => {
    const { api, put } = apiCon(ok);
    const { ag } = crear(api, { actualizado: '2026-11-03T15:00:00Z' });
    localStorage.setItem('mm:confirmado:12:3:7', '2026-11-02T09:00:00Z');
    ag.cambio(COPIA);
    await avanzar(2000);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('tras un rato sin contacto compara actualizado con GET antes del PUT', async () => {
    const put = vi.fn(ok);
    let delServidor = '2026-11-03T15:00:00Z';
    const get = vi.fn(async () => ({ docJson: COPIA, actualizado: delServidor, versionId: 7, sugerencias: [] }));
    const api = { put, get } as unknown as Api;
    const { ag } = crear(api, { actualizado: '2026-11-03T15:00:00Z', verificarTrasMs: 60_000 });
    // Recién abierto: sin GET.
    ag.cambio(COPIA);
    await avanzar(2000);
    expect(get).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledTimes(1);
    // Una hora después, el GET confirma que nada cambió: se envía.
    delServidor = '2026-11-03T15:20:00Z'; // lo que respondió el PUT
    await avanzar(3_600_000);
    ag.cambio(COPIA2);
    await avanzar(2000);
    expect(get).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(2);
    // Otra hora; ahora otro equipo guardó: no se pisa.
    delServidor = '2026-11-03T17:00:00Z';
    await avanzar(3_600_000);
    ag.cambio(COPIA);
    await avanzar(2000);
    expect(get).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledTimes(2);
    expect(ag.estado().codigo).toBe(COPIA_CAMBIADA);
    expect(leerBorrador(localStorage, CLAVE)?.docJson).toEqual(COPIA);
  });

  it('un PUT que vencio pero el servidor si aplico no se confunde con otra pestaña', async () => {
    // El primer PUT llega al servidor, pero la respuesta se pierde (plazo vencido).
    let servidor: { docJson: DocJSON | null; actualizado?: string } = { docJson: null };
    let n = 0;
    const put = vi.fn(async (_r: string, cuerpo: unknown) => {
      n++;
      servidor = { docJson: (cuerpo as { docJson: DocJSON }).docJson, actualizado: `2026-11-03T15:2${n}:00Z` };
      if (n === 1) {
        await new Promise((r) => setTimeout(r, 90_000)); // el plazo largo de la API
        throw new ErrorApi(0, SIN_CONEXION, 'no respondió a tiempo');
      }
      return { actualizado: servidor.actualizado };
    });
    const get = vi.fn(async () => ({ ...servidor, versionId: 7, sugerencias: [] }));
    const api = { put, get } as unknown as Api;
    const { ag } = crear(api, { verificarTrasMs: 60_000 });
    await avanzar(120_000);
    ag.cambio(COPIA);
    await avanzar(2000 + 90_000); // GET (sin copia) + PUT que vence a los 90 s
    expect(ag.estado().estado).toBe('sin-conexion');
    await avanzar(2000); // reintento: el GET ve su propia copia, no otra
    expect(put).toHaveBeenCalledTimes(2);
    expect(ag.estado().estado).toBe('guardado');
  });

  it('si el GET de verificacion falla por red, se reintenta como sin conexion', async () => {
    const put = vi.fn(ok);
    const get = vi.fn(async () => {
      throw new ErrorApi(0, SIN_CONEXION, 'x');
    });
    const api = { put, get } as unknown as Api;
    const { ag } = crear(api, { verificarTrasMs: 60_000 });
    await avanzar(120_000);
    ag.cambio(COPIA);
    await avanzar(2000);
    expect(ag.estado().estado).toBe('sin-conexion');
    expect(put).not.toHaveBeenCalled();
    await ag.detener();
  });

  it('abandonar detiene sin enviar, calla y devuelve lo no confirmado', async () => {
    const { api, put } = apiCon(ok);
    const { ag, estados } = crear(api);
    ag.cambio(COPIA);
    const n = estados.length;
    const r = ag.abandonar();
    expect(r.copia).toEqual(COPIA);
    expect(r.enBorrador).toBe(true);
    expect(leerBorrador(localStorage, CLAVE)?.docJson).toEqual(COPIA);
    await avanzar(120000);
    expect(put).not.toHaveBeenCalled();
    expect(estados.length).toBe(n);
  });

  it('abandonar no pisa un borrador ajeno', async () => {
    const { api } = apiCon(ok);
    const { ag } = crear(api);
    ag.cambio(COPIA);
    const ajeno = JSON.stringify({ docJson: COPIA2, guardadoLocal: 'x', actualizadoServidor: null });
    localStorage.setItem(CLAVE, ajeno);
    const r = ag.abandonar();
    expect(r.copia).toEqual(COPIA);
    expect(r.enBorrador).toBe(false);
    expect(localStorage.getItem(CLAVE)).toBe(ajeno);
  });
});

describe('autoguardado con la red colgada (I2)', () => {
  it('un PUT sin respuesta pasa a sin conexion a los 90 s y programa el reintento', async () => {
    let n = 0;
    const fetch = vi.fn(async () => {
      n++;
      if (n === 1) return new Promise<Response>(() => {}); // se cuelga
      return new Response(JSON.stringify({ actualizado: '2026-11-03T15:20:00Z' }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const api = crearApi({ fetch, alSinSesion: () => {} });
    api.fijarCsrf('tok');
    const { ag } = crear(api);
    ag.cambio(COPIA);
    await avanzar(2000);
    expect(ag.estado().estado).toBe('guardando');
    await avanzar(89_999);
    expect(ag.estado().estado).toBe('guardando');
    await avanzar(1);
    expect(ag.estado().estado).toBe('sin-conexion');
    expect(ag.estado().mensaje).toContain('Sin guardar: sin conexión, reintentando');
    expect(leerBorrador(localStorage, CLAVE)?.docJson).toEqual(COPIA);
    await avanzar(2000);
    expect(n).toBe(2);
    expect(ag.estado().estado).toBe('guardado');
  });

  it('detener no se queda esperando un PUT colgado mas alla del plazo', async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof globalThis.fetch;
    const api = crearApi({ fetch, alSinSesion: () => {} });
    const { ag } = crear(api);
    ag.cambio(COPIA);
    await avanzar(2000);
    let fin = false;
    void ag.detener().then(() => (fin = true));
    await avanzar(90_000);
    expect(fin).toBe(true);
    expect(leerBorrador(localStorage, CLAVE)?.docJson).toEqual(COPIA);
  });
});
