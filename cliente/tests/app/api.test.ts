import { describe, expect, it, vi } from 'vitest';
import { crearApi, ErrorApi } from '../../src/app/api';

/** Cliente HTTP del contrato (docs/api.md §1–2) con `fetch` simulado. */

interface Llamada {
  url: string;
  init: RequestInit;
}

type Respuesta = Response | (() => Response);

function json(estado: number, cuerpo: unknown, cabeceras: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json', ...cabeceras },
  });
}

const error = (estado: number, codigo: string, mensaje = 'Texto.'): Response =>
  json(estado, { error: { codigo, mensaje } });

/** `fetch` que entrega las respuestas en orden y registra cada llamada. */
function fetchSimulado(...respuestas: Respuesta[]) {
  const llamadas: Llamada[] = [];
  const fn = vi.fn(async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
    llamadas.push({ url: String(entrada), init });
    const r = respuestas.shift();
    if (!r) throw new Error(`llamada inesperada a ${String(entrada)}`);
    return typeof r === 'function' ? r() : r;
  });
  return { fetch: fn as unknown as typeof fetch, llamadas };
}

const cabecera = (l: Llamada, nombre: string): string | null => new Headers(l.init.headers).get(nombre);

describe('api', () => {
  it('api agrega Content-Type, credentials y X-CSRF-Token en escrituras', async () => {
    const { fetch, llamadas } = fetchSimulado(
      json(200, { actualizado: '2026-11-03T15:20:00Z' }),
      json(200, { id: 'u12:a', motivo: null }),
      json(201, { id: 5 }),
      new Response(null, { status: 204 }),
    );
    const api = crearApi({ fetch, alSinSesion: () => {} });
    api.fijarCsrf('tok-1');

    const r = await api.put<{ actualizado: string }>('/capitulos/3/copia', { versionId: 7 });
    expect(r).toEqual({ actualizado: '2026-11-03T15:20:00Z' });
    await api.patch('/capitulos/3/sugerencias/u12:a', { motivo: '' });
    await api.post('/capitulos/3/comentarios', { texto: 'x' });
    expect(await api.del('/comentarios/5')).toBeUndefined();

    expect(llamadas.map((l) => [l.init.method, l.url])).toEqual([
      ['PUT', '/api/capitulos/3/copia'],
      ['PATCH', '/api/capitulos/3/sugerencias/u12:a'],
      ['POST', '/api/capitulos/3/comentarios'],
      ['DELETE', '/api/comentarios/5'],
    ]);
    for (const l of llamadas) {
      expect(l.init.credentials).toBe('same-origin');
      expect(cabecera(l, 'X-CSRF-Token')).toBe('tok-1');
    }
    // Content-Type solo donde hay cuerpo.
    expect(llamadas.slice(0, 3).map((l) => cabecera(l, 'Content-Type'))).toEqual([
      'application/json',
      'application/json',
      'application/json',
    ]);
    expect(JSON.parse(String(llamadas[0].init.body))).toEqual({ versionId: 7 });
    expect(llamadas[3].init.body).toBeUndefined();
    expect(cabecera(llamadas[3], 'Content-Type')).toBeNull();
    expect(api.csrfActual()).toBe('tok-1');
  });

  it('api no manda X-CSRF-Token en GET', async () => {
    const { fetch, llamadas } = fetchSimulado(json(200, [{ id: 3 }]));
    const api = crearApi({ fetch, alSinSesion: () => {} });
    api.fijarCsrf('tok-1');

    expect(await api.get('/capitulos')).toEqual([{ id: 3 }]);
    expect(llamadas[0].url).toBe('/api/capitulos');
    expect(llamadas[0].init.method).toBe('GET');
    expect(llamadas[0].init.credentials).toBe('same-origin');
    expect(cabecera(llamadas[0], 'X-CSRF-Token')).toBeNull();
    expect(cabecera(llamadas[0], 'Content-Type')).toBeNull();
    expect(llamadas[0].init.body).toBeUndefined();
  });

  it('csrf invalido se reintenta una vez', async () => {
    const usuario = { id: 12, nombre: 'Ana', laboratorio: 'Lab Norte', roles: ['laboratorio'] };
    const { fetch, llamadas } = fetchSimulado(
      error(403, 'csrf_invalido'),
      json(200, { usuario, csrf: 'tok-nuevo' }),
      json(201, { id: 5 }),
    );
    const api = crearApi({ fetch, alSinSesion: () => {} });
    api.fijarCsrf('tok-viejo');

    expect(await api.post('/capitulos/3/comentarios', { texto: 'x' })).toEqual({ id: 5 });
    expect(llamadas.map((l) => [l.init.method, l.url])).toEqual([
      ['POST', '/api/capitulos/3/comentarios'],
      ['GET', '/api/sesion'],
      ['POST', '/api/capitulos/3/comentarios'],
    ]);
    expect(cabecera(llamadas[0], 'X-CSRF-Token')).toBe('tok-viejo');
    expect(cabecera(llamadas[2], 'X-CSRF-Token')).toBe('tok-nuevo');
    expect(llamadas[2].init.body).toBe(llamadas[0].init.body);
    expect(api.csrfActual()).toBe('tok-nuevo');

    // Un segundo 403 csrf_invalido tras recargar el token lanza ErrorApi (sin más reintentos).
    const otro = fetchSimulado(
      error(403, 'csrf_invalido'),
      json(200, { usuario, csrf: 'tok-2' }),
      error(403, 'csrf_invalido'),
    );
    const api2 = crearApi({ fetch: otro.fetch, alSinSesion: () => {} });
    const e = await api2.put('/capitulos/3/copia', {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorApi);
    expect((e as ErrorApi).estado).toBe(403);
    expect((e as ErrorApi).codigo).toBe('csrf_invalido');
    expect(otro.llamadas).toHaveLength(3);
  });

  it('sin_permiso no se reintenta', async () => {
    const { fetch, llamadas } = fetchSimulado(error(403, 'sin_permiso', 'No tiene permiso.'));
    const api = crearApi({ fetch, alSinSesion: () => {} });
    api.fijarCsrf('tok');

    const e = await api.patch('/sugerencias/9', { estado: 'aceptada' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorApi);
    expect(e).toMatchObject({ estado: 403, codigo: 'sin_permiso', message: 'No tiene permiso.' });
    expect(llamadas).toHaveLength(1);
  });

  it('401 llama alSinSesion', async () => {
    const alSinSesion = vi.fn();
    const { fetch } = fetchSimulado(error(401, 'sin_sesion'), error(401, 'credenciales_invalidas'));
    const api = crearApi({ fetch, alSinSesion });

    const e = await api.get('/capitulos').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorApi);
    expect(e).toMatchObject({ estado: 401, codigo: 'sin_sesion' });
    expect(alSinSesion).toHaveBeenCalledTimes(1);

    // Un login fallido no es una sesión vencida.
    const e2 = await api.post('/sesion', { correo: 'a', clave: 'b', sitio_web: '' }).catch((x: unknown) => x);
    expect(e2).toMatchObject({ estado: 401, codigo: 'credenciales_invalidas' });
    expect(alSinSesion).toHaveBeenCalledTimes(1);
  });

  it('304 con etag devuelve noModificado', async () => {
    const { fetch, llamadas } = fetchSimulado(new Response(null, { status: 304 }));
    const api = crearApi({ fetch, alSinSesion: () => {} });

    expect(await api.get('/capitulos/3/base', { etag: '"v7"' })).toEqual({ noModificado: true });
    expect(cabecera(llamadas[0], 'If-None-Match')).toBe('"v7"');
  });

  it('error sin cuerpo JSON da ErrorApi con codigo error_interno', async () => {
    const { fetch } = fetchSimulado(
      new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
      new Response(null, { status: 500 }),
    );
    const api = crearApi({ fetch, alSinSesion: () => {} });

    const e = await api.get('/capitulos').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorApi);
    expect(e).toMatchObject({ estado: 502, codigo: 'error_interno' });
    expect((e as ErrorApi).message).not.toBe('');
    const e2 = await api.get('/capitulos').catch((x: unknown) => x);
    expect(e2).toMatchObject({ estado: 500, codigo: 'error_interno' });
  });

  it('login POST /sesion no manda X-CSRF-Token aunque haya uno viejo en memoria', async () => {
    const usuario = { id: 12, nombre: 'Ana', laboratorio: 'Lab Norte', roles: ['laboratorio'] };
    const { fetch, llamadas } = fetchSimulado(json(200, { usuario, csrf: 'tok-nuevo' }), new Response(null, { status: 204 }));
    const api = crearApi({ fetch, alSinSesion: () => {} });
    api.fijarCsrf('tok-viejo');

    await api.post('/sesion', { correo: 'a@b.cl', clave: 'x', sitio_web: '' });
    expect(cabecera(llamadas[0], 'X-CSRF-Token')).toBeNull();
    expect(cabecera(llamadas[0], 'Content-Type')).toBe('application/json');
    // El logout (DELETE /sesion) sí lo lleva.
    await api.del('/sesion');
    expect(cabecera(llamadas[1], 'X-CSRF-Token')).toBe('tok-viejo');
  });

  it('login con 403 csrf_invalido no se reintenta', async () => {
    const { fetch, llamadas } = fetchSimulado(error(403, 'csrf_invalido'));
    const api = crearApi({ fetch, alSinSesion: () => {} });
    const e = await api.post('/sesion', { correo: 'a', clave: 'b', sitio_web: '' }).catch((x: unknown) => x);
    expect(e).toMatchObject({ estado: 403, codigo: 'csrf_invalido' });
    expect(llamadas).toHaveLength(1);
  });

  it('401 al recargar el token durante el reintento llama alSinSesion una vez y no reintenta', async () => {
    const alSinSesion = vi.fn();
    const { fetch, llamadas } = fetchSimulado(error(403, 'csrf_invalido'), error(401, 'sin_sesion'));
    const api = crearApi({ fetch, alSinSesion });
    api.fijarCsrf('tok');

    const e = await api.put('/capitulos/3/copia', {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorApi);
    expect(e).toMatchObject({ estado: 401, codigo: 'sin_sesion' });
    expect(alSinSesion).toHaveBeenCalledTimes(1);
    expect(llamadas.map((l) => [l.init.method, l.url])).toEqual([
      ['PUT', '/api/capitulos/3/copia'],
      ['GET', '/api/sesion'],
    ]);
  });

  it('fallo de red da ErrorApi sin_conexion con estado 0', async () => {
    const { fetch } = fetchSimulado(() => {
      throw new TypeError('Failed to fetch');
    });
    const api = crearApi({ fetch, alSinSesion: () => {} });
    api.fijarCsrf('tok');

    const e = await api.put('/capitulos/3/copia', {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorApi);
    expect(e).toMatchObject({ estado: 0, codigo: 'sin_conexion' });
    expect((e as ErrorApi).message).toMatch(/conexi[oó]n/i);
  });

  it('304 sin etag pedido es un ErrorApi', async () => {
    const { fetch } = fetchSimulado(new Response(null, { status: 304 }));
    const api = crearApi({ fetch, alSinSesion: () => {} });
    const e = await api.get('/capitulos').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorApi);
    expect(e).toMatchObject({ estado: 304, codigo: 'error_interno' });
  });

  it('error 400 conserva campos', async () => {
    const { fetch } = fetchSimulado(
      json(400, { error: { codigo: 'entrada_invalida', mensaje: 'Mal.', campos: { correo: 'Obligatorio.' } } }),
    );
    const api = crearApi({ fetch, alSinSesion: () => {} });
    const e = await api.post('/sesion', {}).catch((x: unknown) => x);
    expect(e).toMatchObject({ estado: 400, codigo: 'entrada_invalida', campos: { correo: 'Obligatorio.' } });
  });
});

describe('api: tiempo limite (I2)', () => {
  const colgado = () => {
    const señales: (AbortSignal | undefined)[] = [];
    const fn = vi.fn((_e: RequestInfo | URL, init: RequestInit = {}) => {
      señales.push(init.signal ?? undefined);
      return new Promise<Response>(() => {}); // nunca responde (ni atiende la señal)
    });
    return { fetch: fn as unknown as typeof fetch, señales };
  };

  it('una peticion colgada termina en sin_conexion a los 30 s y aborta el fetch', async () => {
    vi.useFakeTimers();
    try {
      const { fetch, señales } = colgado();
      const api = crearApi({ fetch, alSinSesion: () => {} });
      let fin: unknown = 'pendiente';
      void api.get('/capitulos').then(
        (r) => (fin = r),
        (e: unknown) => (fin = e),
      );
      await vi.advanceTimersByTimeAsync(29_999);
      expect(fin).toBe('pendiente');
      await vi.advanceTimersByTimeAsync(1);
      expect(fin).toBeInstanceOf(ErrorApi);
      expect(fin).toMatchObject({ estado: 0, codigo: 'sin_conexion' });
      expect(señales[0]?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('el PUT de la copia tiene 90 s', async () => {
    vi.useFakeTimers();
    try {
      const { fetch } = colgado();
      const api = crearApi({ fetch, alSinSesion: () => {} });
      api.fijarCsrf('tok');
      let fin: unknown = 'pendiente';
      void api.put('/capitulos/3/copia', { docJson: {} }).catch((e: unknown) => (fin = e));
      await vi.advanceTimersByTimeAsync(89_999);
      expect(fin).toBe('pendiente');
      await vi.advanceTimersByTimeAsync(1);
      expect(fin).toMatchObject({ estado: 0, codigo: 'sin_conexion' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('un cuerpo grande tambien tiene 90 s', async () => {
    vi.useFakeTimers();
    try {
      const { fetch } = colgado();
      const api = crearApi({ fetch, alSinSesion: () => {} });
      api.fijarCsrf('tok');
      let fin: unknown = 'pendiente';
      void api.post('/admin/capitulos', { tex: 'x'.repeat(200_000) }).catch((e: unknown) => (fin = e));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fin).toBe('pendiente');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fin).toMatchObject({ codigo: 'sin_conexion' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('una respuesta a tiempo no deja temporizadores vivos', async () => {
    vi.useFakeTimers();
    try {
      const { fetch } = fetchSimulado(json(200, { ok: 1 }));
      const api = crearApi({ fetch, alSinSesion: () => {} });
      expect(await api.get('/capitulos')).toEqual({ ok: 1 });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
