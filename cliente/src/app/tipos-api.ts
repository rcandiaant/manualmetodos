/**
 * DTO del contrato (docs/api.md), con los nombres de campo exactos de la API.
 * Fechas: texto ISO 8601 en UTC con `Z` (§1.3), o `null`.
 */
import type { DocJSON, Rango, Sugerencia } from '../tipos';

export type Rol = 'laboratorio' | 'revisor' | 'admin';
export type Etapa = 'preparacion' | 'consulta' | 'edicion_final';
export type FechaIso = string;

/** Códigos de error del contrato (§1.1). */
export type CodigoError =
  | 'entrada_invalida'
  | 'credenciales_invalidas'
  | 'sin_sesion'
  | 'sin_permiso'
  | 'csrf_invalido'
  | 'origen_invalido'
  | 'no_encontrado'
  | 'metodo_no_permitido'
  | 'etapa_no_permite'
  | 'version_obsoleta'
  | 'conflicto_concurrente'
  | 'operacion_no_permitida'
  | 'cuerpo_muy_grande'
  | 'tipo_no_soportado'
  | 'documento_invalido'
  | 'demasiados_intentos'
  | 'error_interno';

// §4.0 GET /salud
export interface Salud {
  estado: 'ok';
}

// §2.1 Sesión
export interface Usuario {
  id: number;
  nombre: string;
  laboratorio: string;
  roles: Rol[];
}

export interface Sesion {
  usuario: Usuario;
  csrf: string;
}

export interface Login {
  correo: string;
  clave: string;
  /** Honeypot: siempre vacío. */
  sitio_web: '';
}

// §4.1 Consulta
export interface Consulta {
  apertura: FechaIso | null;
  cierre: FechaIso | null;
  etapa: Etapa;
  motivoObligatorio: boolean;
}

/** Cuerpo de `PUT /admin/consulta` (los tres campos son obligatorios). */
export interface ConsultaEntrada {
  apertura: FechaIso;
  cierre: FechaIso;
  motivoObligatorio: boolean;
}

// §4.2 Capítulos
export interface CapituloLista {
  id: number;
  orden: number;
  slug: string;
  titulo: string;
  misCambios: number;
  misComentarios: number;
  /** Solo para el rol revisor. */
  totalSugerencias?: number;
  totalComentarios?: number;
  pendientes?: number;
}

export interface Base {
  versionId: number;
  docJson: DocJSON;
}

// §4.3 Copia del laboratorio
export type EstadoSugerencia = 'pendiente' | 'aceptada' | 'rechazada' | 'modificada';

/** Sugerencia tal como la devuelve el servidor: la del cliente más los campos de resolución. */
export interface SugerenciaServidor extends Sugerencia {
  estado?: EstadoSugerencia;
  motivo?: string;
  /** Id de fila: el que usa `PATCH /sugerencias/{id}`. */
  sugerenciaId?: number;
  usuarioId?: number;
  laboratorio?: string;
  versionId?: number;
  notaResolucion?: string | null;
  derivadaReunion?: boolean;
  resueltoPor?: number | null;
  resueltoEn?: FechaIso | null;
}

export type Copia =
  | { docJson: null }
  | {
      docJson: DocJSON;
      actualizado: FechaIso;
      versionId: number;
      sugerencias: SugerenciaServidor[];
    };

export interface CopiaEntrada {
  versionId: number;
  docJson: DocJSON;
  sugerencias: Sugerencia[];
}

export interface CopiaGuardada {
  actualizado: FechaIso;
}

export interface MotivoActualizado {
  id: string;
  motivo: string | null;
}

// §4.4–4.5 Comentarios
export type EstadoComentario = 'abierto' | 'resuelto';

export interface Comentario {
  id: number;
  bloqueId: string;
  rango: Rango;
  texto: string;
  estado: EstadoComentario;
  creado: FechaIso;
  /** En `…/mis-aportes` y `…/aportes`. */
  notaResolucion?: string | null;
  /** Solo en `…/aportes` (revisor). */
  usuarioId?: number;
  laboratorio?: string;
  resueltoPor?: number | null;
  resueltoEn?: FechaIso | null;
}

export interface ComentarioEntrada {
  bloqueId: string;
  rango: Rango;
  texto: string;
}

export interface IdCreado<T = number> {
  id: T;
}

// §4.5 Revisión
export interface Aportes {
  sugerencias: SugerenciaServidor[];
  comentarios: Comentario[];
}

export interface ResolucionSugerencia {
  estado: EstadoSugerencia;
  notaResolucion: string | null;
  derivadaReunion: boolean;
}

export interface ResolucionComentario {
  estado: EstadoComentario;
  notaResolucion: string | null;
}

export interface FinalEntrada {
  docJson: DocJSON;
  tex: string;
}

export interface Final {
  versionId: number;
  docJson: DocJSON;
  tex: string;
}

// §4.6 Administración
export interface CapituloEntrada {
  slug: string;
  titulo: string;
  orden: number;
  texOriginal: string;
  docJson: DocJSON;
}

export interface CapituloCreado {
  id: number;
  versionId: number;
}

export interface UsuarioAdmin {
  id: number;
  nombre: string;
  laboratorio: string;
  correo: string;
  roles: Rol[];
  activo: boolean;
}

export interface CuentaImportada {
  correo: string;
  clave: string;
}

export interface ClaveRegenerada {
  clave: string;
}

export interface UsuarioCambio {
  activo?: boolean;
  roles?: Rol[];
}
