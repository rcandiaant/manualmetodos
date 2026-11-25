import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearApi } from '../../src/app/api';
import { mensajeCambioClave, problemaClaveNueva, vistaCambiarClave } from '../../src/app/cambiar-clave';
import { ErrorApi } from '../../src/app/api';
import { entrar, manejarSinSesion, salir, usuarioActual } from '../../src/app/sesion';
import type { Usuario } from '../../src/app/tipos-api';
import { ANA, error, fetchSimulado, json } from './ayudas';

const PROVISORIA: Usuario = { ...ANA, roles: ['laboratorio'], debeCambiarClave: true };
const PROPIA: Usuario = { ...ANA, roles: ['laboratorio'], debeCambiarClave: false };

afterEach(async () => {
  const { fetch } = fetchSimulado(new Response(null, { status: 204 }));
  await salir(crearApi({ fetch, alSinSesion: () => {} }));
  history.replaceState(null, '', '#');
  document.body.replaceChildren();
});

/** Entra como `u` y monta la vista; las respuestas siguientes son las del cambio de clave. */
async function montar(u: Usuario, respuestas: Response[] = []) {
  const sim = fetchSimulado(json(200, { usuario: u, csrf: 'tok-1' }), ...respuestas);
  const api = crearApi({ fetch: sim.fetch, alSinSesion: () => {} });
  await entrar(api, 'ana@lab.cl', 'Provisoria123456');
  const navegar = vi.fn();
  const salirDep = vi.fn(async () => {});
  const raiz = document.createElement('div');
  document.body.append(raiz);
  const vista = vistaCambiarClave(api, { navegar, salir: salirDep });
  vista.montar(raiz);
  const campo = (n: string) => raiz.querySelector<HTMLInputElement>(`input[name="${n}"]`)!;
  const enviar = (actual: string, nueva: string, repetida = nueva) => {
    campo('actual').value = actual;
    campo('nueva').value = nueva;
    campo('repetida').value = repetida;
    raiz.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  };
  const alerta = () => raiz.querySelector('[role="alert"]:not([hidden])');
  const boton = (texto: string) => [...raiz.querySelectorAll('button')].find((b) => b.textContent === texto);
  return { api, raiz, vista, campo, enviar, alerta, boton, navegar, salir: salirDep, ...sim };
}

describe('cambiar clave: validación local', () => {
  it('pide largo mínimo, sin espacios al borde, distinta de la actual y repetida igual', () => {
    expect(problemaClaveNueva('vieja', 'corta', 'corta')).toMatch(/al menos 10/);
    expect(problemaClaveNueva('vieja', ' con espacio ', ' con espacio ')).toMatch(/espacios/);
    expect(problemaClaveNueva('Misma-clave-1', 'Misma-clave-1', 'Misma-clave-1')).toMatch(/distinta/);
    expect(problemaClaveNueva('vieja', 'Una clave buena', 'Una clave mala')).toMatch(/no coinciden/);
    expect(problemaClaveNueva('vieja', 'Una clave buena', 'Una clave buena')).toBeNull();
    // Cuenta caracteres, no bytes ni unidades UTF-16.
    expect(problemaClaveNueva('vieja', 'ñandú🌱ñandú', 'ñandú🌱ñandú')).toBeNull();
  });

  it('traduce los errores del servidor', () => {
    expect(mensajeCambioClave(new ErrorApi(400, 'clave_actual_incorrecta', 'x'))).toBe('La clave actual no es correcta.');
    expect(mensajeCambioClave(new ErrorApi(429, 'demasiados_intentos', 'x'))).toMatch(/Demasiados intentos/);
    expect(mensajeCambioClave(new ErrorApi(0, 'sin_conexion', 'x'))).toMatch(/conexión/);
    expect(mensajeCambioClave(new ErrorApi(400, 'entrada_invalida', 'x', { nueva: 'Debe tener al menos 10 caracteres.' }))).toContain('al menos 10');
    expect(mensajeCambioClave(new Error('raro'))).toMatch(/No se pudo cambiar/);
  });
});

describe('cambiar clave: vista', () => {
  it('con clave provisoria es obligatoria: solo guardar o salir', async () => {
    const t = await montar(PROVISORIA);
    expect(t.raiz.querySelector('h1')!.textContent).toBe('Defina su clave');
    expect(t.raiz.textContent).toContain('clave provisoria');
    expect(t.raiz.querySelector(`a[href="#/capitulos"]`)).toBeNull();
    t.boton('Salir')!.click();
    expect(t.salir).toHaveBeenCalledTimes(1);
  });

  it('con clave propia es opcional y se puede volver al inicio', async () => {
    const t = await montar(PROPIA);
    expect(t.raiz.querySelector('h1')!.textContent).toBe('Cambiar mi clave');
    expect(t.raiz.querySelector(`a[href="#/capitulos"]`)).not.toBeNull();
    expect(t.boton('Salir')).toBeUndefined();
  });

  it('no envía nada si la validación local falla', async () => {
    const t = await montar(PROVISORIA);
    t.enviar('Provisoria123456', 'Una clave buena', 'Otra distinta');
    expect(t.alerta()!.textContent).toContain('no coinciden');
    expect(t.llamadas).toHaveLength(1); // solo el login
  });

  it('cambio exitoso: envía actual y nueva, toma usuario y csrf nuevos y va al inicio', async () => {
    const t = await montar(PROVISORIA, [json(200, { usuario: PROPIA, csrf: 'tok-2' })]);
    t.enviar('Provisoria123456', 'Mi clave nueva 2026');
    await vi.waitFor(() => expect(t.navegar).toHaveBeenCalledWith('#/capitulos'));
    const llamada = t.llamadas[1];
    expect(llamada.url).toBe('/api/sesion/clave');
    expect(llamada.init.method).toBe('POST');
    expect(new Headers(llamada.init.headers).get('X-CSRF-Token')).toBe('tok-1');
    expect(JSON.parse(String(llamada.init.body))).toEqual({ actual: 'Provisoria123456', nueva: 'Mi clave nueva 2026' });
    expect(usuarioActual()).toEqual(PROPIA);
    expect(t.api.csrfActual()).toBe('tok-2');
  });

  it('tras el cambio vuelve a la ruta que se pidió antes del login', async () => {
    history.replaceState(null, '', '#/capitulo/7');
    manejarSinSesion(vi.fn())();
    const t = await montar(PROVISORIA, [json(200, { usuario: PROPIA, csrf: 'tok-2' })]);
    t.enviar('Provisoria123456', 'Mi clave nueva 2026');
    await vi.waitFor(() => expect(t.navegar).toHaveBeenCalledWith('#/capitulo/7'));
  });

  it('clave actual incorrecta: avisa, vacía ese campo y sigue obligada', async () => {
    const t = await montar(PROVISORIA, [error(400, 'clave_actual_incorrecta')]);
    t.enviar('mala', 'Mi clave nueva 2026');
    await vi.waitFor(() => expect(t.alerta()).not.toBeNull());
    expect(t.alerta()!.textContent).toBe('La clave actual no es correcta.');
    expect(t.campo('actual').value).toBe('');
    expect(t.campo('nueva').value).toBe('Mi clave nueva 2026');
    expect(t.navegar).not.toHaveBeenCalled();
    expect(usuarioActual()!.debeCambiarClave).toBe(true);
  });
});

describe('login con clave provisoria', () => {
  it('lleva a definir la clave en vez de al inicio', async () => {
    const { vistaLogin } = await import('../../src/app/sesion');
    const sim = fetchSimulado(json(200, { usuario: PROVISORIA, csrf: 't' }));
    const api = crearApi({ fetch: sim.fetch, alSinSesion: () => {} });
    const navegar = vi.fn();
    const raiz = document.createElement('div');
    document.body.append(raiz);
    vistaLogin(api, { navegar }).montar(raiz);
    raiz.querySelector<HTMLInputElement>('input[name="correo"]')!.value = 'ana@lab.cl';
    raiz.querySelector<HTMLInputElement>('input[name="clave"]')!.value = 'Provisoria123456';
    raiz.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('#/clave'));
    expect(navegar).not.toHaveBeenCalledWith('#/capitulos');
  });
});
