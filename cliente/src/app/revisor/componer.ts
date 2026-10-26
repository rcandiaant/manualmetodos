/**
 * Composición de la versión final, sin DOM (spec §5.2). La usan «Componer versión final»
 * (`final.ts`) y la prueba de humo (`scripts/humo-api.ts`), así el humo prueba exactamente
 * lo mismo que el cliente.
 */
import { aplicarSugerencias, completarGrupo } from '../../cambios/aplicar';
import { validarDocumento } from '../../esquema/esquema';
import type { DocJSON } from '../../tipos';
import type { SugerenciaServidor } from '../tipos-api';
import { representantes } from './panel';

export interface Composicion {
  doc: DocJSON;
  /** Sugerencias aceptadas sobre la versión base vigente. */
  aceptadas: number;
  /** Aceptadas sobre una versión base anterior (no se aplican). */
  anteriores: number;
}

/** Sugerencias de la versión base vigente (las que no traen `versionId` se toman como vigentes). */
export const sugerenciasVigentes = (sugs: SugerenciaServidor[], versionId: number): SugerenciaServidor[] =>
  sugs.filter((s) => s.versionId === undefined || s.versionId === versionId);

/**
 * Aplica sobre la base las aceptadas vigentes. Un bloque movido va entero (si un miembro
 * quedó sin aceptar, `completarGrupo` lanza) y una propuesta idéntica de varios
 * laboratorios se aplica una sola vez (un representante por fila colapsada). Lanza si el
 * resultado no cumple el esquema.
 */
export function componerFinal(base: DocJSON, sugerencias: SugerenciaServidor[], versionId: number): Composicion {
  const vigentes = sugerenciasVigentes(sugerencias, versionId);
  const aceptadas = vigentes.filter((s) => s.estado === 'aceptada');
  const anteriores = sugerencias.filter((s) => s.estado === 'aceptada' && !vigentes.includes(s)).length;
  const completas = completarGrupo(aceptadas, vigentes, vigentes.filter((s) => s.estado !== 'aceptada'));
  const conjunto = completarGrupo(representantes(completas as SugerenciaServidor[]).sugs, vigentes);
  const doc = aplicarSugerencias(base, conjunto);
  const v = validarDocumento(doc);
  if (!v.ok) throw new Error(`el documento resultante no cumple el esquema: ${v.error}`);
  return { doc, aceptadas: aceptadas.length, anteriores };
}
