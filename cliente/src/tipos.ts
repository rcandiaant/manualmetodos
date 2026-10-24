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
  motivo?: string;
}
