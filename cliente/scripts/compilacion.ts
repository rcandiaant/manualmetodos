/** Compilación con pdflatex sobre el marco de prueba; compartida por `verificar` y `escala`. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extraerReferenciasIndefinidas } from './log-latex';

const TIMEOUT_MS = 60_000;

export interface Compilacion {
  ok: boolean;
  sinResolver: string[];
  detalle?: string;
}

/** Compila `<nombre>.tex` (en `directorio`, junto a `marco-prueba.tex`) dos veces con el marco; cuenta `\ref` sin resolver. */
export function compilar(directorio: string, nombre: string): Compilacion {
  const args = [
    '-interaction=nonstopmode',
    '-halt-on-error',
    '-max-print-line=10000',
    `-jobname=${nombre}`,
    `\\def\\capitulo{${nombre}}\\input{marco-prueba}`,
  ];
  for (let pasada = 1; pasada <= 2; pasada++) {
    const r = spawnSync('pdflatex', args, { cwd: directorio, timeout: TIMEOUT_MS, encoding: 'utf8' });
    if (r.error || r.status !== 0) {
      const detalle = r.error ? String(r.error.message) : `pdflatex salió con código ${r.status} (pasada ${pasada})`;
      return { ok: false, sinResolver: [], detalle };
    }
  }
  const log = readFileSync(join(directorio, `${nombre}.log`), 'utf8');
  return { ok: true, sinResolver: extraerReferenciasIndefinidas(log) };
}
