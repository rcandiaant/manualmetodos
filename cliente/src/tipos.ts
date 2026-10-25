import type { JSONContent } from '@tiptap/core';

export type DocJSON = JSONContent;

/** Offsets en tokens; `hasta` es exclusivo. */
export type Rango = { desde: number; hasta: number };

export type TipoSugerencia =
  | 'contenido'
  | 'formato'
  | 'bloque-insertado'
  | 'bloque-eliminado';

export interface Sugerencia {
  id: string;
  autor: string;
  bloqueId: string;
  base: Rango;
  copia: Rango;
  original: DocJSON[];
  propuesta: DocJSON[];
  tipo: TipoSugerencia;
  /**
   * Solo en `bloque-insertado`: número de ancestros (sin contar `doc`) de
   * `propuesta[0]` en la copia. Indica a qué nivel del ancla se inserta.
   */
  profundidad?: number;
  /** Solo en `bloque-insertado`: orden de aplicación entre las inserciones de una misma ancla (desde 0). */
  orden?: number;
  /**
   * Solo en `bloque-insertado`: bid del primer bloque existente que sigue a la
   * inserción en orden de documento en la copia; ausente si no hay ninguno.
   */
  siguiente?: string;
  /**
   * Solo en `bloque-insertado`: `propuesta[0]` pertenece a la cadena de primeros hijos
   * de un contenedor (no `doc`): en la copia, ningún hermano anterior contiene un bloque
   * existente. Se inserta justo antes del ancestro de `siguiente` de profundidad
   * `profundidad` (es decir, tras el último miembro aceptado de la misma cadena), en vez
   * de tras el ancla, que vive en otro contenedor. Lo lleva toda la cadena, no solo el
   * primer hijo, para que una aceptación parcial no cambie el contenedor (C1).
   */
  primerHijo?: true;
  /**
   * Bloque movido o unido (su bid se conserva pero cambió de tipo, contenedor u
   * orden): par `bloque-eliminado` (lugar original, contenido de la base) +
   * `bloque-insertado` (lugar nuevo, contenido de la copia, mismo `attrs.bid`) con
   * el mismo `grupo` = `mov:${bid}`. Las sugerencias de un mismo autor y grupo se
   * aceptan o rechazan juntas (`completarGrupo`).
   */
  grupo?: string;
  motivo?: string;
}
