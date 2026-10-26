/**
 * Prueba de humo de punta a punta contra el servidor real (PHP + MariaDB en Docker).
 *
 * Uso (desde cliente/, con el stack `manualmetodos` levantado y la base migrada):
 *   npm run humo
 * Variable opcional: HUMO_URL (por omisión http://localhost:8080). Solo se acepta localhost o
 * 127.0.0.1: el SQL de desarrollo va siempre a la base local de Docker.
 * Variables opcionales para otro stack local (p. ej. el paquete de producción en :8081, ver
 * docker/paquete/compose.paquete.yaml): HUMO_COMPOSE_PROYECTO (proyecto de Docker Compose, `-p`;
 * por omisión el de compose.yaml) y HUMO_SERVICIO_PHP (servicio donde corre bin/crear-admin.php;
 * por omisión `php`). Docker Compose respeta además COMPOSE_FILE.
 *
 * Recorre el flujo completo con las mismas funciones del cliente: `crearApi` (src/app/api.ts)
 * con un `fetch` inyectado que agrega la URL base, un frasco de cookies propio y la cabecera
 * `Origin` (Node no la manda sola y el servidor la exige en las escrituras, docs/api.md §1.2);
 * las sugerencias salen del motor real (`calcularSugerencias`) y el `.tex` de `exportarLatex`.
 *
 * Usa SQL de desarrollo (vía `docker compose exec bd`) en dos momentos, porque la API no
 * permite fechas pasadas:
 *   - al inicio, vuelve la consulta a preparación (fechas en NULL) para que la prueba se
 *     pueda repetir;
 *   - en el paso 7, adelanta el cierre para pasar a edición final.
 * Cada corrida usa correos y slug únicos, así no choca con corridas anteriores.
 *
 * NUNCA usar contra producción: el capítulo es un fixture sintético del repo.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claveGrupo, detectarConflictos } from '../src/cambios/conflictos';
import { calcularSugerencias } from '../src/cambios/sugerencias';
import { esquemaManual, validarDocumento } from '../src/esquema/esquema';
import { exportarLatex } from '../src/latex/exportar';
import { importarLatex } from '../src/latex/importar';
import { crearApi, ErrorApi, type Api } from '../src/app/api';
import { componerFinal } from '../src/app/revisor/componer';
import { esUrlLocal } from './humo-local';
import type {
  Aportes,
  Base,
  CapituloCreado,
  CapituloLista,
  Comentario,
  Consulta,
  Copia,
  CopiaEntrada,
  CuentaImportada,
  Final,
  IdCreado,
  Sesion,
  SugerenciaServidor,
  UsuarioAdmin,
} from '../src/app/tipos-api';
import type { DocJSON, Sugerencia } from '../src/tipos';
import { compilar } from './compilacion';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');
const FIXTURE = resolve(AQUI, '..', 'tests', 'fixtures', 'estructura.tex');
const MARCO = resolve(AQUI, '..', 'herramientas', 'marco-prueba.tex');
const URL_BASE = (process.env.HUMO_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
const ORIGEN = new URL(URL_BASE).origin;

/* ---------- Salida ---------- */

let pasoActual = '';
function paso(titulo: string): void {
  pasoActual = titulo;
  console.log(`\n== ${titulo}`);
}
function ok(texto: string): void {
  console.log(`  [ok] ${texto}`);
}
class FalloHumo extends Error {}
function comprobar(condicion: unknown, texto: string): asserts condicion {
  if (!condicion) throw new FalloHumo(texto);
  ok(texto);
}

/* ---------- Docker (solo desarrollo) ---------- */

/**
 * El SQL de desarrollo y `crear-admin.php` van siempre a la base del stack Docker local:
 * contra otro servidor la prueba no corre.
 */
function exigirLocal(): void {
  if (!esUrlLocal(URL_BASE)) {
    throw new FalloHumo(
      `HUMO_URL (${URL_BASE}) no es localhost ni 127.0.0.1: la prueba de humo usa SQL de desarrollo sobre la base local de Docker y no se ejecuta contra otro servidor.`,
    );
  }
}

/** Últimas líneas del .log de pdflatex, para ver la causa de un fallo. */
function colaDelLog(carpeta: string, nombre: string): string {
  try {
    const lineas = readFileSync(join(carpeta, `${nombre}.log`), 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '');
    return `\n--- final de ${nombre}.log ---\n${lineas.slice(-25).join('\n')}`;
  } catch {
    return '';
  }
}

const COMPOSE_PROYECTO = process.env.HUMO_COMPOSE_PROYECTO?.trim() ?? '';
const SERVICIO_PHP = process.env.HUMO_SERVICIO_PHP?.trim() || 'php';

function docker(args: string[]): string {
  const proyecto = COMPOSE_PROYECTO ? ['-p', COMPOSE_PROYECTO] : [];
  const r = spawnSync('docker', ['compose', ...proyecto, ...args], { cwd: RAIZ, encoding: 'utf8', timeout: 120_000 });
  if (r.error || r.status !== 0) {
    throw new FalloHumo(`docker compose ${args.slice(0, 3).join(' ')} … falló: ${r.error?.message ?? r.stderr}`);
  }
  return r.stdout;
}

/** SQL de desarrollo contra la base `manual` del servicio `bd` (credenciales de compose.yaml). */
function sqlDesarrollo(sql: string): string {
  exigirLocal();
  console.log(`  SQL de desarrollo: ${sql}`);
  return docker(['exec', '-T', 'bd', 'mariadb', '-umanual', '-pmanual_dev', 'manual', '-e', sql]);
}

/* ---------- fetch con frasco de cookies ---------- */

/** Un actor = una sesión: su propio frasco de cookies y su propia instancia de `crearApi`. */
interface Actor {
  nombre: string;
  api: Api;
  usuario?: Sesion['usuario'];
}

function fetchConFrasco(): typeof fetch {
  const frasco = new Map<string, string>();
  return async (entrada, init) => {
    const ruta = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.pathname : entrada.url;
    const cabeceras = new Headers(init?.headers);
    // Lo que manda el navegador por su cuenta en una petición del mismo sitio.
    cabeceras.set('Origin', ORIGEN);
    cabeceras.set('Sec-Fetch-Site', 'same-origin');
    if (frasco.size > 0) cabeceras.set('Cookie', [...frasco].map(([k, v]) => `${k}=${v}`).join('; '));
    const r = await fetch(`${URL_BASE}${ruta}`, { ...init, headers: cabeceras, redirect: 'manual' });
    for (const linea of r.headers.getSetCookie()) {
      const [par, ...atributos] = linea.split(';');
      const i = par.indexOf('=');
      const nombre = par.slice(0, i).trim();
      const valor = par.slice(i + 1).trim();
      const vencida =
        valor === '' ||
        atributos.some((a) => /^\s*max-age\s*=\s*(0|-\d+)\s*$/i.test(a)) ||
        atributos.some((a) => {
          const m = /^\s*expires\s*=(.*)$/i.exec(a);
          return m !== null && Date.parse(m[1]) < Date.now();
        });
      if (vencida) frasco.delete(nombre);
      else frasco.set(nombre, valor);
    }
    return r;
  };
}

function nuevoActor(nombre: string): Actor {
  return {
    nombre,
    api: crearApi({
      fetch: fetchConFrasco(),
      alSinSesion: () => console.log(`  (aviso: ${nombre} quedó sin sesión)`),
    }),
  };
}

async function entrar(actor: Actor, correo: string, clave: string): Promise<void> {
  const s = await actor.api.post<Sesion>('/sesion', { correo, clave, sitio_web: '' });
  actor.api.fijarCsrf(s.csrf);
  actor.usuario = s.usuario;
  const comprobacion = await actor.api.get<Sesion>('/sesion');
  comprobar(
    comprobacion.usuario.id === s.usuario.id,
    `${actor.nombre} entra (usuario ${s.usuario.id}, roles ${s.usuario.roles.join('+')}) y la cookie de sesión se mantiene`,
  );
}

/* ---------- Ayudantes de documento ---------- */

function buscar(n: DocJSON, bid: string): DocJSON | null {
  if (n.attrs?.bid === bid) return n;
  for (const h of n.content ?? []) {
    const r = buscar(h, bid);
    if (r) return r;
  }
  return null;
}

function reemplazarTexto(doc: DocJSON, bid: string, de: string, a: string): void {
  const nodo = buscar(doc, bid)?.content?.find((h) => h.type === 'text' && h.text?.includes(de));
  if (!nodo) throw new FalloHumo(`no se encontró «${de}» en el bloque ${bid}`);
  nodo.text = (nodo.text ?? '').replace(de, a);
}

function textoPlano(n: DocJSON): string {
  if (n.type === 'text') return n.text ?? '';
  return (n.content ?? []).map(textoPlano).join('\n');
}

/** Lo que hace el editor TipTap al cargar un documento: pasarlo por el esquema. */
const normalizar = (d: DocJSON): DocJSON => esquemaManual.nodeFromJSON(d).toJSON() as DocJSON;

const mensaje = (e: unknown): string =>
  e instanceof ErrorApi
    ? `HTTP ${e.estado} ${e.codigo}: ${e.message}${e.campos ? ` ${JSON.stringify(e.campos)}` : ''}`
    : e instanceof Error
      ? e.message
      : String(e);

async function esperarError(promesa: Promise<unknown>, codigo: string, texto: string): Promise<void> {
  try {
    await promesa;
  } catch (e) {
    comprobar(e instanceof ErrorApi && e.codigo === codigo, `${texto} (${mensaje(e)})`);
    return;
  }
  throw new FalloHumo(`${texto}: se esperaba ${codigo} y la petición tuvo éxito`);
}

/* ---------- Recorrido ---------- */

async function main(): Promise<void> {
  const sello = Date.now().toString(36);
  const dominio = 'humo.example';
  console.log(`Prueba de humo contra ${URL_BASE} (corrida ${sello})`);

  paso('0. Preparación de la base de desarrollo');
  exigirLocal();
  const salud = await (await fetch(`${URL_BASE}/api/salud`)).json();
  comprobar((salud as { estado?: string }).estado === 'ok', 'GET /api/salud responde ok');
  sqlDesarrollo('UPDATE consulta SET apertura = NULL, cierre = NULL, motivo_obligatorio = 0 WHERE id = 1');
  ok('consulta vuelta a preparación (SQL de desarrollo, solo para poder repetir la prueba)');

  paso('1. El administrador (creado con bin/crear-admin.php) entra');
  const correoAdmin = `admin-${sello}@${dominio}`;
  const salida = docker(['exec', '-T', SERVICIO_PHP, 'php', 'bin/crear-admin.php', 'Admin Humo', correoAdmin, 'Administración']);
  const claveAdmin = /Clave:\s+(\S+)/.exec(salida)?.[1];
  comprobar(claveAdmin, `bin/crear-admin.php creó ${correoAdmin}`);
  const admin = nuevoActor('Administrador');
  await entrar(admin, correoAdmin, claveAdmin);
  const consulta0 = await admin.api.get<Consulta>('/consulta');
  comprobar(consulta0.etapa === 'preparacion', 'la etapa es preparacion');

  paso('2. Sube un capítulo sintético (fixture del repo)');
  const tex = readFileSync(FIXTURE, 'utf8');
  const { doc: docImportado } = importarLatex(tex);
  comprobar(validarDocumento(docImportado).ok, 'el fixture importado cumple el esquema');
  const slug = `humo-${sello}`;
  const cap = await admin.api.post<CapituloCreado>('/admin/capitulos', {
    slug,
    titulo: 'Capítulo de humo (sintético)',
    orden: 1,
    texOriginal: tex,
    docJson: docImportado,
  });
  comprobar(cap.id > 0 && cap.versionId > 0, `POST /admin/capitulos → capítulo ${cap.id}, versión base ${cap.versionId}`);

  paso('3. Importa 3 laboratorios y un revisor');
  const filas = [
    ['Ana Humo', `lab1-${sello}@${dominio}`, 'Laboratorio Norte'],
    ['Bruno Humo', `lab2-${sello}@${dominio}`, 'Laboratorio Centro'],
    ['Carla Humo', `lab3-${sello}@${dominio}`, 'Laboratorio Sur'],
    ['Fabio Humo', `rev-${sello}@${dominio}`, 'Comité revisor'],
  ];
  const csv = ['nombre,correo,laboratorio', ...filas.map((f) => f.join(','))].join('\n');
  const cuentas = await admin.api.post<CuentaImportada[]>('/admin/usuarios/importar', { csv });
  comprobar(cuentas.length === 4 && cuentas.every((c) => c.clave.length === 16), 'se crean 4 cuentas con clave de 16 caracteres');
  const claveDe = (correo: string): string => cuentas.find((c) => c.correo === correo)!.clave;
  const usuarios = await admin.api.get<UsuarioAdmin[]>('/admin/usuarios');
  const revisorAdmin = usuarios.find((u) => u.correo === filas[3][1]);
  comprobar(revisorAdmin, 'GET /admin/usuarios lista al revisor con su correo descifrado');
  await admin.api.patch(`/admin/usuarios/${revisorAdmin.id}`, { roles: ['revisor'] });
  const tras = await admin.api.get<UsuarioAdmin[]>('/admin/usuarios');
  comprobar(
    tras.find((u) => u.id === revisorAdmin.id)?.roles.join() === 'revisor',
    'PATCH /admin/usuarios/{id} deja al revisor solo con el rol revisor',
  );

  paso('4. Fija las fechas y abre la consulta');
  const sinFracciones = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const ahora = Date.now();
  const consulta = await admin.api.put<Consulta>('/admin/consulta', {
    apertura: sinFracciones(new Date(ahora - 60_000)),
    cierre: sinFracciones(new Date(ahora + 7 * 24 * 3600_000)),
    motivoObligatorio: false,
  });
  comprobar(consulta.etapa === 'consulta', `PUT /admin/consulta → etapa consulta (cierre ${consulta.cierre})`);
  await esperarError(
    admin.api.post('/admin/capitulos', { slug, titulo: 'x', orden: 1, texOriginal: tex, docJson: docImportado }),
    'etapa_no_permite',
    'con la consulta abierta ya no se pueden subir capítulos',
  );

  paso('5. Cada laboratorio entra, edita y guarda (sugerencias del motor real)');
  const labs = [nuevoActor('Laboratorio Norte'), nuevoActor('Laboratorio Centro'), nuevoActor('Laboratorio Sur')];
  for (let i = 0; i < 3; i++) await entrar(labs[i], filas[i][1], claveDe(filas[i][1]));

  const capitulos = await labs[0].api.get<CapituloLista[]>('/capitulos');
  comprobar(capitulos.some((c) => c.id === cap.id), 'GET /capitulos incluye el capítulo subido');
  const base = await labs[0].api.get<Base>(`/capitulos/${cap.id}/base`);
  comprobar(base.versionId === cap.versionId, `GET …/base devuelve la versión ${base.versionId}`);
  const copiaVacia = await labs[0].api.get<Copia>(`/capitulos/${cap.id}/copia`);
  comprobar(copiaVacia.docJson === null, 'sin copia todavía: GET …/copia → {docJson: null}');

  /** Edita sobre la base normalizada (como el editor), calcula y guarda como el autoguardado. */
  async function editarYGuardar(lab: Actor, editar: (d: DocJSON) => void, motivoDe?: (s: Sugerencia) => string | undefined) {
    const copia = normalizar(structuredClone(base.docJson));
    editar(copia);
    const copiaNormal = normalizar(copia);
    if (!validarDocumento(copiaNormal).ok) throw new FalloHumo(`la copia de ${lab.nombre} no cumple el esquema`);
    const autor = `u${lab.usuario!.id}`;
    const sugerencias = calcularSugerencias(base.docJson, copiaNormal, autor).map((s) => {
      const motivo = motivoDe?.(s);
      return motivo ? { ...s, motivo } : s;
    });
    const cuerpo: CopiaEntrada = { versionId: base.versionId, docJson: copiaNormal, sugerencias };
    await lab.api.put(`/capitulos/${cap.id}/copia`, cuerpo);
    return sugerencias;
  }

  // Norte: cambia una palabra del párrafo b2 y mueve la segunda viñeta (b9) antes de la primera.
  const sugNorte = await editarYGuardar(labs[0], (d) => {
    reemplazarTexto(d, 'b2', 'cortado', 'dividido');
    const vinetas = d.content!.find((b) => b.type === 'listaVinetas')!;
    vinetas.content!.reverse();
  });
  const movidas = sugNorte.filter((s) => s.grupo !== undefined);
  comprobar(
    movidas.length >= 2 && movidas.some((s) => s.tipo === 'bloque-insertado') && movidas.some((s) => s.tipo === 'bloque-eliminado'),
    `Norte guarda ${sugNorte.length} sugerencias, entre ellas un bloque movido (${movidas.length} miembros, grupo ${movidas[0]?.grupo})`,
  );
  // Centro: cambia LA MISMA palabra de b2 de otra forma (conflicto) y edita el ítem b5.
  const sugCentro = await editarYGuardar(labs[1], (d) => {
    reemplazarTexto(d, 'b2', 'cortado', 'partido');
    reemplazarTexto(d, 'b5', 'Pesar el material.', 'Pesar 10 g del material.');
  });
  comprobar(
    sugCentro.length >= 2 && sugCentro.every((s) => s.tipo === 'contenido'),
    `Centro guarda ${sugCentro.length} sugerencias de contenido (b2 y b5)`,
  );
  // Sur: agrega un párrafo nuevo después de b2, con motivo en el mismo guardado.
  const sugSur = await editarYGuardar(
    labs[2],
    (d) => {
      const i = d.content!.findIndex((b) => b.attrs?.bid === 'b2');
      d.content!.splice(i + 1, 0, {
        type: 'parrafo',
        attrs: { bid: null, pegado: false },
        content: [{ type: 'text', text: 'Párrafo agregado por el laboratorio Sur.' }],
      });
    },
    (s) => (s.tipo === 'bloque-insertado' ? 'Falta indicar el alcance.' : undefined),
  );
  const copiaSur = await labs[2].api.get<Copia>(`/capitulos/${cap.id}/copia`);
  comprobar(
    sugSur.length === 1 &&
      sugSur[0].tipo === 'bloque-insertado' &&
      copiaSur.docJson !== null &&
      copiaSur.sugerencias[0]?.motivo === 'Falta indicar el alcance.',
    'Sur guarda 1 bloque insertado y el motivo enviado en el mismo guardado',
  );

  const conflictos = detectarConflictos([...sugNorte, ...sugCentro, ...sugSur]);
  comprobar(
    conflictos.some((c) => c.bloqueId === 'b2' && c.ids.length === 2),
    `el motor detecta el conflicto Norte/Centro en el bloque b2 (${conflictos.length} conflicto)`,
  );

  // Motivo por PATCH sobre la sugerencia ya guardada (como el panel del laboratorio).
  const b2Norte = sugNorte.find((s) => s.bloqueId === 'b2' && s.tipo === 'contenido')!;
  const conMotivo = await labs[0].api.patch<{ id: string; motivo: string | null }>(
    `/capitulos/${cap.id}/sugerencias/${encodeURIComponent(b2Norte.id)}`,
    { motivo: '«Dividido» es más preciso.' },
  );
  comprobar(conMotivo.motivo === '«Dividido» es más preciso.', 'Norte agrega un motivo con PATCH …/sugerencias/{uid}');

  // Re-guardar la misma copia conserva el motivo (§4.3).
  await editarYGuardar(labs[0], (d) => {
    reemplazarTexto(d, 'b2', 'cortado', 'dividido');
    d.content!.find((b) => b.type === 'listaVinetas')!.content!.reverse();
  });
  const copiaNorte = await labs[0].api.get<Copia>(`/capitulos/${cap.id}/copia`);
  comprobar(
    copiaNorte.docJson !== null &&
      copiaNorte.sugerencias.length === sugNorte.length &&
      copiaNorte.sugerencias.find((s) => s.id === b2Norte.id)?.motivo === '«Dividido» es más preciso.',
    'un segundo guardado (autoguardado) conserva las sugerencias y el motivo',
  );
  const copiaCentro = await labs[1].api.get<Copia>(`/capitulos/${cap.id}/copia`);
  comprobar(
    copiaCentro.docJson !== null && copiaCentro.sugerencias.every((s) => s.autor === `u${labs[1].usuario!.id}`),
    'cada laboratorio ve solo sus propias sugerencias',
  );

  paso('6. Los laboratorios comentan');
  await labs[1].api.post<IdCreado>(`/capitulos/${cap.id}/comentarios`, {
    bloqueId: 'b2',
    rango: { desde: 0, hasta: 4 },
    texto: 'Proponemos «partido»; conversarlo en la reunión.',
  });
  const c2 = await labs[2].api.post<IdCreado>(`/capitulos/${cap.id}/comentarios`, {
    bloqueId: 'b7',
    rango: { desde: 0, hasta: 9 },
    texto: 'Borrador de comentario.',
  });
  await labs[2].api.patch(`/comentarios/${c2.id}`, { texto: '¿Cuántas repeticiones se registran?' });
  const c3 = await labs[2].api.post<IdCreado>(`/capitulos/${cap.id}/comentarios`, {
    bloqueId: 'b8',
    rango: { desde: 0, hasta: 7 },
    texto: 'Comentario que se borrará.',
  });
  await labs[2].api.del(`/comentarios/${c3.id}`);
  const comSur = await labs[2].api.get<Comentario[]>(`/capitulos/${cap.id}/comentarios`);
  comprobar(
    comSur.length === 1 && comSur[0].texto === '¿Cuántas repeticiones se registran?',
    'Sur crea, edita y borra comentarios; ve solo el suyo editado',
  );
  const comNorte = await labs[0].api.get<Comentario[]>(`/capitulos/${cap.id}/comentarios`);
  comprobar(comNorte.length === 0, 'Norte no ve los comentarios de otros laboratorios');

  paso('7. Se adelanta el cierre (SQL de desarrollo: la API no admite fechas pasadas)');
  sqlDesarrollo(
    'UPDATE consulta SET apertura = UTC_TIMESTAMP() - INTERVAL 1 HOUR, cierre = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE id = 1',
  );
  const cerrada = await admin.api.get<Consulta>('/consulta');
  comprobar(cerrada.etapa === 'edicion_final', 'GET /consulta → etapa edicion_final');
  await esperarError(
    labs[0].api.put(`/capitulos/${cap.id}/copia`, { versionId: base.versionId, docJson: base.docJson, sugerencias: [] }),
    'etapa_no_permite',
    'un laboratorio ya no puede guardar su copia',
  );

  paso('8. El revisor ve los aportes, decide, compone y guarda la versión final');
  const revisor = nuevoActor('Revisor');
  await entrar(revisor, filas[3][1], claveDe(filas[3][1]));
  const lista = await revisor.api.get<CapituloLista[]>('/capitulos');
  const fila = lista.find((c) => c.id === cap.id);
  comprobar(
    fila?.totalSugerencias === sugNorte.length + sugCentro.length + sugSur.length && fila.totalComentarios === 2,
    `GET /capitulos (revisor): ${fila?.totalSugerencias} sugerencias, ${fila?.totalComentarios} comentarios, ${fila?.pendientes} pendientes`,
  );
  const aportes = await revisor.api.get<Aportes>(`/capitulos/${cap.id}/aportes`);
  const sugs = aportes.sugerencias;
  comprobar(
    new Set(sugs.map((s) => s.laboratorio)).size === 3 && sugs.every((s) => s.estado === 'pendiente' && typeof s.sugerenciaId === 'number'),
    `GET …/aportes trae ${sugs.length} sugerencias de los 3 laboratorios, todas pendientes`,
  );
  const conflictosRev = detectarConflictos(sugs);
  const enB2 = conflictosRev.find((c) => c.bloqueId === 'b2');
  comprobar(enB2 && enB2.ids.length === 2, 'el revisor ve el conflicto en b2 con los datos del servidor');

  const autorNorte = `u${labs[0].usuario!.id}`;
  const decidir = async (s: SugerenciaServidor, estado: 'aceptada' | 'rechazada', nota: string | null, derivada = false) => {
    await revisor.api.patch(`/sugerencias/${s.sugerenciaId}`, { estado, notaResolucion: nota, derivadaReunion: derivada });
    s.estado = estado;
  };
  // Conflicto: gana Norte; Centro se rechaza y se deriva a la reunión.
  for (const s of sugs.filter((x) => x.bloqueId === 'b2' && x.tipo === 'contenido')) {
    if (s.autor === autorNorte) await decidir(s, 'aceptada', null);
    else await decidir(s, 'rechazada', 'Se prefiere «dividido».', true);
  }
  // Bloque movido: una sola decisión envía todos los miembros del grupo.
  const grupo = claveGrupo(sugs.find((s) => s.grupo !== undefined)!);
  const miembros = sugs.filter((s) => claveGrupo(s) === grupo);
  for (const s of miembros) await decidir(s, 'aceptada', 'Orden más lógico.');
  // El resto (ítem b5 de Centro, párrafo nuevo de Sur) se acepta.
  for (const s of sugs.filter((x) => x.estado === 'pendiente')) await decidir(s, 'aceptada', null);
  ok(`decisiones enviadas: grupo movido de ${miembros.length} miembros, conflicto resuelto, resto aceptado`);

  for (const c of aportes.comentarios) {
    await revisor.api.patch(`/comentarios/${c.id}/resolucion`, { estado: 'resuelto', notaResolucion: 'Visto en la revisión.' });
  }
  const aportes2 = await revisor.api.get<Aportes>(`/capitulos/${cap.id}/aportes`);
  comprobar(
    aportes2.sugerencias.every((s) => s.resueltoPorNombre === filas[3][0]) && aportes2.comentarios.every((c) => c.resueltoPorNombre === filas[3][0]),
    `resueltoPorNombre es «${filas[3][0]}», el revisor de la prueba, en todas las sugerencias y comentarios`,
  );
  const rechazadas = aportes2.sugerencias.filter((s) => s.estado === 'rechazada');
  comprobar(
    rechazadas.length === 1 && rechazadas[0].derivadaReunion === true && aportes2.comentarios.every((c) => c.estado === 'resuelto'),
    'el servidor guarda las decisiones (1 rechazada y derivada a reunión) y los comentarios resueltos',
  );
  const misAportes = await labs[1].api.get<Aportes>(`/capitulos/${cap.id}/mis-aportes`);
  comprobar(
    misAportes.sugerencias.length === sugCentro.length &&
      misAportes.sugerencias.some((s) => s.estado === 'rechazada' && s.notaResolucion === 'Se prefiere «dividido».'),
    'Centro ve en mis-aportes solo lo suyo, con la decisión y la nota',
  );

  // Compone con la misma función que «Componer versión final» (src/app/revisor/componer.ts).
  const baseRev = await revisor.api.get<Base>(`/capitulos/${cap.id}/base`);
  const composicion = componerFinal(baseRev.docJson, aportes2.sugerencias, baseRev.versionId);
  const compuesta = normalizar(composicion.doc);
  comprobar(validarDocumento(compuesta).ok, `versión compuesta con ${composicion.aceptadas} aceptadas; cumple el esquema`);
  const texto = textoPlano(compuesta);
  comprobar(
    texto.includes('dividido') &&
      !texto.includes('partido') &&
      texto.includes('Pesar 10 g del material.') &&
      texto.includes('Párrafo agregado por el laboratorio Sur.') &&
      texto.indexOf('Segunda viñeta.') < texto.indexOf('Primera viñeta.'),
    'la versión compuesta tiene la edición ganadora, el ítem editado, el párrafo nuevo y las viñetas reordenadas',
  );
  const texFinal = exportarLatex(compuesta);
  const final = await revisor.api.put<{ versionId: number }>(`/capitulos/${cap.id}/final`, { docJson: compuesta, tex: texFinal });
  comprobar(final.versionId > base.versionId, `PUT …/final → versión final ${final.versionId}`);

  paso('9. Exporta el .tex final y lo compila con pdflatex');
  const guardada = await revisor.api.get<Final>(`/capitulos/${cap.id}/final`);
  comprobar(guardada.versionId === final.versionId && guardada.tex === texFinal, 'GET …/final devuelve el mismo .tex guardado');
  const reimportado = importarLatex(guardada.tex).doc;
  comprobar(
    validarDocumento(reimportado).ok && textoPlano(reimportado).includes('Párrafo agregado por el laboratorio Sur.'),
    'el .tex final se vuelve a importar y conserva el contenido',
  );
  const carpeta = mkdtempSync(join(tmpdir(), 'humo-manual-'));
  copyFileSync(MARCO, join(carpeta, 'marco-prueba.tex'));
  writeFileSync(join(carpeta, 'humo-final.tex'), guardada.tex.replace(/\r\n?/g, '\n'), 'utf8');
  const comp = compilar(carpeta, 'humo-final');
  if (!comp.ok) {
    throw new FalloHumo(`pdflatex no compiló el .tex final (${carpeta}): ${comp.detalle ?? 'sin detalle'}${colaDelLog(carpeta, 'humo-final')}`);
  }
  ok(`pdflatex compila el .tex final con marco-prueba.tex (${join(carpeta, 'humo-final.pdf')})`);
  comprobar(comp.sinResolver.length === 0, 'sin referencias sin resolver');

  await admin.api.del('/sesion');
  await esperarError(admin.api.get('/sesion'), 'sin_sesion', 'DELETE /sesion cierra la sesión del administrador');
}

main().then(
  () => {
    console.log('\nPrueba de humo: TODO OK');
  },
  (e: unknown) => {
    console.error(`\n  [FALLO] ${pasoActual}: ${mensaje(e)}`);
    if (!(e instanceof FalloHumo) && !(e instanceof ErrorApi) && e instanceof Error && e.stack) console.error(e.stack);
    console.log('\nPrueba de humo: FALLÓ');
    process.exitCode = 1;
  },
);
