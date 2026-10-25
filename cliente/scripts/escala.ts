/**
 * Mide el motor de cambios a escala: N laboratorios x K ediciones sobre capítulos reales.
 * Uso: npm run escala -- [capitulo] [--labs 35] [--ediciones 8] [--semilla 1] [--sin-compilar]
 * Lee ../manual-fuente/tex/*.tex; escribe ../manual-fuente/_reportes/escala.md (fuera de git).
 */
import { appendFileSync, copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Node } from '@tiptap/pm/model';
import { aplicarSugerencias, completarGrupo } from '../src/cambios/aplicar';
import { detectarConflictos } from '../src/cambios/conflictos';
import { ANCLA_INICIO, calcularSugerencias } from '../src/cambios/sugerencias';
import { esquemaManual, validarDocumento } from '../src/esquema/esquema';
import { exportarLatex } from '../src/latex/exportar';
import { importarLatex } from '../src/latex/importar';
import type { DocJSON, Sugerencia } from '../src/tipos';
import { MUTACIONES, prng } from '../tests/ayudantes-mutacion';
import { compilar } from './compilacion';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');
const FUENTE = join(RAIZ, 'manual-fuente', 'tex');
const REPORTES = join(RAIZ, 'manual-fuente', '_reportes');
const COMPILACION = join(REPORTES, 'compilacion-escala');
const MARCO = resolve(AQUI, '..', 'herramientas', 'marco-prueba.tex');
const LIMITE_MS = 2000;

const args = process.argv.slice(2);
const opcion = (nombre: string, defecto: number): number => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? Number(args[i + 1]) : defecto;
};
const entero = (nombre: string, defecto: number, minimo: number): number => {
  const v = opcion(nombre, defecto);
  if (!Number.isInteger(v) || v < minimo) {
    console.error(`--${nombre} debe ser un entero >= ${minimo}`);
    process.exit(1);
  }
  return v;
};
const LABS = entero('labs', 35, 1);
const EDICIONES = entero('ediciones', 8, 1);
const SEMILLA = entero('semilla', 1, 0);
const sinCompilar = args.includes('--sin-compilar');
const conValor = new Set(['--labs', '--ediciones', '--semilla']);
const pedido = args.find((a, i) => !a.startsWith('--') && !conValor.has(args[i - 1] ?? ''));

const normalizar = (d: DocJSON): DocJSON => Node.fromJSON(esquemaManual, d).toJSON() as DocJSON;
const ms = (t0: number) => Math.round(performance.now() - t0);

interface Fila {
  capitulo: string;
  sugerencias: number;
  conflictos: number;
  /** Laboratorios distintos con propuesta por bloque (sin el ancla de inicio): percentil 50, 90 y máximo. */
  labsP50: number;
  labsP90: number;
  labsMax: number;
  /** Propuestas distintas por bloque tras colapsar las idénticas (tipo+original+propuesta). */
  propsMax: number;
  /** % de bloques con más de 5 laboratorios distintos / más de 5 propuestas distintas. */
  pctLabs5: number;
  pctProps5: number;
  /** Sugerencias anclas (sin colapsar) en el bloque con más; incluye inserciones ancladas. */
  ancladasMax: number;
  msSugerencias: number;
  msConflictos: number;
  msDecidir: number;
  msAplicar: number;
  total: number;
  lanza?: string;
  compila?: boolean;
  detalle?: string;
}

const filaVacia = (capitulo: string): Fila => ({
  capitulo, sugerencias: 0, conflictos: 0, labsP50: 0, labsP90: 0, labsMax: 0, propsMax: 0,
  pctLabs5: 0, pctProps5: 0, ancladasMax: 0, msSugerencias: 0, msConflictos: 0, msDecidir: 0, msAplicar: 0, total: 0,
});

/** Por conflicto gana un autor (rotando): se aceptan todas sus sugerencias del conflicto y se rechazan las demás. */
function decidir(todas: Sugerencia[], conflictos: ReturnType<typeof detectarConflictos>): Sugerencia[] {
  const porId = new Map(todas.map((s) => [s.id, s]));
  const rechazadas = new Set<string>();
  conflictos.forEach((c, i) => {
    const miembros = c.ids.map((id) => porId.get(id)!);
    const autores = [...new Set(miembros.map((s) => s.autor))].sort();
    const gana = autores[i % autores.length];
    for (const s of miembros) if (s.autor !== gana) rechazadas.add(s.id);
  });
  const aceptadas = todas.filter((s) => !rechazadas.has(s.id));
  return completarGrupo(aceptadas, todas, todas.filter((s) => rechazadas.has(s.id)));
}

function medir(archivo: string, idx: number): Fila {
  const fila = filaVacia(archivo.replace(/\.tex$/, ''));
  const base = normalizar(importarLatex(readFileSync(join(FUENTE, archivo), 'utf8')).doc);
  const az = prng(SEMILLA * 100003 + idx);
  const copias: DocJSON[] = [];
  for (let l = 0; l < LABS; l++) {
    const crudo = structuredClone(base);
    for (let m = 0; m < EDICIONES; m++) az.elegir(MUTACIONES)(az, crudo);
    const copia = normalizar(crudo);
    const v = validarDocumento(copia);
    if (!v.ok) throw new Error(`copia ${l} inválida: ${v.error}`);
    copias.push(copia);
  }

  let t0 = performance.now();
  const todas = copias.flatMap((c, l) => calcularSugerencias(base, c, `lab${String(l + 1).padStart(2, '0')}`));
  fila.msSugerencias = ms(t0);
  fila.sugerencias = todas.length;
  const porBloque = new Map<string, { n: number; labs: Set<string>; props: Set<string> }>();
  for (const s of todas) {
    if (s.bloqueId === ANCLA_INICIO) continue;
    const e = porBloque.get(s.bloqueId) ?? { n: 0, labs: new Set<string>(), props: new Set<string>() };
    e.n++;
    e.labs.add(s.autor);
    e.props.add(JSON.stringify([s.tipo, s.original, s.propuesta]));
    porBloque.set(s.bloqueId, e);
  }
  const labsPorBloque = [...porBloque.values()].map((e) => e.labs.size).sort((x, y) => x - y);
  const pct = (xs: number[], q: number) => (xs.length === 0 ? 0 : xs[Math.min(xs.length - 1, Math.floor(q * xs.length))]);
  fila.labsP50 = pct(labsPorBloque, 0.5);
  fila.labsP90 = pct(labsPorBloque, 0.9);
  fila.labsMax = labsPorBloque[labsPorBloque.length - 1] ?? 0;
  const bloques = porBloque.size || 1;
  fila.pctLabs5 = Math.round((100 * labsPorBloque.filter((n) => n > 5).length) / bloques);
  fila.pctProps5 = Math.round((100 * [...porBloque.values()].filter((e) => e.props.size > 5).length) / bloques);
  for (const e of porBloque.values()) {
    fila.propsMax = Math.max(fila.propsMax, e.props.size);
    fila.ancladasMax = Math.max(fila.ancladasMax, e.n);
  }

  t0 = performance.now();
  const conflictos = detectarConflictos(todas);
  fila.msConflictos = ms(t0);
  fila.conflictos = conflictos.length;

  let aplicado: DocJSON | undefined;
  try {
    t0 = performance.now();
    const aceptadas = decidir(todas, conflictos);
    fila.msDecidir = ms(t0);
    t0 = performance.now();
    aplicado = aplicarSugerencias(base, aceptadas);
    fila.msAplicar = ms(t0);
  } catch (e) {
    fila.lanza = e instanceof Error ? e.message : String(e);
  }
  fila.total = fila.msSugerencias + fila.msConflictos + fila.msDecidir + fila.msAplicar;

  if (aplicado && !sinCompilar) {
    const id = `esc${String(idx + 1).padStart(2, '0')}`;
    try {
      writeFileSync(join(COMPILACION, `${id}.tex`), exportarLatex(aplicado), 'utf8');
      const c = compilar(COMPILACION, id);
      fila.compila = c.ok;
      if (!c.ok) fila.detalle = c.detalle;
    } catch (e) {
      fila.compila = false;
      fila.detalle = `exportar lanzó: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return fila;
}

function main(): number {
  mkdirSync(REPORTES, { recursive: true });
  if (!sinCompilar) {
    rmSync(COMPILACION, { recursive: true, force: true });
    mkdirSync(COMPILACION, { recursive: true });
    copyFileSync(MARCO, join(COMPILACION, 'marco-prueba.tex'));
  }
  const archivos = readdirSync(FUENTE)
    .filter((f) => f.endsWith('.tex'))
    .sort((x, y) => x.localeCompare(y));
  if (pedido && !archivos.some((a) => a.replace(/\.tex$/, '') === pedido.replace(/\.tex$/, ''))) {
    console.error(`No existe el capítulo «${pedido}» en ${FUENTE}`);
    return 1;
  }
  const filas: Fila[] = [];
  archivos.forEach((archivo, idx) => {
    if (pedido && archivo.replace(/\.tex$/, '') !== pedido.replace(/\.tex$/, '')) return;
    let f: Fila;
    try {
      f = medir(archivo, idx);
    } catch (e) {
      f = filaVacia(archivo.replace(/\.tex$/, ''));
      f.lanza = `preparación: ${e instanceof Error ? e.message : String(e)}`;
    }
    filas.push(f);
    console.log(`${f.capitulo}: ${f.sugerencias} sug, ${f.conflictos} confl, ${f.total} ms${f.lanza ? ' LANZA' : ''}`);
  });

  const L: string[] = [];
  L.push(`## Escala: ${LABS} laboratorios x ${EDICIONES} ediciones, semilla ${SEMILLA} (${new Date().toISOString()})`, '');
  L.push('| capítulo | sugerencias | conflictos | labs/bloque p50 | p90 | máx | % bloques >5 labs | props. distintas máx | % bloques >5 props. | sug. ancladas máx | ms calcular | ms conflictos | ms decidir | ms aplicar | ms total | compila |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const f of filas) {
    const comp = f.lanza ? 'n/d' : f.compila === undefined ? '-' : f.compila ? 'ok' : 'FALLA';
    L.push(
      `| ${f.capitulo} | ${f.sugerencias} | ${f.conflictos} | ${f.labsP50} | ${f.labsP90} | ${f.labsMax} | ${f.pctLabs5} | ${f.propsMax} | ${f.pctProps5} | ${f.ancladasMax} | ${f.msSugerencias} | ${f.msConflictos} | ${f.msDecidir} | ${f.msAplicar} | ${f.total}${f.total >= LIMITE_MS ? ' EXCEDE' : ''} | ${comp} |`,
    );
  }
  const lanzan = filas.filter((f) => f.lanza);
  const fallos = filas.filter((f) => f.compila === false);
  L.push(
    '',
    `Máximo tiempo total: ${Math.max(0, ...filas.map((f) => f.total))} ms (límite ${LIMITE_MS}). ` +
      `Compilan: ${filas.filter((f) => f.compila).length}/${filas.length}. Aplicar lanza: ${lanzan.length}/${filas.length}. ` +
      `Máx. laboratorios distintos por bloque: ${Math.max(0, ...filas.map((f) => f.labsMax))}; máx. propuestas distintas por bloque: ${Math.max(0, ...filas.map((f) => f.propsMax))}.`,
    '',
  );
  for (const f of lanzan) L.push(`- ${f.capitulo} LANZA: ${f.lanza}`);
  for (const f of fallos) L.push(`- ${f.capitulo} NO COMPILA: ${f.detalle ?? ''}`);
  L.push('');
  appendFileSync(join(REPORTES, 'escala.md'), L.join('\n') + '\n', 'utf8');
  console.log('\n' + L.join('\n'));
  return lanzan.length === 0 && fallos.length === 0 && filas.every((f) => f.total < LIMITE_MS) ? 0 : 1;
}

process.exitCode = main();
