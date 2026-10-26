/**
 * Decisiones del revisor (Task 7): `PATCH /sugerencias/{sugerenciaId}` y
 * `PATCH /comentarios/{id}/resolucion` (docs/api.md §4.5).
 *
 * - Cada PATCH reemplaza toda la resolución: se reenvían siempre `estado`,
 *   `notaResolucion` y `derivadaReunion`.
 * - Un bloque movido (mismo autor y `grupo`) se decide entero (`completarGrupo`).
 * - En un conflicto no quedan aceptadas propuestas de dos laboratorios: aceptar una deja
 *   las otras «por rechazar» hasta que el revisor confirma en la página. Al confirmar,
 *   primero se guardan los rechazos y solo después la aceptación.
 * - Una sugerencia solo cambia de estado en pantalla si su PATCH respondió bien; los
 *   fallos quedan a la vista con «Reintentar».
 */
import { completarGrupo } from '../../cambios/aplicar';
import { detectarConflictos } from '../../cambios/conflictos';
import { mensajeDe } from '../../editor/ui';
import { ErrorApi, SIN_CONEXION, type Api } from '../api';
import type { Comentario, EstadoComentario, ResolucionComentario, ResolucionSugerencia, SugerenciaServidor } from '../tipos-api';
import { labDe, type CambioResolucion, type EstadoEnvio } from './panel';

const notaLimpia = (n: string | null | undefined): string | null => (n && n.trim() !== '' ? n : null);

/** Cuerpo completo del PATCH: lo que cambia más lo que la sugerencia ya tenía (§4.5). */
export function cuerpoResolucion(s: SugerenciaServidor, cambio: CambioResolucion): ResolucionSugerencia {
  return {
    estado: cambio.estado ?? s.estado ?? 'pendiente',
    notaResolucion: notaLimpia(cambio.notaResolucion !== undefined ? cambio.notaResolucion : s.notaResolucion),
    derivadaReunion: cambio.derivadaReunion ?? s.derivadaReunion ?? false,
  };
}

/** Las sugerencias más los miembros que les faltan de sus bloques movidos, sin repetir. */
export function conGrupo(sugs: SugerenciaServidor[], todas: SugerenciaServidor[]): SugerenciaServidor[] {
  // Un mismo autor y `grupo` en otra versión base es otro movimiento.
  const versiones = new Set(sugs.map((s) => s.versionId));
  const completas = completarGrupo(sugs, todas.filter((s) => versiones.has(s.versionId))) as SugerenciaServidor[];
  return [...new Set(completas)];
}

const enVersion = (s: SugerenciaServidor, versionId: number) => s.versionId === undefined || s.versionId === versionId;
const vigenteParaAplicar = (s: SugerenciaServidor) => {
  const e = s.estado ?? 'pendiente';
  return e === 'pendiente' || e === 'aceptada';
};

/**
 * Propuestas de otros laboratorios que chocan con las elegidas (pendientes o ya
 * aceptadas, de la misma versión base): al aceptar las elegidas deben rechazarse,
 * con sus bloques movidos enteros.
 */
export function porRechazar(elegidas: SugerenciaServidor[], todas: SugerenciaServidor[], versionId: number): SugerenciaServidor[] {
  const elegidasSet = new Set(elegidas);
  const labs = new Set(elegidas.map((s) => labDe(s).usuarioId));
  const candidatas = todas.filter((s) => elegidasSet.has(s) || (enVersion(s, versionId) && vigenteParaAplicar(s)));
  const porId = new Map(candidatas.map((s) => [s.id, s] as const));
  const idsElegidas = new Set(elegidas.map((s) => s.id));
  const otros: SugerenciaServidor[] = [];
  for (const c of detectarConflictos(candidatas)) {
    if (!c.ids.some((id) => idsElegidas.has(id))) continue;
    for (const id of c.ids) {
      const s = porId.get(id);
      if (s && !elegidasSet.has(s) && !labs.has(labDe(s).usuarioId) && !otros.includes(s)) otros.push(s);
    }
  }
  return conGrupo(otros, candidatas).filter((s) => !elegidasSet.has(s));
}

function mensajeEnvio(e: unknown): string {
  if (e instanceof ErrorApi) {
    switch (e.codigo) {
      case SIN_CONEXION:
        return 'sin conexión con el servidor';
      case 'etapa_no_permite':
        return 'la edición final no está abierta';
      case 'no_encontrado':
        return 'la sugerencia ya no existe en el servidor';
      case 'sin_permiso':
        return 'no tiene permiso de revisor';
      case 'sin_sesion':
        return 'la sesión venció: vuelva a entrar';
    }
  }
  return mensajeDe(e);
}

interface Envio {
  s: SugerenciaServidor;
  cuerpo: ResolucionSugerencia;
}

/** Envíos en dos fases: `despues` solo se manda si toda la fase `primero` se guardó. */
interface Lote {
  primero: Envio[];
  despues: Envio[];
}

export interface Fallo extends Envio {
  mensaje: string;
  lote: Lote;
}

export interface Confirmacion {
  elegidas: SugerenciaServidor[];
  cambio: CambioResolucion;
  otros: SugerenciaServidor[];
}

export interface OpcionesDecisiones {
  api: Api;
  /** Todas las sugerencias del capítulo (el arreglo de `GET …/aportes`; se actualiza en el lugar). */
  todas: SugerenciaServidor[];
  versionId: number;
  /** Algo cambió en pantalla; `decidido` es true si cambió el estado guardado de alguna sugerencia o comentario. */
  alCambiar: (decidido: boolean) => void;
}

export interface Decisiones {
  decidir(sugs: SugerenciaServidor[], cambio: CambioResolucion): Promise<void>;
  confirmar(): Promise<void>;
  cancelar(): void;
  reintentar(sugs: SugerenciaServidor[]): Promise<void>;
  resolverComentario(c: Comentario, estado: EstadoComentario, nota: string): Promise<void>;
  confirmacion(): Confirmacion | null;
  envio(sugs: SugerenciaServidor[]): EstadoEnvio;
  errorComentario(c: Comentario): string | undefined;
}

export function crearDecisiones(op: OpcionesDecisiones): Decisiones {
  const fallos = new Map<SugerenciaServidor, Fallo>();
  const enviando = new Set<SugerenciaServidor>();
  const fallosComentario = new Map<Comentario, string>();
  let pendiente: Confirmacion | null = null;

  /** Manda una fase; devuelve true si todos sus PATCH respondieron bien. */
  async function fase(envios: Envio[], lote: Lote): Promise<boolean> {
    const resultados = await Promise.all(
      envios.map(async ({ s, cuerpo }) => {
        try {
          if (s.sugerenciaId === undefined) throw new Error('la sugerencia no trae su id de fila (sugerenciaId)');
          await op.api.patch(`/sugerencias/${s.sugerenciaId}`, cuerpo);
          Object.assign(s, cuerpo);
          return true;
        } catch (e) {
          fallos.set(s, { s, cuerpo, mensaje: mensajeEnvio(e), lote });
          return false;
        } finally {
          enviando.delete(s);
        }
      }),
    );
    return resultados.every(Boolean);
  }

  async function enviarLote(lote: Lote): Promise<void> {
    const todos = [...lote.primero, ...lote.despues];
    if (todos.length === 0) return;
    for (const { s } of todos) {
      enviando.add(s);
      fallos.delete(s);
    }
    op.alCambiar(false);
    const bien = await fase(lote.primero, lote);
    if (bien) {
      await fase(lote.despues, lote);
    } else {
      for (const e of lote.despues) {
        enviando.delete(e.s);
        fallos.set(e.s, {
          ...e,
          mensaje: 'no se envió porque antes deben guardarse los rechazos de las otras propuestas del conflicto',
          lote,
        });
      }
    }
    op.alCambiar(true);
  }

  const envios = (sugs: SugerenciaServidor[], cambio: CambioResolucion): Envio[] =>
    sugs.map((s) => ({ s, cuerpo: cuerpoResolucion(s, cambio) }));

  return {
    decidir(sugs, cambio) {
      const elegidas = conGrupo(sugs, op.todas);
      if (cambio.estado === 'aceptada') {
        const otros = porRechazar(elegidas, op.todas, op.versionId);
        if (otros.length > 0) {
          pendiente = { elegidas, cambio, otros };
          op.alCambiar(false);
          return Promise.resolve();
        }
      }
      pendiente = null;
      return enviarLote({ primero: envios(elegidas, cambio), despues: [] });
    },
    confirmar() {
      const c = pendiente;
      pendiente = null;
      if (!c) return Promise.resolve();
      return enviarLote({ primero: envios(c.otros, { estado: 'rechazada' }), despues: envios(c.elegidas, c.cambio) });
    },
    cancelar() {
      pendiente = null;
      op.alCambiar(false);
    },
    async reintentar(sugs) {
      const lotes = new Set(sugs.map((s) => fallos.get(s)?.lote).filter((l): l is Lote => l !== undefined));
      for (const lote of lotes) {
        const quedan = (es: Envio[]) => es.filter((e) => fallos.has(e.s)).map((e) => ({ s: e.s, cuerpo: e.cuerpo }));
        await enviarLote({ primero: quedan(lote.primero), despues: quedan(lote.despues) });
      }
    },
    async resolverComentario(c, estado, nota) {
      const cuerpo: ResolucionComentario = { estado, notaResolucion: notaLimpia(nota) };
      try {
        await op.api.patch(`/comentarios/${c.id}/resolucion`, cuerpo);
        Object.assign(c, cuerpo);
        fallosComentario.delete(c);
      } catch (e) {
        fallosComentario.set(c, `No se guardó la resolución del comentario: ${mensajeEnvio(e)}.`);
      }
      op.alCambiar(true);
    },
    confirmacion: () => pendiente,
    envio(sugs) {
      return {
        enviando: sugs.some((s) => enviando.has(s)),
        fallos: sugs.flatMap((s) => {
          const f = fallos.get(s);
          return f ? [{ laboratorio: labDe(s).laboratorio, mensaje: f.mensaje }] : [];
        }),
        porRechazar: pendiente !== null && sugs.some((s) => pendiente!.otros.includes(s)),
      };
    },
    errorComentario: (c) => fallosComentario.get(c),
  };
}
