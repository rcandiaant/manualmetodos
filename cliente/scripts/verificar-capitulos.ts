/**
 * Verifica importar → exportar contra los capítulos reales del manual.
 * Uso: npm run verificar [-- --sin-compilar]
 * Lee ../manual-fuente/tex/*.tex; escribe ../manual-fuente/_reportes/ (fuera de git).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importarLatex } from '../src/latex/importar';
import { exportarLatex } from '../src/latex/exportar';
import { compararLatex } from '../src/latex/normalizar';
import { validarDocumento } from '../src/esquema/esquema';
import type { DocJSON } from '../src/tipos';
import { extraerReferenciasIndefinidas } from './log-latex';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');
const FUENTE = join(RAIZ, 'manual-fuente', 'tex');
const REPORTES = join(RAIZ, 'manual-fuente', '_reportes');
const EXPORTADOS = join(REPORTES, 'exportados');
const COMPILACION = join(REPORTES, 'compilacion');
const MARCO = resolve(AQUI, '..', 'herramientas', 'marco-prueba.tex');
const TIMEOUT_MS = 60_000;

const sinCompilar = process.argv.includes('--sin-compilar');

/** Justificación de los `especial` esperados, por capítulo (clave: nombre sin extensión). */
const ESPERADOS: Record<string, number> = { 'NITRÓGENO1.1': 1 };
const JUSTIFICADOS: Record<string, string> = {
  'NITRÓGENO1.1': 'Fuente con `\\label{` sin cerrar (línea 25): el grupo abierto se conserva como un único `especial`.',
};

interface Especial {
  tipo: string;
  latex: string;
}

function especiales(n: DocJSON, acc: Especial[] = []): Especial[] {
  if ((n.type === 'especial' || n.type === 'especialInline') && typeof n.attrs?.latex === 'string') {
    acc.push({ tipo: n.type, latex: n.attrs.latex });
  }
  if (n.type === 'notaPie' && Array.isArray(n.attrs?.bloques)) {
    for (const b of n.attrs.bloques as DocJSON[]) especiales(b, acc);
  }
  for (const h of n.content ?? []) especiales(h, acc);
  return acc;
}

interface Compilacion {
  ok: boolean;
  sinResolver: string[];
  detalle?: string;
}

/** Compila `<nombre>.tex` (en COMPILACION) dos veces con el marco; cuenta `\ref` sin resolver. */
function compilar(nombre: string): Compilacion {
  const args = [
    '-interaction=nonstopmode',
    '-halt-on-error',
    '-max-print-line=10000',
    `-jobname=${nombre}`,
    `\\def\\capitulo{${nombre}}\\input{marco-prueba}`,
  ];
  for (let pasada = 1; pasada <= 2; pasada++) {
    const r = spawnSync('pdflatex', args, { cwd: COMPILACION, timeout: TIMEOUT_MS, encoding: 'utf8' });
    if (r.error || r.status !== 0) {
      const detalle = r.error ? String(r.error.message) : `pdflatex salió con código ${r.status} (pasada ${pasada})`;
      return { ok: false, sinResolver: [], detalle };
    }
  }
  const log = readFileSync(join(COMPILACION, `${nombre}.log`), 'utf8');
  return { ok: true, sinResolver: extraerReferenciasIndefinidas(log) };
}

interface Fila {
  capitulo: string;
  a: boolean;
  errorA?: string;
  b: boolean;
  errorB?: string;
  especiales: Especial[];
  d: boolean;
  difD?: string;
  e?: boolean;
  detalleE?: string;
  refsOrig?: string[];
  refsExp?: string[];
}

const marca = (v: boolean | undefined) => (v === undefined ? '-' : v ? 'ok' : 'FALLA');
const celda = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function main(): number {
  mkdirSync(EXPORTADOS, { recursive: true });
  if (!sinCompilar) {
    rmSync(COMPILACION, { recursive: true, force: true });
    mkdirSync(COMPILACION, { recursive: true });
    copyFileSync(MARCO, join(COMPILACION, 'marco-prueba.tex'));
  }
  const archivos = readdirSync(FUENTE)
    .filter((f) => f.endsWith('.tex'))
    .sort((x, y) => x.localeCompare(y));
  const filas: Fila[] = [];

  archivos.forEach((archivo, idx) => {
    const capitulo = archivo.replace(/\.tex$/, '');
    const original = readFileSync(join(FUENTE, archivo), 'utf8');
    const fila: Fila = { capitulo, a: false, b: false, especiales: [], d: false };
    filas.push(fila);
    let doc: DocJSON;
    try {
      doc = importarLatex(original).doc;
      fila.a = true;
    } catch (e) {
      fila.errorA = e instanceof Error ? e.message : String(e);
      return;
    }
    const val = validarDocumento(doc);
    fila.b = val.ok;
    if (!val.ok) fila.errorB = val.error;
    fila.especiales = especiales(doc);
    let exportado = '';
    try {
      exportado = exportarLatex(doc);
    } catch (e) {
      fila.difD = `exportar lanzó: ${e instanceof Error ? e.message : String(e)}`;
      return;
    }
    writeFileSync(join(EXPORTADOS, archivo), exportado, 'utf8');
    const cmp = compararLatex(original, exportado);
    fila.d = cmp.igual;
    if (!cmp.igual && cmp.primeraDiferencia) {
      const { posicion, a, b } = cmp.primeraDiferencia;
      fila.difD = `pos ${posicion}: original «${a}» / exportado «${b}»`;
    }
    if (!sinCompilar) {
      const id = String(idx + 1).padStart(2, '0');
      writeFileSync(join(COMPILACION, `orig${id}.tex`), original, 'utf8');
      writeFileSync(join(COMPILACION, `exp${id}.tex`), exportado, 'utf8');
      const co = compilar(`orig${id}`);
      const ce = compilar(`exp${id}`);
      fila.e = co.ok && ce.ok;
      fila.detalleE = [co.ok ? '' : `original: ${co.detalle}`, ce.ok ? '' : `exportado: ${ce.detalle}`]
        .filter(Boolean)
        .join('; ');
      if (co.ok) fila.refsOrig = co.sinResolver;
      if (ce.ok) fila.refsExp = ce.sinResolver;
    }
    console.log(`${capitulo}: a=${marca(fila.a)} b=${marca(fila.b)} d=${marca(fila.d)} e=${marca(fila.e)}`);
  });

  const fOk = (f: Fila) =>
    sinCompilar ||
    (f.refsOrig !== undefined && f.refsExp !== undefined && f.refsOrig.join('|') === f.refsExp.join('|'));
  const cOk = (f: Fila) => f.especiales.length === (ESPERADOS[f.capitulo] ?? 0);
  const total = filas.length;
  const cuenta = (p: (f: Fila) => boolean) => filas.filter(p).length;
  const cA = cuenta((f) => f.a);
  const cB = cuenta((f) => f.b);
  const cD = cuenta((f) => f.d);
  const cE = cuenta((f) => f.e === true);
  const cF = cuenta(fOk);

  const L: string[] = [];
  L.push('# Verificación contra los capítulos reales', '');
  L.push(`Fecha: ${new Date().toISOString()}`, '');
  L.push(
    sinCompilar
      ? 'Modo `--sin-compilar`: (e) y (f) no se evaluaron.'
      : 'Compilación: `pdflatex -interaction=nonstopmode -halt-on-error`, dos pasadas, sobre `herramientas/marco-prueba.tex`.',
    '',
  );
  L.push('| capítulo | (a) importa | (b) válido | (c) especiales | (d) LaTeX igual | (e) compila | (f) refs sin resolver (orig/exp) |');
  L.push('|---|---|---|---|---|---|---|');
  for (const f of filas) {
    const esp = f.especiales.length ? `${f.especiales.length}${JUSTIFICADOS[f.capitulo] ? ' (justificado)' : ''}${cOk(f) ? '' : ' FALLA'}` : '0';
    const refs = sinCompilar
      ? '-'
      : f.refsOrig === undefined || f.refsExp === undefined
        ? 'n/d'
        : `${f.refsOrig.length}/${f.refsExp.length}${fOk(f) ? '' : ' FALLA'}`;
    L.push(`| ${f.capitulo} | ${marca(f.a)} | ${marca(f.b)} | ${esp} | ${marca(f.d)} | ${marca(f.e)} | ${refs} |`);
  }
  L.push('', '## Totales', '');
  L.push(`- (a) importa sin excepción: ${cA}/${total}`);
  L.push(`- (b) validarDocumento ok: ${cB}/${total}`);
  L.push(`- (c) cantidad de especiales como se esperaba: ${cuenta(cOk)}/${total}`);
  L.push(`- (d) LaTeX normalizado igual: ${cD}/${total}`);
  L.push(sinCompilar ? '- (e) compila: no evaluado' : `- (e) original y exportado compilan: ${cE}/${total}`);
  L.push(sinCompilar ? '- (f) refs sin resolver coinciden: no evaluado' : `- (f) refs sin resolver coinciden: ${cF}/${total}`);
  const conEsp = filas.filter((f) => f.especiales.length);
  L.push('', '## (c) Especiales', '');
  if (!conEsp.length) L.push('Ninguno.');
  for (const f of conEsp) {
    L.push(`- **${f.capitulo}**: ${f.especiales.length}. ${JUSTIFICADOS[f.capitulo] ?? '**SIN JUSTIFICAR**'}`);
    for (const e of f.especiales) L.push(`  - \`${e.tipo}\`, ${e.latex.length} caracteres`);
  }
  const fallos = filas.filter((f) => !f.a || !f.b || !f.d || !cOk(f) || (!sinCompilar && !f.e) || !fOk(f));
  L.push('', '## Detalle de fallos', '');
  if (!fallos.length) L.push('Ninguno.');
  for (const f of fallos) {
    const m: string[] = [];
    if (f.errorA) m.push(`(a) ${celda(f.errorA)}`);
    if (f.errorB) m.push(`(b) ${celda(f.errorB)}`);
    if (!cOk(f)) m.push(`(c) ${f.especiales.length} especiales, se esperaban ${ESPERADOS[f.capitulo] ?? 0}`);
    if (!f.d && f.difD) m.push(`(d) ${celda(f.difD)}`);
    if (f.detalleE) m.push(`(e) ${celda(f.detalleE)}`);
    if (!fOk(f)) m.push(`(f) original [${(f.refsOrig ?? []).join(', ')}] / exportado [${(f.refsExp ?? []).join(', ')}]`);
    L.push(`- **${f.capitulo}**: ${m.join(' | ')}`);
  }
  writeFileSync(join(REPORTES, 'verificacion.md'), L.join('\n') + '\n', 'utf8');
  console.log(
    `\n(a) ${cA}/${total}  (b) ${cB}/${total}  (d) ${cD}/${total}  (e) ${sinCompilar ? 'n/e' : `${cE}/${total}`}  (f) ${sinCompilar ? 'n/e' : `${cF}/${total}`}`,
  );
  console.log(`Reporte: ${join(REPORTES, 'verificacion.md')}`);
  return fallos.length === 0 && total > 0 ? 0 : 1;
}

if (!existsSync(FUENTE)) {
  console.error(`No existe ${FUENTE}`);
  process.exit(1);
}
process.exitCode = main();
