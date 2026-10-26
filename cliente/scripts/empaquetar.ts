/**
 * Arma el paquete de producción para el hosting cPanel (sin SSH): un `.zip` con el servidor
 * PHP y la SPA compilada, y un `.sql` con las migraciones para importar en phpMyAdmin.
 * Sigue el checklist de despliegue de docs/api.md §6.
 *
 * Uso (desde cliente/, con Docker disponible):
 *   npm run empaquetar                     # exige el árbol de git limpio
 *   npm run empaquetar -- --permitir-sucio # solo avisa si hay cambios sin commit
 *
 * Variable opcional: EMPAQUETAR_COMPOSE_PROYECTO, nombre del proyecto de Docker Compose
 * (`docker compose -p <nombre>`) con el que se corre el servicio `composer`. Por omisión se usa
 * el de compose.yaml (`manualmetodos`).
 *
 * Pasos: git limpio → `npm run build` → `composer install --no-dev` → `dist/paquete/manualmetodos/`
 * → `dist/manualmetodos-AAAAMMDD-<sha7>.zip` y `.sql` → (siempre) `composer install` de desarrollo.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, type Zippable } from 'fflate';

/* ---------- Funciones puras (probadas en tests/empaquetar.test.ts) ---------- */

/** Archivos que el paquete debe traer sí o sí (rutas relativas a la carpeta del paquete). */
export const OBLIGATORIOS = [
  'public/index.php',
  'public/.htaccess',
  'public/index.html',
  'vendor/autoload.php',
  'migraciones/001_inicial.sql',
] as const;

const EJEMPLO_ENV = '.env.produccion.example';

/** Motivo por el que una ruta no puede viajar en el paquete, o null si puede. */
function motivoProhibido(ruta: string): string | null {
  const partes = ruta.split('/');
  for (const parte of partes) {
    if (parte === 'tests') return 'pruebas (tests/)';
    if (parte.toLowerCase().includes('phpunit')) return 'phpunit';
    if ((parte === '.env' || parte.startsWith('.env.')) && parte !== EJEMPLO_ENV) return 'archivo .env';
    if (parte === 'var') return 'datos locales (var/)';
    if (parte === 'manual-fuente') return 'contenido del manual (manual-fuente/)';
    if (parte === 'node_modules') return 'node_modules';
    if (parte === '.git') return 'repositorio git (.git)';
  }
  const nombre = partes[partes.length - 1] ?? '';
  if (nombre.endsWith('.map')) return 'source map';
  if (nombre === 'composer.lock') return 'composer.lock (no hace falta en el hosting)';
  return null;
}

/** Errores del paquete (vacío si está bien): faltan obligatorios o viaja algo prohibido. */
export function validarPaquete(archivos: string[]): string[] {
  const rutas = archivos.map((r) => r.replaceAll('\\', '/').replace(/^\.\//, ''));
  const presentes = new Set(rutas);
  const errores: string[] = [];
  for (const obligatorio of OBLIGATORIOS) {
    if (!presentes.has(obligatorio)) errores.push(`falta ${obligatorio}`);
  }
  for (const ruta of rutas) {
    const motivo = motivoProhibido(ruta);
    if (motivo) errores.push(`no debe viajar ${ruta}: ${motivo}`);
  }
  return errores;
}

/** Todos los archivos bajo `raiz`, con rutas relativas, barras `/` y orden estable. */
export function listaPaquete(raiz: string): string[] {
  const salida: string[] = [];
  const recorrer = (carpeta: string): void => {
    for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
      const ruta = join(carpeta, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else if (entrada.isFile()) salida.push(relative(raiz, ruta).split(sep).join('/'));
    }
  };
  recorrer(raiz);
  return salida.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * `manualmetodos-AAAAMMDD-<sha7>.<ext>`, con la fecha de Santiago (la del equipo que despliega).
 * Con el árbol sucio lleva `-sucio`: el contenido no corresponde a ese commit y no se entrega.
 */
export function nombrePaquete(fecha: Date, sha: string, ext: 'zip' | 'sql', sucio = false): string {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error(`sha de git inválido: ${sha}`);
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(fecha);
  const valor = (tipo: string): string => partes.find((p) => p.type === tipo)?.value ?? '';
  return `manualmetodos-${valor('year')}${valor('month')}${valor('day')}-${sha.slice(0, 7).toLowerCase()}${sucio ? '-sucio' : ''}.${ext}`;
}

/** Cabecera comentada del `.sql`: cómo importarlo en phpMyAdmin (docs/api.md §6, «Base de datos»). */
export function cabeceraSql(base: string, migraciones: string[]): string {
  return [
    `-- ${base}.sql — esquema de la plataforma de consulta del Manual de métodos`,
    '--',
    '-- Cómo importarlo (docs/api.md §6, «Base de datos»):',
    '--   1. cPanel → phpMyAdmin, con el usuario de cPanel (tiene CREATE; el usuario de la app no).',
    '--   2. Elegir la base de la app en la columna izquierda → pestaña «Importar».',
    '--   3. Subir este archivo TAL CUAL: conjunto de caracteres del archivo utf-8, sin convertir',
    '--      ni cambiar el charset de la base (MariaDB 10.6 usa latin1 por defecto, pero cada',
    '--      tabla declara utf8mb4 y los identificadores utf8mb4_bin).',
    '--   4. Re-importarlo no hace daño (CREATE TABLE IF NOT EXISTS, INSERT IGNORE).',
    '--   5. Después, el primer administrador con bin/crear-admin.php --sql (docs/api.md §5).',
    '--',
    `-- Migraciones incluidas, en orden: ${migraciones.join(', ')}`,
    '',
  ].join('\n');
}

/* ---------- Script ---------- */

const AQUI = dirname(fileURLToPath(import.meta.url));
const CLIENTE = resolve(AQUI, '..');
const RAIZ = resolve(CLIENTE, '..');
const SERVIDOR = join(RAIZ, 'servidor');
const DIST = join(RAIZ, 'dist');
const PAQUETE = join(DIST, 'paquete', 'manualmetodos');

class FalloEmpaquetar extends Error {}

function ejecutar(comando: string, args: string[], cwd: string, opciones: { shell?: boolean } = {}): void {
  console.log(`\n$ ${comando} ${args.join(' ')}`);
  // Con shell, Node pide el comando ya armado (los argumentos son fijos de este script).
  const r = opciones.shell
    ? spawnSync([comando, ...args].join(' '), { cwd, stdio: 'inherit', shell: true })
    : spawnSync(comando, args, { cwd, stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    throw new FalloEmpaquetar(`${comando} ${args.join(' ')} falló (${r.error?.message ?? `código ${r.status}`})`);
  }
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: RAIZ, encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new FalloEmpaquetar(`git ${args.join(' ')} falló: ${r.error?.message ?? r.stderr}`);
  return r.stdout.trimEnd();
}

/** `compose [-p <EMPAQUETAR_COMPOSE_PROYECTO>] --profile herramientas run --rm composer install`. */
function argsComposer(): string[] {
  const proyecto = process.env.EMPAQUETAR_COMPOSE_PROYECTO?.trim();
  return [...(proyecto ? ['compose', '-p', proyecto] : ['compose']), '--profile', 'herramientas', 'run', '--rm', 'composer', 'install'];
}

function composer(args: string[]): void {
  ejecutar('docker', [...argsComposer(), ...args], RAIZ);
}

function tamano(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} kB`;
}

function armarCarpeta(): void {
  // Se vacía la carpeta en vez de borrarla: así el contenedor `paquete` (que la monta) ve el paquete
  // nuevo sin recrearlo.
  mkdirSync(PAQUETE, { recursive: true });
  for (const entrada of readdirSync(PAQUETE)) rmSync(join(PAQUETE, entrada), { recursive: true, force: true });
  mkdirSync(join(PAQUETE, 'public'), { recursive: true });
  for (const carpeta of ['bin', 'config', 'migraciones', 'src', 'vendor']) {
    cpSync(join(SERVIDOR, carpeta), join(PAQUETE, carpeta), { recursive: true });
  }
  cpSync(join(SERVIDOR, 'composer.json'), join(PAQUETE, 'composer.json'));
  cpSync(join(SERVIDOR, EJEMPLO_ENV), join(PAQUETE, EJEMPLO_ENV));
  for (const archivo of ['index.php', '.htaccess']) {
    cpSync(join(SERVIDOR, 'public', archivo), join(PAQUETE, 'public', archivo));
  }
  cpSync(join(CLIENTE, 'dist'), join(PAQUETE, 'public'), { recursive: true });
}

function escribirZip(archivos: string[], destino: string): void {
  const contenido: Zippable = {};
  for (const ruta of archivos) {
    const absoluta = join(PAQUETE, ...ruta.split('/'));
    contenido[`manualmetodos/${ruta}`] = [new Uint8Array(readFileSync(absoluta)), { mtime: statSync(absoluta).mtime }];
  }
  writeFileSync(destino, zipSync(contenido, { level: 9 }));
}

function escribirSql(destino: string, base: string): string[] {
  const carpeta = join(SERVIDOR, 'migraciones');
  const migraciones = readdirSync(carpeta).filter((n) => n.endsWith('.sql')).sort();
  if (migraciones.length === 0) throw new FalloEmpaquetar('no hay migraciones en servidor/migraciones');
  const partes = [cabeceraSql(base, migraciones)];
  for (const nombre of migraciones) {
    // Sin BOM y con LF: el .sql sale igual en cualquier máquina (con autocrlf la migración trae CRLF).
    const sql = readFileSync(join(carpeta, nombre), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    partes.push(`\n-- ==== ${nombre} ====\n\n${sql.endsWith('\n') ? sql : `${sql}\n`}`);
  }
  writeFileSync(destino, partes.join(''), 'utf8');
  return migraciones;
}

function resumen(zip: string, sql: string, archivos: string[]): void {
  const porCarpeta = new Map<string, number>();
  for (const ruta of archivos) {
    const primera = ruta.includes('/') ? `${ruta.split('/')[0]}/` : ruta;
    porCarpeta.set(primera, (porCarpeta.get(primera) ?? 0) + 1);
  }
  console.log('\n== Paquete listo');
  console.log(`  ${relative(RAIZ, zip)}  ${tamano(statSync(zip).size)}  (${archivos.length} archivos)`);
  console.log(`  ${relative(RAIZ, sql)}  ${tamano(statSync(sql).size)}`);
  console.log('  Contenido de manualmetodos/:');
  for (const [nombre, n] of [...porCarpeta].sort()) console.log(`    ${nombre.padEnd(28)} ${n} archivo${n === 1 ? '' : 's'}`);
  console.log(`  Carpeta sin comprimir: ${relative(RAIZ, PAQUETE)}`);
}

function main(): void {
  const permitirSucio = process.argv.includes('--permitir-sucio');

  console.log('== 1. Árbol de git');
  const cambios = git(['status', '--porcelain']);
  if (cambios !== '') {
    const aviso = `el árbol de git tiene cambios sin commit:\n${cambios}`;
    if (!permitirSucio) throw new FalloEmpaquetar(`${aviso}\n(usa --permitir-sucio para empaquetar igual)`);
    console.warn(`  AVISO: ${aviso}\n  El paquete lleva esos cambios: se nombra <sha>-sucio y NO se entrega.`);
  } else {
    console.log('  limpio');
  }
  const sucio = cambios !== '';
  const sha = git(['rev-parse', 'HEAD']);
  const fecha = new Date();

  console.log('\n== 2. Compilación del cliente');
  // npm es npm.cmd en Windows: hace falta shell (comando fijo, sin datos externos).
  ejecutar('npm', ['run', 'build'], CLIENTE, { shell: true });
  if (!existsSync(join(CLIENTE, 'dist', 'index.html'))) throw new FalloEmpaquetar('npm run build no dejó cliente/dist/index.html');

  let fallo: unknown = null;
  let terminado: { zip: string; sql: string; archivos: string[] } | null = null;
  try {
    console.log('\n== 3. vendor de producción (sin dependencias de desarrollo)');
    composer(['--no-dev', '--optimize-autoloader', '--classmap-authoritative']);

    console.log('\n== 4. Carpeta del paquete');
    armarCarpeta();
    const archivos = listaPaquete(PAQUETE);
    const errores = validarPaquete(archivos);
    if (errores.length > 0) throw new FalloEmpaquetar(`el paquete no es válido:\n  - ${errores.join('\n  - ')}`);
    console.log(`  ${archivos.length} archivos, validado`);

    console.log('\n== 5. .zip');
    const zip = join(DIST, nombrePaquete(fecha, sha, 'zip', sucio));
    escribirZip(archivos, zip);

    console.log('\n== 6. .sql');
    const sql = join(DIST, nombrePaquete(fecha, sha, 'sql', sucio));
    escribirSql(sql, nombrePaquete(fecha, sha, 'sql', sucio).replace(/\.sql$/, ''));
    terminado = { zip, sql, archivos };
  } catch (e) {
    fallo = e;
  } finally {
    console.log('\n== 7. Restaurar el vendor de desarrollo');
    try {
      composer([]);
    } catch (e) {
      console.error(`  ERROR: no se pudo restaurar el vendor de desarrollo: ${(e as Error).message}`);
      console.error(`  Restaurarlo a mano: docker ${argsComposer().join(' ')}`);
      fallo ??= e;
    }
  }
  if (fallo) throw fallo;
  if (terminado) resumen(terminado.zip, terminado.sql, terminado.archivos);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`\nEMPAQUETAR FALLÓ: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
