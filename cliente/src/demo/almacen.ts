import { calcularSugerencias } from '../cambios/sugerencias';
import { jsonEstable } from '../cambios/tokens';
import { validarDocumento } from '../esquema/esquema';
import type { DocJSON } from '../tipos';

/** Estado de la demo (sin backend). Se guarda en localStorage si está disponible. */

export type Lab = 'labA' | 'labB';
export const LABS: Lab[] = ['labA', 'labB'];
export const NOMBRE_LAB: Record<Lab, string> = { labA: 'Laboratorio A', labB: 'Laboratorio B' };
export const LETRA_LAB: Record<Lab, string> = { labA: 'A', labB: 'B' };

export type Decision = 'aceptada' | 'rechazada';

export interface EstadoDemo {
  archivo: string | null;
  /** Base normalizada por el esquema (attrs por defecto explícitos). */
  base: DocJSON | null;
  avisos: string[];
  copias: Partial<Record<Lab, DocJSON>>;
  /** Motivo por id de sugerencia, por laboratorio. */
  motivos: Record<Lab, Record<string, string>>;
  /** Decisiones del revisor por id de sugerencia. */
  decisiones: Record<string, Decision>;
  /**
   * Decisiones del revisor borradas porque el laboratorio guardó una copia distinta
   * (los ids dependen de la posición). Se muestran al revisor y luego se ponen a cero.
   */
  decisionesDescartadas: Partial<Record<Lab, number>>;
}

const CLAVE = 'manualmetodos-demo-fase0-v1';

export function estadoVacio(): EstadoDemo {
  return {
    archivo: null,
    base: null,
    avisos: [],
    copias: {},
    motivos: { labA: {}, labB: {} },
    decisiones: {},
    decisionesDescartadas: {},
  };
}

/* ---------- Validación del estado leído ---------- */

const esObjeto = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const esLab = (k: string): k is Lab => (LABS as string[]).includes(k);
const esTexto = (v: unknown): v is string => typeof v === 'string';
const esDecision = (v: unknown): v is Decision => v === 'aceptada' || v === 'rechazada';
const esConteo = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function docValido(x: unknown, que: string): DocJSON {
  if (!esObjeto(x)) throw new Error(`${que}: no es un documento`);
  const v = validarDocumento(x as DocJSON);
  if (!v.ok) throw new Error(`${que}: ${v.error}`);
  return x as DocJSON;
}

/** Objeto cuyos valores cumplen `valido` (undefined → {}); lanza si no. */
function registro<T>(x: unknown, que: string, valido: (v: unknown) => v is T): Record<string, T> {
  if (x === undefined) return {};
  if (!esObjeto(x)) throw new Error(`${que}: no es un objeto`);
  for (const [k, v] of Object.entries(x)) if (!valido(v)) throw new Error(`${que}.${k}: valor inválido`);
  return x as Record<string, T>;
}

/** Registro indexado solo por laboratorios conocidos. */
function porLab<T>(x: unknown, que: string, valido: (v: unknown) => v is T): Partial<Record<Lab, T>> {
  const r = registro(x, que, valido);
  for (const k of Object.keys(r)) if (!esLab(k)) throw new Error(`${que}: laboratorio desconocido ${k}`);
  return r as Partial<Record<Lab, T>>;
}

/** Valida la forma del estado leído (y sus documentos contra el esquema); lanza si algo falla. */
export function validarEstado(x: unknown): EstadoDemo {
  if (!esObjeto(x)) throw new Error('el estado no es un objeto');
  const e = estadoVacio();
  if (x.archivo !== undefined && x.archivo !== null && !esTexto(x.archivo)) throw new Error('archivo inválido');
  e.archivo = (x.archivo as string | null | undefined) ?? null;
  e.base = x.base === undefined || x.base === null ? null : docValido(x.base, 'base');
  if (x.avisos !== undefined && !(Array.isArray(x.avisos) && x.avisos.every(esTexto))) {
    throw new Error('avisos inválidos');
  }
  e.avisos = (x.avisos as string[] | undefined) ?? [];
  for (const [k, v] of Object.entries(porLab(x.copias, 'copias', esObjeto))) {
    if (!e.base) throw new Error('hay copias sin base');
    e.copias[k as Lab] = docValido(v, `copia ${k}`);
  }
  for (const [k, v] of Object.entries(porLab(x.motivos, 'motivos', esObjeto))) {
    e.motivos[k as Lab] = registro(v, `motivos.${k}`, esTexto);
  }
  e.decisiones = registro(x.decisiones, 'decisiones', esDecision);
  e.decisionesDescartadas = porLab(x.decisionesDescartadas, 'decisionesDescartadas', esConteo);
  return e;
}

export interface EstadoCargado {
  estado: EstadoDemo;
  /** false si localStorage no está disponible. */
  persistente: boolean;
  /** Presente si había un estado guardado ilegible o inválido (se descartó). */
  aviso?: string;
}

/** Carga el estado. Nunca lanza: ante cualquier problema devuelve el estado vacío. */
export function cargarEstado(): EstadoCargado {
  let crudo: string | null;
  try {
    crudo = window.localStorage.getItem(CLAVE);
  } catch {
    return { estado: estadoVacio(), persistente: false };
  }
  if (!crudo) return { estado: estadoVacio(), persistente: true };
  try {
    return { estado: validarEstado(JSON.parse(crudo)), persistente: true };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    return {
      estado: estadoVacio(),
      persistente: true,
      aviso: `Se descartó el estado guardado de la demo porque no es válido (${motivo}). Cargue el capítulo de nuevo.`,
    };
  }
}

/** Guarda el estado; devuelve false si no se pudo (sin localStorage, cuota llena…). */
export function guardarEstado(estado: EstadoDemo): boolean {
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(estado));
    return true;
  } catch {
    return false;
  }
}

/**
 * Guarda la copia de un laboratorio. Los ids de las sugerencias dependen del contenido,
 * así que las decisiones del revisor cuyo id sigue existiendo se conservan; se descartan
 * (y se cuentan) solo las de ids desaparecidos. Un grupo (movido/unido) se decide entero:
 * si parte de sus decisiones quedó huérfana, se descartan todas las de ese grupo.
 */
export function guardarCopia(estado: EstadoDemo, lab: Lab, copia: DocJSON): void {
  const previa = estado.copias[lab];
  estado.copias[lab] = copia;
  if (previa && jsonEstable(previa) === jsonEstable(copia)) return;
  const sugerencias = estado.base ? calcularSugerencias(estado.base, copia, lab) : [];
  const vigentes = new Set(sugerencias.map((s) => s.id));
  const prefijo = `${lab}:`;
  const huerfanas = new Set(
    Object.keys(estado.decisiones).filter((id) => id.startsWith(prefijo) && !vigentes.has(id)),
  );
  // Grupos con decisiones a medias (algún miembro vigente sin decidir, o decisión huérfana).
  for (const g of new Set(sugerencias.flatMap((s) => (s.grupo ? [s.grupo] : [])))) {
    const miembros = sugerencias.filter((s) => s.grupo === g);
    const decididos = miembros.filter((s) => estado.decisiones[s.id] !== undefined);
    if (decididos.length > 0 && decididos.length < miembros.length) {
      for (const s of decididos) huerfanas.add(s.id);
    }
  }
  for (const id of huerfanas) delete estado.decisiones[id];
  if (huerfanas.size > 0) {
    estado.decisionesDescartadas[lab] = (estado.decisionesDescartadas[lab] ?? 0) + huerfanas.size;
  }
}

/** Descarta la copia de un laboratorio (vuelve a la base): también sus motivos y decisiones. */
export function descartarCopia(estado: EstadoDemo, lab: Lab): void {
  delete estado.copias[lab];
  for (const id of Object.keys(estado.motivos[lab])) delete estado.motivos[lab][id];
  borrarDecisiones(estado, lab);
}

function borrarDecisiones(estado: EstadoDemo, lab: Lab): void {
  const prefijo = `${lab}:`;
  const ids = Object.keys(estado.decisiones).filter((id) => id.startsWith(prefijo));
  for (const id of ids) delete estado.decisiones[id];
  if (ids.length > 0) estado.decisionesDescartadas[lab] = (estado.decisionesDescartadas[lab] ?? 0) + ids.length;
}

/** Lo que reciben los modos (laboratorio / revisor) desde `main.ts`. */
export interface ContextoModo {
  estado: EstadoDemo;
  /** Persiste el estado; false si no se pudo. */
  guardar: () => boolean;
}

/** Vista montada en el área principal. */
export interface Modo {
  /** `descartar`: no ofrecer guardar lo pendiente (p. ej. al cargar otro capítulo). */
  destruir: (opciones?: { descartar?: boolean }) => void;
}
