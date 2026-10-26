/**
 * Autoguardado de la copia del laboratorio (docs/api.md §4.3).
 *
 * - `cambio(copia)` programa un envío tras `esperaMs` (2 s) sin cambios.
 * - Cada envío calcula `calcularSugerencias(base, copia, autor)` y hace
 *   `PUT /capitulos/{id}/copia` con `{versionId, docJson, sugerencias}`.
 * - Antes de cada envío escribe el borrador en el almacén local
 *   (`mm:borrador:<usuarioId>:<capituloId>:<versionId>`) y lo borra al confirmar.
 *   Mientras el guardado está detenido por un fallo, cada cambio también va al borrador.
 * - Fallo de red (`sin_conexion`), 5xx o 409 `conflicto_concurrente`: reintentos con
 *   espera creciente (2, 4, 8 … s, hasta 60 s). 401: `sesion-vencida`, también con reintentos
 *   (en la app, el 401 lleva al login y la vista se desmonta; el borrador queda guardado).
 * - 409 `etapa_no_permite`: `cerrada`, sin más envíos.
 * - 409 `version_obsoleta`: `error` con `codigo`, sin más envíos (la vista pasa a solo lectura). 413/422 y otros errores: `error`
 *   sin reintento automático; un cambio posterior vuelve a intentarlo.
 *
 * - Task 5: `motivoDe` agrega el motivo a cada sugerencia del cuerpo (el servidor lo toma
 *   solo en las nuevas) y `alConfirmar` avisa al panel qué sugerencias quedaron en el servidor.
 *
 * Principio rector: el trabajo nunca se pierde en silencio. Toda copia no confirmada
 * queda en el borrador local y el estado visible dice por qué.
 */
import { calcularSugerencias } from '../../cambios/sugerencias';
import type { DocJSON, Sugerencia } from '../../tipos';
import { ErrorApi, SIN_CONEXION, type Api } from '../api';
import type { CopiaEntrada, CopiaGuardada, FechaIso } from '../tipos-api';

export type EstadoGuardado =
  | 'guardado'
  | 'pendiente'
  | 'guardando'
  | 'sin-conexion'
  | 'sesion-vencida'
  | 'cerrada'
  | 'error';

export interface InfoGuardado {
  estado: EstadoGuardado;
  /** Momento (reloj del navegador) de la última confirmación del servidor. */
  ultimoGuardado?: Date;
  /** Texto para mostrar (en español). */
  mensaje: string;
  /** Código de error del servidor que llevó a este estado (p. ej. `version_obsoleta`). */
  codigo?: string;
}

export interface Reloj {
  ahora(): Date;
  esperar(fn: () => void, ms: number): unknown;
  cancelar(id: unknown): void;
}

/** Usa los temporizadores globales en el momento de la llamada (así sirven los relojes falsos de las pruebas). */
export const relojSistema: Reloj = {
  ahora: () => new Date(),
  esperar: (fn, ms) => setTimeout(fn, ms),
  cancelar: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export interface Borrador {
  docJson: DocJSON;
  /** Cuándo se escribió (ISO, reloj del navegador). */
  guardadoLocal: FechaIso;
  /** `actualizado` de la copia del servidor sobre la que se editó (null: sin copia). */
  actualizadoServidor: FechaIso | null;
}

export const claveBorrador = (usuarioId: number | string, capituloId: number | string, versionId: number | string) =>
  `mm:borrador:${usuarioId}:${capituloId}:${versionId}`;

export function leerBorrador(almacen: Storage | undefined, clave: string): Borrador | null {
  try {
    const crudo = almacen?.getItem(clave);
    if (!crudo) return null;
    const b = JSON.parse(crudo) as Partial<Borrador>;
    if (!b || typeof b !== 'object' || !b.docJson || typeof b.docJson !== 'object') return null;
    return {
      docJson: b.docJson,
      guardadoLocal: typeof b.guardadoLocal === 'string' ? b.guardadoLocal : '',
      actualizadoServidor: typeof b.actualizadoServidor === 'string' ? b.actualizadoServidor : null,
    };
  } catch {
    return null;
  }
}

export function borrarBorrador(almacen: Storage | undefined, clave: string): void {
  try {
    almacen?.removeItem(clave);
  } catch {
    // almacén no disponible
  }
}

export interface OpcionesAutoguardado {
  api: Api;
  capituloId: number;
  versionId: number;
  base: DocJSON;
  /** Clave de autor `u<usuarioId>` (contrato §2.4); de ella sale el usuario de la clave del borrador. */
  autor: string;
  esperaMs?: number;
  reloj?: Reloj;
  almacen?: Storage;
  /** `actualizado` de la copia del servidor al abrir (para el borrador y el indicador). */
  actualizado?: FechaIso | null;
  /**
   * Motivo que se envía con cada sugerencia (Task 5). El servidor lo toma solo para las
   * sugerencias nuevas; las que ya existían conservan el suyo (docs/api.md §4.3).
   */
  motivoDe?: (s: Sugerencia) => string | undefined;
  /** Se llama tras cada PUT confirmado con las sugerencias tal como se enviaron. */
  alConfirmar?: (enviadas: Sugerencia[]) => void;
}

export interface Autoguardado {
  cambio(copia: DocJSON): void;
  guardarYa(): Promise<void>;
  estado(): InfoGuardado;
  alCambiarEstado(fn: (e: InfoGuardado) => void): void;
  detener(): Promise<void>;
  /** Copia aún no confirmada por el servidor, o null. */
  sinConfirmar(): DocJSON | null;
}

const ESPERA_MAX_MS = 60_000;
const PRIMER_REINTENTO_MS = 2_000;

export const MENSAJES: Record<EstadoGuardado, string> = {
  guardado: 'Guardado',
  pendiente: 'Cambios sin guardar…',
  guardando: 'Guardando…',
  'sin-conexion': 'Sin guardar: sin conexión, reintentando',
  'sesion-vencida': 'Sesión vencida: vuelva a entrar',
  cerrada: 'La consulta está cerrada: no se pueden guardar más cambios.',
  error: 'No se pudo guardar',
};

/** Estados en que el guardado está detenido por un fallo (cada cambio va directo al borrador). */
const DETENIDO = new Set<EstadoGuardado>(['sin-conexion', 'sesion-vencida', 'cerrada', 'error']);

export function crearAutoguardado(op: OpcionesAutoguardado): Autoguardado {
  const reloj = op.reloj ?? relojSistema;
  const esperaMs = op.esperaMs ?? 2000;
  const usuarioId = op.autor.replace(/^u/, '');
  const clave = claveBorrador(usuarioId, op.capituloId, op.versionId);
  const oyentes: ((e: InfoGuardado) => void)[] = [];

  let info: InfoGuardado = { estado: 'guardado', mensaje: MENSAJES.guardado };
  let actualizadoServidor: FechaIso | null = op.actualizado ?? null;
  /** Última copia recibida que el servidor aún no confirmó. */
  let pendiente: DocJSON | null = null;
  let temporizador: unknown = null;
  let reintento: unknown = null;
  let siguienteEspera = PRIMER_REINTENTO_MS;
  let enCurso: Promise<void> | null = null;
  /** Fallo terminal: no se envía nada más (cerrada, version_obsoleta). */
  let terminal = false;
  let detenido = false;
  let borradorFallido = false;
  /** Mensaje del último estado, sin el aviso del borrador. */
  let mensajeBase = MENSAJES.guardado;

  function fijar(estado: EstadoGuardado, mensaje = MENSAJES[estado], codigo?: string): void {
    mensajeBase = mensaje;
    const aviso = borradorFallido && estado !== 'guardado' ? ' (no se pudo escribir el borrador en este navegador)' : '';
    info = {
      estado,
      mensaje: mensaje + aviso,
      ...(info.ultimoGuardado ? { ultimoGuardado: info.ultimoGuardado } : {}),
      ...(codigo ? { codigo } : {}),
    };
    for (const fn of oyentes) {
      try {
        fn(info);
      } catch (e) {
        console.error('Error en un oyente del autoguardado', e);
      }
    }
  }

  function escribirBorrador(copia: DocJSON): void {
    const b: Borrador = { docJson: copia, guardadoLocal: reloj.ahora().toISOString(), actualizadoServidor };
    try {
      if (!op.almacen) throw new Error('sin almacén');
      op.almacen.setItem(clave, JSON.stringify(b));
      borradorFallido = false;
    } catch {
      borradorFallido = true;
    }
  }

  function cancelar(): void {
    if (temporizador !== null) reloj.cancelar(temporizador);
    if (reintento !== null) reloj.cancelar(reintento);
    temporizador = null;
    reintento = null;
  }

  function programarReintento(): void {
    if (detenido) return;
    const espera = siguienteEspera;
    siguienteEspera = Math.min(siguienteEspera * 2, ESPERA_MAX_MS);
    reintento = reloj.esperar(() => {
      reintento = null;
      void enviar();
    }, espera);
  }

  /** Clasifica el error del PUT: estado visible y si se reintenta solo. */
  function alFallar(e: unknown): void {
    if (e instanceof ErrorApi) {
      if (e.codigo === SIN_CONEXION) {
        fijar('sin-conexion');
        programarReintento();
        return;
      }
      if (e.estado === 401) {
        fijar('sesion-vencida');
        programarReintento();
        return;
      }
      if (e.estado === 409 && e.codigo === 'etapa_no_permite') {
        terminal = true;
        fijar('cerrada', `${MENSAJES.cerrada} ${e.message}`, e.codigo);
        return;
      }
      if (e.estado === 409 && e.codigo === 'version_obsoleta') {
        terminal = true;
        fijar('error', `${MENSAJES.error}: ${e.message}`, e.codigo);
        return;
      }
      if (e.estado >= 500 || (e.estado === 409 && e.codigo === 'conflicto_concurrente')) {
        fijar('error', `${MENSAJES.error}: ${e.message} Se reintentará en unos segundos.`);
        programarReintento();
        return;
      }
      fijar('error', `${MENSAJES.error}: ${e.message}`);
      return;
    }
    fijar('error', `${MENSAJES.error}: ${e instanceof Error ? e.message : String(e)}`);
  }

  /** Un envío (o espera al que está en curso y repite si quedó algo pendiente). */
  function enviar(): Promise<void> {
    if (enCurso) {
      return enCurso.then(() => (pendiente && !terminal && info.estado !== 'guardado' ? enviar() : undefined));
    }
    cancelar();
    if (!pendiente || terminal) return Promise.resolve();
    const copia = pendiente;
    // Antes de cualquier espera: el borrador queda escrito aunque la página se cierre ya.
    escribirBorrador(copia);
    fijar('guardando');
    enCurso = (async () => {
      try {
        const sugerencias = calcularSugerencias(op.base, copia, op.autor).map((s) => {
          let motivo: string | undefined;
          try {
            motivo = op.motivoDe?.(s);
          } catch (e) {
            console.error('Error en motivoDe del autoguardado', e); // no impide guardar la copia
          }
          return motivo ? { ...s, motivo } : s;
        });
        const cuerpo: CopiaEntrada = { versionId: op.versionId, docJson: copia, sugerencias };
        const r = await op.api.put<CopiaGuardada>(`/capitulos/${op.capituloId}/copia`, cuerpo);
        try {
          op.alConfirmar?.(sugerencias);
        } catch (e) {
          console.error('Error en alConfirmar del autoguardado', e);
        }
        siguienteEspera = PRIMER_REINTENTO_MS;
        if (typeof r?.actualizado === 'string') actualizadoServidor = r.actualizado;
        info = { ...info, ultimoGuardado: reloj.ahora() };
        if (pendiente === copia) {
          pendiente = null;
          borrarBorrador(op.almacen, clave);
          fijar('guardado');
        } else {
          // Llegaron cambios durante el envío: se guardan tras la espera normal.
          fijar('pendiente');
          if (!detenido) programarEspera();
        }
      } catch (e) {
        alFallar(e);
      } finally {
        enCurso = null;
      }
    })();
    return enCurso;
  }

  function programarEspera(): void {
    if (temporizador !== null) reloj.cancelar(temporizador);
    temporizador = reloj.esperar(() => {
      temporizador = null;
      void enviar();
    }, esperaMs);
  }

  return {
    cambio(copia) {
      if (detenido) return;
      pendiente = copia;
      if (terminal) {
        escribirBorrador(copia);
        fijar(info.estado, mensajeBase, info.codigo);
        return;
      }
      if (DETENIDO.has(info.estado)) {
        escribirBorrador(copia);
        if (info.estado === 'error' && reintento === null) {
          // Error sin reintento automático (413/422…): un cambio nuevo vuelve a intentarlo.
          fijar('pendiente');
          programarEspera();
        }
        return;
      }
      // Con un envío en curso, lo nuevo va ya al borrador (la página puede cerrarse antes de la respuesta).
      if (info.estado === 'guardando') escribirBorrador(copia);
      else fijar('pendiente');
      programarEspera();
    },
    guardarYa() {
      if (temporizador !== null) reloj.cancelar(temporizador);
      temporizador = null;
      // Síncrono y antes de esperar cualquier envío en curso: sirve en beforeunload.
      if (pendiente) escribirBorrador(pendiente);
      return enviar();
    },
    estado: () => info,
    alCambiarEstado(fn) {
      oyentes.push(fn);
    },
    async detener() {
      if (detenido) return;
      if (temporizador !== null) reloj.cancelar(temporizador);
      temporizador = null;
      const reintentaba = reintento !== null;
      if (enCurso) await enCurso.catch(() => {});
      detenido = true;
      cancelar();
      if (!pendiente) return;
      if (terminal || (DETENIDO.has(info.estado) && info.estado !== 'error') || reintentaba) {
        // Guardado detenido por un fallo: no se insiste; el borrador queda escrito.
        escribirBorrador(pendiente);
        return;
      }
      await enviar();
      cancelar(); // un fallo del último envío no deja reintentos vivos
    },
    sinConfirmar: () => pendiente,
  };
}
