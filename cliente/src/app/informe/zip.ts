/**
 * Armado del `.zip` con el `.tex` final de cada capítulo (`GET /capitulos/{id}/final`).
 *
 * - Un 404 (`no_encontrado`) cuenta como capítulo sin versión final: no se omite en silencio,
 *   queda en `faltantes` y el `.zip` lleva `FALTANTES.txt` con un título por línea.
 * - Cualquier otro error se propaga (no se entrega un `.zip` incompleto sin que se sepa).
 * - Nombres de `nombreTex`; si dos chocan, el segundo recibe el sufijo `-2` (luego `-3`…).
 * - Textos en UTF-8 con LF. `fflate` se importa al armar, para no engrosar el paquete principal.
 */
import { ErrorApi, type Api } from '../api';
import { nombreTex } from '../revisor/nombres';
import type { Final } from '../tipos-api';

export interface CapituloZip {
  id: number;
  slug?: string;
  titulo: string;
}

export interface ResultadoZip {
  zip: Uint8Array;
  incluidos: string[];
  faltantes: string[];
}

const PETICIONES = 4;

const lf = (t: string) => t.replace(/\r\n?/g, '\n');

/** Evita nombres repetidos: `cap-1.tex` ya usado pasa a `cap-1-2.tex`. */
function nombreUnico(nombre: string, usados: Set<string>): string {
  let candidato = nombre;
  for (let n = 2; usados.has(candidato); n++) candidato = nombre.replace(/\.tex$/, `-${n}.tex`);
  usados.add(candidato);
  return candidato;
}

export async function armarZipFinales(api: Api, capitulos: CapituloZip[]): Promise<ResultadoZip> {
  // Pide los finales con pocas peticiones a la vez, conservando el orden de los capítulos.
  const textos: (string | null)[] = new Array(capitulos.length).fill(null);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < capitulos.length) {
      const i = siguiente++;
      try {
        textos[i] = (await api.get<Final>(`/capitulos/${capitulos[i].id}/final`)).tex;
      } catch (e) {
        if (!(e instanceof ErrorApi && e.estado === 404)) throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PETICIONES, capitulos.length) }, trabajador));

  // `new Uint8Array(...)` en el realm actual: `fflate` descarta como carpeta lo que no sea su `Uint8Array`.
  const codificar = { encode: (t: string) => new Uint8Array(new TextEncoder().encode(t)) };
  const usados = new Set<string>(['FALTANTES.txt']);
  const archivos: Record<string, Uint8Array> = {};
  const incluidos: string[] = [];
  const faltantes: string[] = [];
  capitulos.forEach((c, i) => {
    const tex = textos[i];
    if (tex === null) {
      faltantes.push(c.titulo);
      return;
    }
    const nombre = nombreUnico(nombreTex(c.slug, c.titulo, c.id), usados);
    archivos[nombre] = codificar.encode(lf(tex));
    incluidos.push(nombre);
  });
  if (faltantes.length > 0) archivos['FALTANTES.txt'] = codificar.encode(faltantes.map(lf).join('\n') + '\n');

  const { zipSync } = await import('fflate');
  return { zip: zipSync(archivos), incluidos, faltantes };
}
