import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearApi } from '../../src/app/api';
import {
  claveAutor,
  conCompuerta,
  entrar,
  iniciar,
  manejarSinSesion,
  salir,
  tomarRutaPendiente,
  tieneRol,
  usuarioActual,
  vistaLogin,
} from '../../src/app/sesion';
import type { Usuario } from '../../src/app/tipos-api';
import { ANA, error, fetchSimulado, json } from './ayudas';

const USUARIO: Usuario = { ...ANA, roles: ['laboratorio'] };

afterEach(async () => {
  // Deja el módulo sin sesión entre pruebas.
  const { fetch } = fetchSimulado(new Response(null, { status: 204 }));
  await salir(crearApi({ fetch, alSinSesion: () => {} }));
  history.replaceState(null, '', '#');
});

function montarLogin(respuestas: Response[], navegar = vi.fn()) {
  const sim = fetchSimulado(...respuestas);
  const api = crearApi({ fetch: sim.fetch, alSinSesion: () => {} });
  const raiz = document.createElement('div');
  document.body.append(raiz);
  const vista = vistaLogin(api, { navegar });
  vista.montar(raiz);
  const campo = (n: string) => raiz.querySelector<HTMLInputElement>(`input[name="${n}"]`)!;
  const enviar = (correo: string, clave: string) => {
    campo('correo').value = correo;
    campo('clave').value = clave;
    raiz.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  };
  const alerta = () => raiz.querySelector('[role="alert"]:not([hidden])');
  return { api, raiz, vista, campo, enviar, alerta, navegar, ...sim };
}

describe('sesion', () => {
  it('login exitoso guarda usuario y csrf y navega a inicio', async () => {
    const t = montarLogin([json(200, { usuario: USUARIO, csrf: 'tok-9' })]);
    t.enviar('ana@lab.cl', 'secreta');
    await vi.waitFor(() => expect(t.navegar).toHaveBeenCalledWith('#/capitulos'));
    expect(usuarioActual()).toEqual(USUARIO);
    expect(t.api.csrfActual()).toBe('tok-9');
    expect(t.llamadas[0].url).toBe('/api/sesion');
    expect(t.llamadas[0].init.method).toBe('POST');
    expect(JSON.parse(String(t.llamadas[0].init.body))).toEqual({
      correo: 'ana@lab.cl',
      clave: 'secreta',
      sitio_web: '',
    });
  });

  it('login fallido muestra mensaje generico', async () => {
    const t = montarLogin([error(401, 'credenciales_invalidas')]);
    t.enviar('ana@lab.cl', 'mala');
    await vi.waitFor(() => expect(t.alerta()).not.toBeNull());
    expect(t.alerta()!.textContent).toContain('Correo o clave incorrectos');
    expect(t.alerta()!.textContent).not.toContain('Texto del servidor');
    expect(t.navegar).not.toHaveBeenCalled();
    expect(usuarioActual()).toBeNull();
    // Sin recuperación de clave: se indica contactar al administrador.
    expect(t.raiz.textContent).toMatch(/administrador/i);
  });

  it('429 muestra espera en minutos', async () => {
    const t = montarLogin([error(429, 'demasiados_intentos', { 'Retry-After': '300' })]);
    t.enviar('ana@lab.cl', 'x');
    await vi.waitFor(() => expect(t.alerta()).not.toBeNull());
    expect(t.alerta()!.textContent).toContain('5 minutos');
  });

  it('429 con menos de un minuto muestra segundos', async () => {
    const t = montarLogin([error(429, 'demasiados_intentos', { 'Retry-After': '45' })]);
    t.enviar('ana@lab.cl', 'x');
    await vi.waitFor(() => expect(t.alerta()).not.toBeNull());
    expect(t.alerta()!.textContent).toContain('45 segundos');
  });

  it('sin conexion muestra mensaje amable', async () => {
    const t = montarLogin([]);
    t.enviar('ana@lab.cl', 'x');
    await vi.waitFor(() => expect(t.alerta()).not.toBeNull());
    expect(t.alerta()!.textContent).toContain('conexión');
  });

  it('honeypot existe y viaja vacio', async () => {
    const t = montarLogin([json(200, { usuario: USUARIO, csrf: 't' })]);
    const trampa = t.campo('sitio_web');
    expect(trampa).not.toBeNull();
    expect(trampa.type).not.toBe('hidden');
    expect(trampa.getAttribute('tabindex')).toBe('-1');
    expect(trampa.getAttribute('autocomplete')).toBe('off');
    // Oculto con CSS (clase), no con type=hidden.
    expect(trampa.closest('.trampa')).not.toBeNull();
    t.enviar('ana@lab.cl', 'secreta');
    await vi.waitFor(() => expect(t.llamadas).toHaveLength(1));
    expect(JSON.parse(String(t.llamadas[0].init.body)).sitio_web).toBe('');
  });

  it('recarga recupera la sesion con GET /sesion', async () => {
    const { fetch, llamadas } = fetchSimulado(json(200, { usuario: USUARIO, csrf: 'tok-r' }));
    const api = crearApi({ fetch, alSinSesion: () => {} });
    expect(await iniciar(api)).toEqual(USUARIO);
    expect(llamadas[0].url).toBe('/api/sesion');
    expect(llamadas[0].init.method).toBe('GET');
    expect(usuarioActual()).toEqual(USUARIO);
    expect(api.csrfActual()).toBe('tok-r');
  });

  it('recarga sin sesion devuelve null', async () => {
    const { fetch } = fetchSimulado(error(401, 'sin_sesion'));
    const api = crearApi({ fetch, alSinSesion: () => {} });
    expect(await iniciar(api)).toBeNull();
    expect(usuarioActual()).toBeNull();
  });

  it('salir cierra la sesion aunque el servidor ya la diera por vencida', async () => {
    const { fetch } = fetchSimulado(json(200, { usuario: USUARIO, csrf: 't' }), error(401, 'sin_sesion'));
    const api = crearApi({ fetch, alSinSesion: () => {} });
    await entrar(api, 'a@b.cl', 'x');
    await salir(api);
    expect(usuarioActual()).toBeNull();
    expect(api.csrfActual()).toBeNull();
  });

  it('401 en cualquier vista vuelve al login conservando la ruta pedida', async () => {
    const { fetch } = fetchSimulado(json(200, { usuario: USUARIO, csrf: 't' }));
    const api = crearApi({ fetch, alSinSesion: () => {} });
    await entrar(api, 'a@b.cl', 'x');
    history.replaceState(null, '', '#/capitulo/3');
    const navegar = vi.fn();
    manejarSinSesion(navegar)();
    expect(navegar).toHaveBeenCalledWith('#/entrar');
    expect(usuarioActual()).toBeNull();

    // Un segundo 401 estando ya en el login no pisa la ruta recordada.
    history.replaceState(null, '', '#/entrar');
    manejarSinSesion(navegar)();

    const t = montarLogin([json(200, { usuario: USUARIO, csrf: 'nuevo' })]);
    t.enviar('ana@lab.cl', 'secreta');
    await vi.waitFor(() => expect(t.navegar).toHaveBeenCalledWith('#/capitulo/3'));
  });

  it('la ruta pendiente de una sesion vencida no pasa a otra persona que entra en el mismo equipo', async () => {
    const { fetch } = fetchSimulado(json(200, { usuario: USUARIO, csrf: 't' }));
    const api = crearApi({ fetch, alSinSesion: () => {} });
    await entrar(api, 'a@b.cl', 'x');
    history.replaceState(null, '', '#/capitulo/3');
    manejarSinSesion(vi.fn())();
    const otra: Usuario = { id: 13, nombre: 'Berta', laboratorio: 'Lab Sur', roles: ['laboratorio'] };
    const t = montarLogin([json(200, { usuario: otra, csrf: 'nuevo' })]);
    t.enviar('berta@lab.cl', 'secreta');
    await vi.waitFor(() => expect(t.navegar).toHaveBeenCalledWith('#/capitulos'));
    expect(t.navegar).not.toHaveBeenCalledWith('#/capitulo/3');
  });

  it('sin sesion previa (enlace directo), la ruta pedida vale para quien entre', async () => {
    history.replaceState(null, '', '#/capitulo/5');
    manejarSinSesion(vi.fn())();
    const t = montarLogin([json(200, { usuario: USUARIO, csrf: 'nuevo' })]);
    t.enviar('ana@lab.cl', 'secreta');
    await vi.waitFor(() => expect(t.navegar).toHaveBeenCalledWith('#/capitulo/5'));
  });

  it('claveAutor y tieneRol', () => {
    expect(claveAutor(USUARIO)).toBe('u12');
    expect(tieneRol(USUARIO, 'laboratorio')).toBe(true);
    expect(tieneRol(USUARIO, 'admin')).toBe(false);
  });
});

describe('sesion: ajustes de la ronda 1', () => {
  it('login fallido vacia el campo de clave', async () => {
    const t = montarLogin([error(401, 'credenciales_invalidas')]);
    t.enviar('ana@lab.cl', 'mala');
    await vi.waitFor(() => expect(t.alerta()).not.toBeNull());
    expect(t.campo('clave').value).toBe('');
    expect(t.campo('correo').value).toBe('ana@lab.cl');
  });

  it('la compuerta no navega hasta abrirse (401 del arranque)', () => {
    const alSinSesion = vi.fn();
    const c = conCompuerta(alSinSesion);
    c.handler();
    expect(alSinSesion).not.toHaveBeenCalled();
    c.abrir();
    c.handler();
    expect(alSinSesion).toHaveBeenCalledTimes(1);
  });

  it('salir limpia la ruta pendiente aunque el servidor responda 401', async () => {
    history.replaceState(null, '', '#/capitulos');
    manejarSinSesion(vi.fn())();
    const { fetch } = fetchSimulado(error(401, 'sin_sesion'));
    await salir(crearApi({ fetch, alSinSesion: () => {} }));
    expect(tomarRutaPendiente()).toBeNull();
  });

  it('vistaLogin con sesion activa redirige a inicio', async () => {
    const { fetch } = fetchSimulado(json(200, { usuario: USUARIO, csrf: 't' }));
    const api = crearApi({ fetch, alSinSesion: () => {} });
    await entrar(api, 'a@b.cl', 'x');
    const navegar = vi.fn();
    const raiz = document.createElement('div');
    vistaLogin(api, { navegar }).montar(raiz);
    expect(navegar).toHaveBeenCalledWith('#/capitulos');
    expect(raiz.querySelector('form')).toBeNull();
  });

  it('429 de proxy sin JSON conserva la espera de Retry-After', async () => {
    const t = montarLogin([new Response('<html>429</html>', { status: 429, headers: { 'Retry-After': '120' } })]);
    t.enviar('ana@lab.cl', 'x');
    await vi.waitFor(() => expect(t.alerta()).not.toBeNull());
    expect(t.alerta()!.textContent).toContain('2 minutos');
  });
});
