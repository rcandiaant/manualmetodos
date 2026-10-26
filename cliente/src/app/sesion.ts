/**
 * Sesión del usuario (docs/api.md §2) y pantalla de login.
 *
 * El usuario y el `csrf` viven solo en memoria. Al recargar, `iniciar` los recupera con
 * `GET /sesion`. Si cualquier petición recibe 401 `sin_sesion`, `manejarSinSesion` lleva
 * al login recordando la ruta pedida para volver a ella tras entrar. La ruta queda atada a
 * quien tenía la sesión: si entra otra persona en el mismo equipo, va al inicio.
 */
import { el } from '../editor/ui';
import { ErrorApi, SIN_CONEXION, type Api } from './api';
import { RUTA_INICIO, type Vista } from './router';
import type { Rol, Sesion, Usuario } from './tipos-api';

export const RUTA_LOGIN = '#/entrar';

let usuario: Usuario | null = null;
/** Ruta pedida antes de caer en el login y quién tenía la sesión (null: nadie, p. ej. un enlace directo). */
let rutaPendiente: { hash: string; usuarioId: number | null } | null = null;

export const usuarioActual = (): Usuario | null => usuario;

/** Clave de autor de las sugerencias (contrato §2.4). */
export const claveAutor = (u: Usuario): string => `u${u.id}`;

export const tieneRol = (u: Usuario, rol: Rol): boolean => u.roles.includes(rol);

/** `GET /sesion`: recupera usuario y csrf tras una recarga. `null` si no hay sesión. */
export async function iniciar(api: Api): Promise<Usuario | null> {
  try {
    const s = await api.get<Sesion>('/sesion');
    usuario = s.usuario;
    api.fijarCsrf(s.csrf);
    return s.usuario;
  } catch (e) {
    if (e instanceof ErrorApi && e.estado === 401) {
      usuario = null;
      return null;
    }
    throw e;
  }
}

/** `POST /sesion`. El honeypot `sitio_web` viaja siempre vacío. */
export async function entrar(api: Api, correo: string, clave: string): Promise<Usuario> {
  const s = await api.post<Sesion>('/sesion', { correo, clave, sitio_web: '' });
  usuario = s.usuario;
  api.fijarCsrf(s.csrf);
  return s.usuario;
}

/** `DELETE /sesion`. Un 401 significa que ya estaba cerrada; cualquier otro fallo se propaga. */
export async function salir(api: Api): Promise<void> {
  rutaPendiente = null;
  try {
    await api.del('/sesion');
  } catch (e) {
    if (!(e instanceof ErrorApi && e.estado === 401)) throw e;
  } finally {
    usuario = null;
    api.fijarCsrf(null);
  }
}

/**
 * Ruta que se pidió antes de caer en el login (se consume al leerla). Con `usuarioId`, se
 * descarta si la sesión vencida era de otra persona.
 */
export function tomarRutaPendiente(usuarioId?: number): string | null {
  const r = rutaPendiente;
  rutaPendiente = null;
  if (!r) return null;
  if (usuarioId !== undefined && r.usuarioId !== null && r.usuarioId !== usuarioId) return null;
  return r.hash;
}

/** Para `crearApi({alSinSesion})`: olvida al usuario, recuerda la ruta y va al login. */
export function manejarSinSesion(navegar: (hash: string) => unknown): () => void {
  return () => {
    const previo = usuario?.id ?? rutaPendiente?.usuarioId ?? null;
    usuario = null;
    const hash = location.hash;
    if (hash !== RUTA_LOGIN && hash !== '' && hash !== '#') rutaPendiente = { hash, usuarioId: previo };
    void navegar(RUTA_LOGIN);
  };
}

/**
 * Compuerta para `alSinSesion`: durante el arranque (antes de definir las rutas) el 401
 * de `GET /sesion` no navega; `abrir()` la habilita.
 */
export function conCompuerta(alSinSesion: () => void): { handler: () => void; abrir: () => void } {
  let abierta = false;
  return {
    handler: () => {
      if (abierta) alSinSesion();
    },
    abrir: () => {
      abierta = true;
    },
  };
}

/** Texto de espera para un 429: «5 minutos» o «45 segundos». */
function esperaLegible(segundos: number | undefined): string {
  if (segundos === undefined) return 'unos minutos';
  if (segundos < 60) return `${Math.max(1, Math.ceil(segundos))} ${segundos <= 1 ? 'segundo' : 'segundos'}`;
  const m = Math.ceil(segundos / 60);
  return `${m} ${m === 1 ? 'minuto' : 'minutos'}`;
}

export function mensajeLogin(e: unknown): string {
  if (e instanceof ErrorApi) {
    if (e.codigo === SIN_CONEXION) return 'No hay conexión con el servidor. Revise su conexión a Internet e intente de nuevo.';
    if (e.estado === 401) return 'Correo o clave incorrectos.';
    if (e.estado === 429) return `Demasiados intentos. Espere ${esperaLegible(e.esperaSegundos)} antes de volver a intentar.`;
    if (e.estado === 400) return 'Escriba su correo y su clave.';
  }
  return 'No se pudo iniciar sesión. Intente de nuevo en un momento.';
}

export interface DepsLogin {
  navegar: (hash: string) => unknown;
}

export function vistaLogin(api: Api, deps: DepsLogin): Vista {
  let enviando = false;
  return {
    montar(raiz) {
      if (usuario) {
        // Ya hay sesión: el login no tiene nada que hacer.
        void deps.navegar(RUTA_INICIO);
        return;
      }
      const caja = el('div', { class: 'error', role: 'alert', hidden: '' });
      const correo = el('input', { type: 'email', name: 'correo', id: 'campo-correo', autocomplete: 'username', required: '' });
      const clave = el('input', { type: 'password', name: 'clave', id: 'campo-clave', autocomplete: 'current-password', required: '' });
      // Honeypot: oculto con CSS (`.trampa`), no con type=hidden, para que lo llenen los bots.
      const trampa = el('input', { type: 'text', name: 'sitio_web', id: 'campo-sitio-web', tabindex: '-1', autocomplete: 'off' });
      const enviar = el('button', { type: 'submit', class: 'primario' }, 'Entrar');

      const form = el(
        'form',
        { class: 'login' },
        el('label', { for: 'campo-correo' }, 'Correo'),
        correo,
        el('label', { for: 'campo-clave' }, 'Clave'),
        clave,
        el('div', { class: 'trampa', 'aria-hidden': 'true' }, el('label', { for: 'campo-sitio-web' }, 'Sitio web'), trampa),
        caja,
        enviar,
      );
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (enviando) return;
        enviando = true;
        enviar.disabled = true;
        caja.hidden = true;
        void entrar(api, correo.value.trim(), clave.value)
          .then((u) => deps.navegar(tomarRutaPendiente(u.id) ?? RUTA_INICIO))
          .catch((e: unknown) => {
            clave.value = '';
            caja.textContent = mensajeLogin(e);
            caja.hidden = false;
          })
          .finally(() => {
            enviando = false;
            enviar.disabled = false;
          });
      });

      raiz.append(
        el(
          'main',
          { class: 'app app-login' },
          el('h1', {}, 'Manual de métodos'),
          el('p', { class: 'subtitulo' }, 'Consulta del manual: ingrese con su cuenta.'),
          form,
          el('p', { class: 'ayuda' }, 'Si olvidó su clave o no tiene cuenta, contacte al administrador.'),
        ),
      );
      correo.focus();
    },
    desmontar() {},
  };
}

