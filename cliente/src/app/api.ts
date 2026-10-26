/**
 * Cliente HTTP del contrato (docs/api.md §1–2).
 *
 * - Rutas relativas a `/api`; `credentials: 'same-origin'` (la cookie es HttpOnly).
 * - `Content-Type: application/json` en toda petición con cuerpo.
 * - `X-CSRF-Token` en todo método distinto de GET/HEAD, salvo `POST /sesion` (login,
 *   §1.2). El token vive solo en memoria.
 * - 403 `csrf_invalido`: recarga el token con `GET /sesion` y reintenta una sola vez.
 * - 401 `sin_sesion`: llama `alSinSesion` y lanza el error.
 * - Toda respuesta distinta de 2xx lanza `ErrorApi`, salvo el 304 de un `get` con
 *   `etag`, que devuelve `{noModificado: true}` (un 304 sin `etag` pedido es un error).
 * - Un fallo de red (fetch rechazado) lanza `ErrorApi` con `estado: 0` y
 *   `codigo: 'sin_conexion'` (código propio del cliente, no viene del servidor).
 */

export class ErrorApi extends Error {
  readonly estado: number;
  readonly codigo: string;
  readonly campos?: Record<string, string>;

  constructor(estado: number, codigo: string, mensaje: string, campos?: Record<string, string>) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.estado = estado;
    this.codigo = codigo;
    if (campos) this.campos = campos;
  }
}

export interface NoModificado {
  noModificado: true;
}

export interface OpcionesGet {
  /** Valor para `If-None-Match` (p. ej. `"v7"`); con 304 se devuelve `{noModificado: true}`. */
  etag?: string;
}

export interface Api {
  get<T>(ruta: string): Promise<T>;
  get<T>(ruta: string, opciones: OpcionesGet): Promise<T | NoModificado>;
  post<T>(ruta: string, cuerpo?: unknown): Promise<T>;
  put<T>(ruta: string, cuerpo?: unknown): Promise<T>;
  patch<T>(ruta: string, cuerpo?: unknown): Promise<T>;
  del(ruta: string): Promise<void>;
  fijarCsrf(token: string | null): void;
  csrfActual(): string | null;
}

export interface OpcionesApi {
  fetch?: typeof fetch;
  alSinSesion: () => void;
}

type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Código del cliente para un fallo de red (el servidor no respondió). */
export const SIN_CONEXION = 'sin_conexion';

/** `POST /sesion` (login) no lleva `X-CSRF-Token` ni se reintenta por CSRF (§1.2). */
const esLogin = (metodo: Metodo, ruta: string): boolean => metodo === 'POST' && ruta === '/sesion';

const SIN_CUERPO = Symbol('sin-cuerpo');

export function esNoModificado(x: unknown): x is NoModificado {
  return typeof x === 'object' && x !== null && (x as NoModificado).noModificado === true;
}

/** Arma el `ErrorApi` de una respuesta fallida; si el cuerpo no es el JSON del contrato, `error_interno`. */
async function errorDeRespuesta(r: Response): Promise<ErrorApi> {
  let datos: unknown = null;
  try {
    datos = await r.json();
  } catch {
    // cuerpo vacío o no JSON (p. ej. un 502 HTML de un proxy)
  }
  const e = (datos as { error?: { codigo?: unknown; mensaje?: unknown; campos?: unknown } } | null)?.error;
  if (e && typeof e.codigo === 'string') {
    const mensaje = typeof e.mensaje === 'string' && e.mensaje ? e.mensaje : `Error ${r.status}.`;
    const campos =
      e.campos && typeof e.campos === 'object' ? (e.campos as Record<string, string>) : undefined;
    return new ErrorApi(r.status, e.codigo, mensaje, campos);
  }
  return new ErrorApi(r.status, 'error_interno', `El servidor respondió con un error inesperado (HTTP ${r.status}).`);
}

export function crearApi(opciones: OpcionesApi): Api {
  const hacerFetch: typeof fetch = opciones.fetch ?? ((entrada, init) => fetch(entrada, init));
  let csrf: string | null = null;

  async function enviar(metodo: Metodo, ruta: string, cuerpo: unknown, etag?: string): Promise<Response> {
    const cabeceras: Record<string, string> = { Accept: 'application/json' };
    const init: RequestInit = { method: metodo, credentials: 'same-origin', headers: cabeceras };
    if (cuerpo !== SIN_CUERPO) {
      cabeceras['Content-Type'] = 'application/json';
      init.body = JSON.stringify(cuerpo ?? {});
    }
    if (metodo !== 'GET' && csrf && !esLogin(metodo, ruta)) cabeceras['X-CSRF-Token'] = csrf;
    if (etag) cabeceras['If-None-Match'] = etag;
    try {
      return await hacerFetch(`/api${ruta}`, init);
    } catch {
      throw new ErrorApi(0, SIN_CONEXION, 'Sin conexión con el servidor. Revise su conexión a Internet.');
    }
  }

  /** Recarga el token con `GET /sesion`. Devuelve false si no se pudo. */
  async function recargarCsrf(): Promise<boolean> {
    const r = await enviar('GET', '/sesion', SIN_CUERPO);
    if (!r.ok) {
      const e = await errorDeRespuesta(r);
      if (e.codigo === 'sin_sesion') {
        opciones.alSinSesion();
        throw e;
      }
      return false;
    }
    const datos = (await r.json().catch(() => null)) as { csrf?: unknown } | null;
    if (typeof datos?.csrf !== 'string') return false;
    csrf = datos.csrf;
    return true;
  }

  async function pedir<T>(metodo: Metodo, ruta: string, cuerpo: unknown, etag?: string): Promise<T> {
    let r = await enviar(metodo, ruta, cuerpo, etag);
    if (r.status === 403 && metodo !== 'GET' && !esLogin(metodo, ruta)) {
      const e = await errorDeRespuesta(r.clone());
      if (e.codigo === 'csrf_invalido' && (await recargarCsrf())) {
        r = await enviar(metodo, ruta, cuerpo, etag);
      }
    }
    if (r.status === 304) {
      if (etag) return { noModificado: true } as T;
      throw new ErrorApi(304, 'error_interno', 'El servidor respondió 304 sin que se pidiera una validación.');
    }
    if (!r.ok) {
      const e = await errorDeRespuesta(r);
      if (e.estado === 401 && e.codigo === 'sin_sesion') opciones.alSinSesion();
      throw e;
    }
    if (r.status === 204) return undefined as T;
    const texto = await r.text();
    if (!texto) return undefined as T;
    try {
      return JSON.parse(texto) as T;
    } catch {
      throw new ErrorApi(r.status, 'error_interno', 'La respuesta del servidor no es JSON válido.');
    }
  }

  return {
    get<T>(ruta: string, op?: OpcionesGet) {
      return pedir<T>('GET', ruta, SIN_CUERPO, op?.etag);
    },
    post: <T>(ruta: string, cuerpo?: unknown) => pedir<T>('POST', ruta, cuerpo),
    put: <T>(ruta: string, cuerpo?: unknown) => pedir<T>('PUT', ruta, cuerpo),
    patch: <T>(ruta: string, cuerpo?: unknown) => pedir<T>('PATCH', ruta, cuerpo),
    del: (ruta: string) => pedir<void>('DELETE', ruta, SIN_CUERPO),
    fijarCsrf(token) {
      csrf = token;
    },
    csrfActual: () => csrf,
  } as Api;
}
