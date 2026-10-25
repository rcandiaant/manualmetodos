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
  /**
   * Solo en `bloque-insertado`: bid del primer bloque existente que sigue a la
   * inserción en orden de documento en la copia; ausente si no hay ninguno.
   */
  siguiente?: string;
  /**
   * Solo en `bloque-insertado`: `propuesta[0]` es el primer hijo de un contenedor
   * (no `doc`) y se inserta antes del ancestro de `siguiente` de profundidad
   * `profundidad`, en vez de tras el ancla.
   */
  primerHijo?: true;
  motivo?: string;
}
