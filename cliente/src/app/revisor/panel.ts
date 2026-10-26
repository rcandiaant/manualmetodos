/**
 * Panel del revisor (docs/fase1-escala.md, «Recomendación para la vista del revisor»):
 * aportes agrupados por bloque con un contador de laboratorios, propuestas idénticas
 * colapsadas, cola de conflictos en orden de documento y filtros que viven en la URL.
 * Las funciones de datos son puras; las de dibujo arman el DOM solo con `textContent`.
 */
import { claveGrupo, detectarConflictos, type Conflicto } from '../../cambios/conflictos';
import { ANCLA_INICIO, listarBloques } from '../../cambios/sugerencias';
import { jsonEstable } from '../../cambios/tokens';
import { textoVisible } from '../../editor/decoraciones';
import { bidDeGrupo, boton, el, NOMBRE_TIPO, resumenCambio, resumenUnidad } from '../../editor/ui';
import type { DocJSON } from '../../tipos';
import type {
  Aportes,
  Comentario,
  EstadoComentario,
  EstadoSugerencia,
  Etapa,
  ResolucionSugerencia,
  SugerenciaServidor,
} from '../tipos-api';

/* ---------- Laboratorios: color estable y abreviatura ---------- */

/** Cantidad de colores de la paleta (clases `lab-c0` … `lab-c11` en revisor.css). */
export const PALETA_LABS = 12;

export interface LabRef {
  usuarioId: number;
  laboratorio: string;
}

/** Índice de color: depende solo del `usuarioId` (los ids 1…12 reciben colores distintos). */
export const indiceColor = (usuarioId: number): number => (((usuarioId - 1) % PALETA_LABS) + PALETA_LABS) % PALETA_LABS;

export const claseLab = (usuarioId: number): string => `lab-c${indiceColor(usuarioId)}`;

/** `u12` → 12 (clave de autor, contrato §2.4); NaN si no tiene esa forma. */
export const usuarioDeAutor = (autor: string): number => {
  const m = /^u(\d+)$/.exec(autor);
  return m ? Number(m[1]) : Number.NaN;
};

/** Clase de color para la clave de autor (la usa `decoracionesRevisor`). */
export const claseAutor = (autor: string): string => {
  const id = usuarioDeAutor(autor);
  return Number.isNaN(id) ? 'lab-sin-color' : claseLab(id);
};

const PALABRAS_VACIAS = new Set(['laboratorio', 'laboratorios', 'lab', 'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'para']);

/**
 * Abreviatura visible del laboratorio (para quien no distingue colores):
 * una palabra significativa → sus tres primeras letras («Laboratorio Norte» → «Nor»);
 * varias → sus iniciales, hasta tres («Laboratorio de Suelos y Aguas» → «SA»).
 */
export function abreviaturaLab(nombre: string): string {
  const palabras = nombre.split(/[^\p{L}\p{N}]+/u).filter((p) => p !== '');
  const significativas = palabras.filter((p) => !PALABRAS_VACIAS.has(p.toLowerCase()));
  const usar = significativas.length > 0 ? significativas : palabras;
  if (usar.length === 0) return '?';
  if (usar.length === 1) {
    const p = usar[0];
    return p.charAt(0).toUpperCase() + p.slice(1, 3);
  }
  return usar
    .slice(0, 3)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}

export const labDe = (x: { usuarioId?: number; laboratorio?: string; autor?: string }): LabRef => ({
  usuarioId: x.usuarioId ?? usuarioDeAutor(x.autor ?? ''),
  laboratorio: x.laboratorio ?? x.autor ?? 'Laboratorio desconocido',
});

/** Chip con el color y la abreviatura del laboratorio; el nombre completo en `title`. */
export function chipLab(lab: LabRef): HTMLElement {
  const chip = el('span', { class: `chip-lab ${claseLab(lab.usuarioId)}`, title: lab.laboratorio }, abreviaturaLab(lab.laboratorio));
  chip.setAttribute('aria-label', lab.laboratorio);
  return chip;
}

function agregarLab(lista: LabRef[], lab: LabRef): void {
  if (!lista.some((l) => l.usuarioId === lab.usuarioId)) lista.push(lab);
}

/* ---------- Agrupación por bloque ---------- */

/** Propuestas idénticas de uno o varios laboratorios. */
export interface FilaPropuesta {
  clave: string;
  sugerencias: SugerenciaServidor[];
  laboratorios: LabRef[];
}

export interface GrupoBloque {
  bloqueId: string;
  /** Laboratorios distintos con aportes en el bloque (el contador es su largo). */
  laboratorios: LabRef[];
  filas: FilaPropuesta[];
}

/**
 * Identidad de una propuesta: mismo tipo, original y propuesta. Se exigen además el
 * mismo rango base y la misma versión base, para no fundir dos cambios iguales en
 * lugares distintos del bloque (p. ej. la misma coma agregada en dos sitios).
 */
const claveIdentica = (s: SugerenciaServidor): string =>
  jsonEstable([s.tipo, s.original, s.propuesta, s.base, s.versionId ?? null]);

/** Clave de un bloque movido: autor, `grupo` y versión base (en otra versión es otro movimiento). */
const claveMovimiento = (s: SugerenciaServidor): string | null => {
  const k = claveGrupo(s);
  return k === null ? null : `${k}\u0000${s.versionId ?? ''}`;
};

/**
 * Agrupa por bloque (en el orden de aparición) y colapsa las propuestas idénticas.
 * Un bloque movido (miembros con el mismo autor y `grupo`) es UNA fila con todos sus
 * miembros, en el bloque de su lugar original (`mov:<bid>`): se decide con una sola acción.
 */
export function agruparPorBloque(sugerencias: SugerenciaServidor[]): GrupoBloque[] {
  const miembros = new Map<string, SugerenciaServidor[]>();
  for (const s of sugerencias) {
    const k = claveMovimiento(s);
    if (k !== null) miembros.set(k, [...(miembros.get(k) ?? []), s]);
  }
  const grupos = new Map<string, GrupoBloque>();
  for (const s of sugerencias) {
    const k = claveMovimiento(s);
    let unidad = [s];
    let bloqueId = s.bloqueId;
    let clave = claveIdentica(s);
    if (k !== null && s.grupo !== undefined) {
      unidad = miembros.get(k) ?? [s];
      if (unidad[0] !== s) continue; // ya entró con su primer miembro
      bloqueId = bidDeGrupo(s.grupo);
      clave = jsonEstable(['movido', s.grupo, ...unidad.map(claveIdentica).sort()]);
    }
    let g = grupos.get(bloqueId);
    if (!g) {
      g = { bloqueId, laboratorios: [], filas: [] };
      grupos.set(bloqueId, g);
    }
    const lab = labDe(s);
    agregarLab(g.laboratorios, lab);
    // Dos sugerencias del mismo laboratorio nunca se funden: son cambios distintos.
    const fila = g.filas.find((f) => f.clave === clave && !f.laboratorios.some((l) => l.usuarioId === lab.usuarioId));
    if (fila) {
      fila.sugerencias.push(...unidad);
      fila.laboratorios.push(lab);
    } else {
      g.filas.push({ clave, sugerencias: [...unidad], laboratorios: [lab] });
    }
  }
  return [...grupos.values()];
}

/**
 * Un representante por propuesta: de cada fila colapsada (idénticas de varios
 * laboratorios) quedan solo las sugerencias del primer laboratorio, con su bloque
 * movido entero. `labsDe` da, por id del representante, todos los laboratorios de la fila.
 * Lo usan el dibujo del documento (una marca por propuesta) y la composición de la
 * versión final (dos idénticas de autores distintos chocan en `detectarConflictos`).
 */
export function representantes(sugs: SugerenciaServidor[]): { sugs: SugerenciaServidor[]; labsDe: Map<string, LabRef[]> } {
  const salida: SugerenciaServidor[] = [];
  const labsDe = new Map<string, LabRef[]>();
  for (const g of agruparPorBloque(sugs)) {
    for (const f of g.filas) {
      const primero = f.sugerencias[0].autor;
      for (const s of f.sugerencias) {
        if (s.autor !== primero) continue;
        salida.push(s);
        labsDe.set(s.id, f.laboratorios);
      }
    }
  }
  return { sugs: salida, labsDe };
}

/* ---------- Orden de documento y conflictos ---------- */

/** Índice del bloque en la base (`@inicio` primero; un bloque que no está en la base, al final). */
export function ordenBloques(base: DocJSON): (bloqueId: string) => number {
  const indice = new Map<string, number>();
  listarBloques(base).forEach((b, i) => {
    if (b.bid !== null && !indice.has(b.bid)) indice.set(b.bid, i);
  });
  return (bid) => (bid === ANCLA_INICIO ? -1 : (indice.get(bid) ?? Number.MAX_SAFE_INTEGER));
}

/** Clave de orden de documento: bloque, y dentro del bloque el rango base (las inserciones de bloque, después). */
export function ordenDocumento(base: DocJSON): (s: SugerenciaServidor) => number {
  const bloque = ordenBloques(base);
  return (s) => {
    const i = bloque(s.bloqueId);
    if (i === Number.MAX_SAFE_INTEGER) return i;
    return (i + 1) * 1e6 + (s.tipo === 'bloque-insertado' ? 5e5 : s.base.desde);
  };
}

/** Ordena (estable) por posición en el documento. */
export function enOrdenDocumento(sugerencias: SugerenciaServidor[], base: DocJSON): SugerenciaServidor[] {
  const clave = ordenDocumento(base);
  return sugerencias
    .map((s, i) => ({ s, i, k: clave(s) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.s);
}

export const esPendiente = (s: SugerenciaServidor): boolean => (s.estado ?? 'pendiente') === 'pendiente';

export interface ConflictoCola extends Conflicto {
  /** Miembros en orden de documento. */
  sugerencias: SugerenciaServidor[];
  /** Propuestas distintas (las idénticas de varios laboratorios, colapsadas en una). */
  propuestas: FilaPropuesta[];
}

export interface AnalisisConflictos {
  /** Conflictos reales, en orden de documento. */
  cola: ConflictoCola[];
  /**
   * Choques de rango en los que todos los laboratorios proponen exactamente lo mismo:
   * no son conflictos (R3), sino propuestas coincidentes.
   */
  coincidencias: ConflictoCola[];
}

/** true si cada propuesta distinta la hicieron todos los laboratorios del choque. */
function esCoincidencia(c: ConflictoCola): boolean {
  const labs = new Set(c.sugerencias.map((s) => labDe(s).usuarioId));
  return c.propuestas.every((f) => f.laboratorios.length === labs.size);
}

/**
 * Choques entre las sugerencias **pendientes** (de la versión `versionId`, si se da:
 * las de otra base no comparten rangos), ordenados por posición en el documento y
 * separados en conflictos reales y coincidencias.
 */
export function analizarConflictos(sugerencias: SugerenciaServidor[], base: DocJSON, versionId?: number): AnalisisConflictos {
  const cola: ConflictoCola[] = [];
  const coincidencias: ConflictoCola[] = [];
  for (const c of choques(sugerencias, base, versionId)) {
    const conPropuestas: ConflictoCola = { ...c, propuestas: agruparPorBloque(c.sugerencias).flatMap((g) => g.filas) };
    (esCoincidencia(conPropuestas) ? coincidencias : cola).push(conPropuestas);
  }
  return { cola, coincidencias };
}

/** Cola de conflictos reales (sin las coincidencias), en orden de documento. */
export const colaDeConflictos = (sugerencias: SugerenciaServidor[], base: DocJSON, versionId?: number): ConflictoCola[] =>
  analizarConflictos(sugerencias, base, versionId).cola;

function choques(
  sugerencias: SugerenciaServidor[],
  base: DocJSON,
  versionId?: number,
): (Conflicto & { sugerencias: SugerenciaServidor[] })[] {
  const candidatas = enOrdenDocumento(
    sugerencias.filter((s) => esPendiente(s) && (versionId === undefined || s.versionId === undefined || s.versionId === versionId)),
    base,
  );
  const clave = ordenDocumento(base);
  const porId = new Map(candidatas.map((s) => [s.id, s] as const));
  return detectarConflictos(candidatas)
    .map((c) => {
      const sugs = c.ids.map((id) => porId.get(id)).filter((s): s is SugerenciaServidor => s !== undefined);
      return { ...c, sugerencias: sugs, k: Math.min(...sugs.map(clave)) };
    })
    .sort((a, b) => a.k - b.k)
    .map(({ k: _k, ...c }) => c);
}

/* ---------- Filtros ---------- */

export interface Filtros {
  /** `usuarioId` del laboratorio, o null para todos. */
  lab: number | null;
  soloConflictos: boolean;
  soloPendientes: boolean;
  ver: 'todo' | 'cambios' | 'comentarios';
}

/** `lab=12&solo=conflictos,pendientes&ver=cambios` → filtros; los valores raros se ignoran. */
export function leerFiltros(q: URLSearchParams): Filtros {
  const lab = q.get('lab') ?? '';
  const solo = (q.get('solo') ?? '').split(',');
  const ver = q.get('ver');
  return {
    lab: /^[1-9]\d{0,9}$/.test(lab) ? Number(lab) : null,
    soloConflictos: solo.includes('conflictos'),
    soloPendientes: solo.includes('pendientes'),
    ver: ver === 'cambios' || ver === 'comentarios' ? ver : 'todo',
  };
}

/** Consulta para la URL ('' sin filtros). Las comas quedan legibles. */
export function consultaDeFiltros(f: Filtros): string {
  const partes: string[] = [];
  if (f.lab !== null) partes.push(`lab=${f.lab}`);
  const solo = [f.soloConflictos && 'conflictos', f.soloPendientes && 'pendientes'].filter(Boolean);
  if (solo.length > 0) partes.push(`solo=${solo.join(',')}`);
  if (f.ver !== 'todo') partes.push(`ver=${f.ver}`);
  return partes.join('&');
}

/** Aplica los filtros a los aportes. `enConflicto`: ids de sugerencias en la cola de conflictos. */
export function aplicarFiltros(a: Aportes, f: Filtros, enConflicto: Set<string>): Aportes {
  const delLab = (x: { usuarioId?: number; autor?: string }) => f.lab === null || labDe(x).usuarioId === f.lab;
  const sugerencias =
    f.ver === 'comentarios'
      ? []
      : a.sugerencias.filter(
          (s) => delLab(s) && (!f.soloPendientes || esPendiente(s)) && (!f.soloConflictos || enConflicto.has(s.id)),
        );
  const comentarios =
    f.ver === 'cambios' || f.soloConflictos
      ? []
      : a.comentarios.filter((c) => delLab(c) && (!f.soloPendientes || c.estado === 'abierto'));
  return { sugerencias, comentarios };
}

/* ---------- Dibujo ---------- */

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

const NOMBRE_ESTADO: Record<EstadoSugerencia, string> = {
  pendiente: 'Pendiente',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  modificada: 'Modificada',
};

const recortar = (t: string, max = 90) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

/** Título legible de un bloque: el comienzo de su texto en la base. */
export function tituloBloque(base: DocJSON, bloqueId: string): string {
  if (bloqueId === ANCLA_INICIO) return 'Inicio del capítulo';
  if (bloqueId === '@analito') return 'Título (analito)';
  if (bloqueId === '@metodo') return 'Subtítulo (método)';
  const b = listarBloques(base).find((x) => x.bid === bloqueId);
  if (!b) return `Bloque ${bloqueId} (no está en la base vigente)`;
  const t = textoVisible(b.nodo.content ?? []).trim();
  return t === '' ? `Bloque ${bloqueId}` : `«${recortar(t)}»`;
}

/** Cambio de resolución pedido por el revisor; lo que falta se toma de la sugerencia (§4.5). */
export type CambioResolucion = Partial<ResolucionSugerencia>;

/** Estado de envío de las decisiones de una fila (lo arma `decisiones.ts`). */
export interface EstadoEnvio {
  enviando: boolean;
  /** PATCH que fallaron: la fila no los muestra como decididos. */
  fallos: { laboratorio: string; mensaje: string }[];
  /** Quedan «por rechazar» mientras el revisor confirma la aceptación de otra propuesta del conflicto. */
  porRechazar: boolean;
}

export interface ContextoPanel {
  base: DocJSON;
  versionId: number;
  etapa: Etapa;
  /** Decisión del revisor sobre todas las sugerencias de una fila o tarjeta. */
  alDecidir?: (sugerencias: SugerenciaServidor[], cambio: CambioResolucion) => void;
  envio?: (sugerencias: SugerenciaServidor[]) => EstadoEnvio;
  alReintentar?: (sugerencias: SugerenciaServidor[]) => void;
  alResolverComentario?: (c: Comentario, estado: EstadoComentario, nota: string) => void;
  errorComentario?: (c: Comentario) => string | undefined;
}

const puedeDecidir = (ctx: ContextoPanel) => ctx.etapa === 'edicion_final';

const SIN_ENVIO: EstadoEnvio = { enviando: false, fallos: [], porRechazar: false };

/** Notas a medio escribir, para que un redibujo no las borre (clave: la primera sugerencia de la fila, o el comentario). */
const borradoresNota = new WeakMap<SugerenciaServidor, { texto: string; abierto: boolean }>();
const borradoresComentario = new WeakMap<Comentario, string>();

/** Botón de decisión: deshabilitado fuera de la edición final o mientras se guarda. */
function botonDecision(texto: string, accion: () => void, clase: string, ctx: ContextoPanel, ocupado = false): HTMLButtonElement {
  const b = boton(texto, accion, `decision ${clase}`);
  const habilitado = puedeDecidir(ctx);
  b.disabled = !habilitado || ocupado;
  if (!habilitado) b.title = 'Las decisiones se habilitan en la edición final.';
  return b;
}

/** Nota, derivación y estado de envío de una fila (o tarjeta). */
function resolucionVisible(sugs: SugerenciaServidor[], env: EstadoEnvio, ctx: ContextoPanel): HTMLElement[] {
  const s = sugs[0];
  const salida: HTMLElement[] = [];
  if (s.notaResolucion) salida.push(el('p', { class: 'nota-resolucion' }, `Nota de resolución: ${s.notaResolucion}`));
  if (sugs.every((x) => x.derivadaReunion)) salida.push(el('p', { class: 'derivada' }, 'Derivada a la reunión ampliada.'));
  if (env.enviando) salida.push(el('p', { class: 'enviando', role: 'status' }, 'Guardando la decisión…'));
  if (env.fallos.length > 0) {
    const detalle = env.fallos.map((f) => `${f.laboratorio}: ${f.mensaje}`).join('; ');
    salida.push(
      el(
        'div',
        { class: 'fallo-decision', role: 'alert' },
        `No se guardó la decisión de ${plural(env.fallos.length, 'sugerencia', 'sugerencias')} (${detalle}). No se muestra como decidida.`,
        ' ',
        boton('Reintentar', () => ctx.alReintentar?.(sugs), 'reintentar'),
      ),
    );
  }
  return salida;
}

/** Acciones por aporte: aceptar, rechazar, derivar a reunión, nota de resolución y reabrir. */
function botonesDecision(sugs: SugerenciaServidor[], ctx: ContextoPanel, env: EstadoEnvio, compacto = false): HTMLElement {
  const decidir = (cambio: CambioResolucion) => () => ctx.alDecidir?.(sugs, cambio);
  const todas = (e: EstadoSugerencia) => sugs.every((x) => (x.estado ?? 'pendiente') === e);
  const crear = (texto: string, cambio: CambioResolucion, clase: string, pulsado?: boolean) => {
    const b = botonDecision(texto, decidir(cambio), clase, ctx, env.enviando);
    if (pulsado !== undefined) b.setAttribute('aria-pressed', String(pulsado));
    return b;
  };
  const derivada = sugs.every((x) => x.derivadaReunion);
  const s0 = sugs[0];
  const guardada = s0.notaResolucion ?? '';
  // Un redibujo (otra decisión que termina) no borra la nota a medio escribir.
  const borrador = borradoresNota.get(s0);
  if (borrador && borrador.texto === guardada && !borrador.abierto) borradoresNota.delete(s0);
  const vivo = borradoresNota.get(s0);
  const nota = el('textarea', { name: 'nota', rows: '2', maxlength: '2000', 'aria-label': 'Nota de resolución' });
  nota.value = vivo?.texto ?? guardada;
  const formNota = el(
    'div',
    { class: 'form-nota', hidden: vivo?.abierto ? undefined : '' },
    nota,
    botonDecision('Guardar nota', () => ctx.alDecidir?.(sugs, { notaResolucion: nota.value }), 'guardar-nota', ctx, env.enviando),
  );
  const recordar = () => borradoresNota.set(s0, { texto: nota.value, abierto: !formNota.hidden });
  nota.addEventListener('input', recordar);
  const abrirNota = botonDecision(
    'Nota de resolución',
    () => {
      formNota.hidden = !formNota.hidden;
      abrirNota.setAttribute('aria-expanded', String(!formNota.hidden));
      if (nota.value !== guardada || !formNota.hidden) recordar();
      if (!formNota.hidden) nota.focus();
    },
    'nota',
    ctx,
  );
  abrirNota.setAttribute('aria-expanded', String(!formNota.hidden));
  return el(
    'div',
    { class: 'decisiones' },
    el(
      'div',
      { class: 'botones' },
      crear('Aceptar', { estado: 'aceptada' }, 'aceptar', todas('aceptada')),
      crear('Rechazar', { estado: 'rechazada' }, 'rechazar', todas('rechazada')),
      // El revisor reemplaza la propuesta con su propia redacción (spec §5.2): la escribe en la versión final.
      compacto ? null : crear('Marcar como modificada (redacción propia)', { estado: 'modificada' }, 'modificar', todas('modificada')),
      compacto ? null : crear('Derivar a reunión', { derivadaReunion: !derivada }, 'derivar', derivada),
      compacto ? null : abrirNota,
      todas('pendiente') ? null : crear('Reabrir', { estado: 'pendiente' }, 'reabrir'),
    ),
    compacto ? null : formNota,
  );
}

function etiquetaTipo(s: SugerenciaServidor): string {
  return s.grupo !== undefined ? 'Bloque movido' : NOMBRE_TIPO[s.tipo];
}

/** Texto del estado; un bloque movido con miembros en estados distintos quedó a medias. */
function textoEstado(sugs: SugerenciaServidor[]): string {
  const estados = [...new Set(sugs.map((x) => NOMBRE_ESTADO[x.estado ?? 'pendiente']))];
  if (estados.length > 1 && sugs[0].grupo !== undefined) return `Bloque movido decidido a medias (${estados.join(' / ')})`;
  return estados.join(' / ');
}

/** Resumen de la fila: en un bloque movido, el lugar original → el lugar nuevo (de un solo laboratorio). */
function resumenFila(f: FilaPropuesta): HTMLElement {
  const s = f.sugerencias[0];
  if (s.grupo === undefined) return resumenCambio(s);
  const sugs = f.sugerencias.filter((x) => x.autor === s.autor);
  return resumenUnidad({ principal: sugs.find((x) => x.tipo === 'bloque-insertado') ?? s, sugs });
}

const marcaPorRechazar = (env: EstadoEnvio) => (env.porRechazar ? el('span', { class: 'marca-por-rechazar' }, 'Por rechazar') : null);

function filaPropuesta(f: FilaPropuesta, ctx: ContextoPanel): HTMLElement {
  const s = f.sugerencias[0];
  const env = ctx.envio?.(f.sugerencias) ?? SIN_ENVIO;
  const anterior = s.versionId !== undefined && s.versionId !== ctx.versionId;
  const motivos = f.sugerencias.filter((x) => x.motivo);
  return el(
    'li',
    { class: `fila-propuesta ${claseLab(f.laboratorios[0].usuarioId)}${env.porRechazar ? ' por-rechazar' : ''}`, 'data-sug': s.id },
    el(
      'div',
      { class: 'fila-cabeza' },
      el('span', { class: 'chips' }, ...f.laboratorios.map(chipLab)),
      el('span', { class: 'etiqueta-tipo' }, etiquetaTipo(s)),
      el('span', { class: 'estado' }, textoEstado(f.sugerencias)),
      marcaPorRechazar(env),
      anterior ? el('span', { class: 'version-anterior' }, `Versión base anterior (v${s.versionId})`) : null,
    ),
    el('div', { class: 'labs-fila' }, textoLabs(f.laboratorios)),
    resumenFila(f),
    ...motivos.map((x) => el('p', { class: 'motivo-leido' }, `Motivo (${labDe(x).laboratorio}): ${x.motivo}`)),
    ...resolucionVisible(f.sugerencias, env, ctx),
    botonesDecision(f.sugerencias, ctx, env),
  );
}

function filaComentario(c: Comentario, ctx: ContextoPanel): HTMLElement {
  const lab = labDe(c);
  const abierto = c.estado === 'abierto';
  const nota = el('textarea', { name: 'nota-comentario', rows: '2', maxlength: '2000', 'aria-label': 'Nota de resolución del comentario' });
  const guardada = c.notaResolucion ?? '';
  if (borradoresComentario.get(c) === guardada) borradoresComentario.delete(c);
  nota.value = borradoresComentario.get(c) ?? guardada;
  nota.addEventListener('input', () => borradoresComentario.set(c, nota.value));
  nota.disabled = !puedeDecidir(ctx);
  const error = ctx.errorComentario?.(c);
  return el(
    'li',
    { class: `comentario estado-${c.estado}` },
    el(
      'div',
      { class: 'fila-cabeza' },
      chipLab(lab),
      el('span', { class: 'etiqueta-tipo' }, 'Comentario'),
      el('span', { class: 'estado' }, abierto ? 'Abierto' : 'Resuelto'),
    ),
    el('div', { class: 'labs-fila' }, lab.laboratorio),
    el('p', { class: 'texto-comentario' }, c.texto),
    c.notaResolucion ? el('p', { class: 'nota-resolucion' }, `Nota de resolución: ${c.notaResolucion}`) : null,
    error ? el('p', { class: 'fallo-decision', role: 'alert' }, error) : null,
    el(
      'div',
      { class: 'decisiones' },
      nota,
      el(
        'div',
        { class: 'botones' },
        botonDecision(
          abierto ? 'Marcar como resuelto' : 'Reabrir',
          () => ctx.alResolverComentario?.(c, abierto ? 'resuelto' : 'abierto', nota.value),
          abierto ? 'resolver' : 'reabrir',
          ctx,
        ),
      ),
    ),
  );
}

/**
 * Panel por bloque, en orden de documento. `datos` ya viene filtrado; `sinAportes`
 * indica que el capítulo no tiene ningún aporte (para no culpar a los filtros).
 */
export function dibujarPanel(contenedor: HTMLElement, datos: Aportes, ctx: ContextoPanel, sinAportes = false): void {
  const orden = ordenBloques(ctx.base);
  const grupos = new Map(agruparPorBloque(enOrdenDocumento(datos.sugerencias, ctx.base)).map((g) => [g.bloqueId, g] as const));
  const comentarios = new Map<string, Comentario[]>();
  for (const c of datos.comentarios) comentarios.set(c.bloqueId, [...(comentarios.get(c.bloqueId) ?? []), c]);
  const bloques = [...new Set([...grupos.keys(), ...comentarios.keys()])]
    .map((bid, i) => ({ bid, i, k: orden(bid) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.bid);

  contenedor.replaceChildren();
  if (bloques.length === 0) {
    contenedor.append(
      el(
        'p',
        { class: 'vacio' },
        sinAportes ? 'Este capítulo aún no tiene aportes de los laboratorios.' : 'No hay aportes que coincidan con los filtros.',
      ),
    );
    return;
  }
  for (const bid of bloques) {
    const g = grupos.get(bid);
    const coms = comentarios.get(bid) ?? [];
    const labs = [...(g?.laboratorios ?? [])];
    for (const c of coms) agregarLab(labs, labDe(c));
    contenedor.append(
      el(
        'section',
        { class: 'bloque-aportes', 'data-bloque': bid },
        el(
          'h3',
          {},
          el('span', { class: 'titulo-bloque' }, tituloBloque(ctx.base, bid)),
          ' ',
          el('span', { class: 'contador-labs' }, plural(labs.length, 'laboratorio', 'laboratorios')),
        ),
        g ? el('ul', { class: 'filas' }, ...g.filas.map((f) => filaPropuesta(f, ctx))) : null,
        coms.length > 0 ? el('ul', { class: 'comentarios' }, ...coms.map((c) => filaComentario(c, ctx))) : null,
      ),
    );
  }
}

/** Laboratorios de una propuesta: «2 laboratorios: A, B» o el nombre si es uno. */
const textoLabs = (labs: LabRef[]): string =>
  labs.length > 1 ? `${labs.length} laboratorios: ${labs.map((l) => l.laboratorio).join(', ')}` : labs[0].laboratorio;

/** Una propuesta (de uno o varios laboratorios) dentro de una tarjeta de conflicto o coincidencia. */
function columnaPropuesta(f: FilaPropuesta, ctx: ContextoPanel): HTMLElement {
  const s = f.sugerencias[0];
  const env = ctx.envio?.(f.sugerencias) ?? SIN_ENVIO;
  return el(
    'div',
    { class: `propuesta-lab ${claseLab(f.laboratorios[0].usuarioId)}${env.porRechazar ? ' por-rechazar' : ''}`, 'data-sug': s.id },
    el(
      'div',
      { class: 'fila-cabeza' },
      el('span', { class: 'chips' }, ...f.laboratorios.map(chipLab)),
      el('span', { class: 'etiqueta-tipo' }, etiquetaTipo(s)),
      el('span', { class: 'estado' }, textoEstado(f.sugerencias)),
      marcaPorRechazar(env),
    ),
    el('div', { class: 'labs-fila' }, textoLabs(f.laboratorios)),
    resumenFila(f),
    ...resolucionVisible(f.sugerencias, env, ctx),
    botonesDecision(f.sugerencias, ctx, env, true),
  );
}

/**
 * Acciones de la tarjeta de conflicto (spec §5.2): además de aceptar una propuesta,
 * «Redactar otra» (el revisor escribe su versión en la versión final: las propuestas
 * quedan `modificada`) y «Rechazar todas».
 */
function accionesConflicto(c: ConflictoCola, ctx: ContextoPanel): HTMLElement {
  const env = ctx.envio?.(c.sugerencias) ?? SIN_ENVIO;
  return el(
    'div',
    { class: 'botones acciones-conflicto' },
    botonDecision('Redactar otra', () => ctx.alDecidir?.(c.sugerencias, { estado: 'modificada' }), 'redactar', ctx, env.enviando),
    botonDecision('Rechazar todas', () => ctx.alDecidir?.(c.sugerencias, { estado: 'rechazada' }), 'rechazar', ctx, env.enviando),
  );
}

/**
 * Cola de conflictos: una tarjeta por conflicto con las propuestas distintas lado a
 * lado; las idénticas de varios laboratorios van en una sola columna con todos sus chips.
 */
export function dibujarCola(contenedor: HTMLElement, cola: ConflictoCola[], ctx: ContextoPanel): void {
  contenedor.replaceChildren();
  if (cola.length === 0) {
    contenedor.append(el('p', { class: 'vacio' }, 'No hay conflictos pendientes.'));
    return;
  }
  contenedor.append(
    el(
      'ol',
      { class: 'cola-conflictos' },
      ...cola.map((c) =>
        el(
          'li',
          { class: 'conflicto', 'data-bloque': c.bloqueId },
          el('div', { class: 'titulo-bloque' }, tituloBloque(ctx.base, c.bloqueId)),
          el('div', { class: 'lado-a-lado' }, ...c.propuestas.map((f) => columnaPropuesta(f, ctx))),
          accionesConflicto(c, ctx),
        ),
      ),
    ),
  );
}

/** Propuestas coincidentes: varios laboratorios proponen exactamente lo mismo en el mismo lugar. */
export function dibujarCoincidencias(contenedor: HTMLElement, coincidencias: ConflictoCola[], ctx: ContextoPanel): void {
  contenedor.replaceChildren();
  contenedor.hidden = coincidencias.length === 0;
  if (coincidencias.length === 0) return;
  contenedor.append(
    el('h2', {}, `Propuestas coincidentes (${coincidencias.length})`),
    el(
      'ol',
      { class: 'coincidencias' },
      ...coincidencias.map((c) => {
        const labs = new Set(c.sugerencias.map((s) => labDe(s).usuarioId)).size;
        return el(
          'li',
          { class: 'coincidencia', 'data-bloque': c.bloqueId },
          el(
            'div',
            { class: 'titulo-bloque' },
            tituloBloque(ctx.base, c.bloqueId),
            ' ',
            el('span', { class: 'contador-labs' }, plural(labs, 'laboratorio', 'laboratorios')),
          ),
          ...c.propuestas.map((f) => columnaPropuesta(f, ctx)),
        );
      }),
    ),
  );
}
