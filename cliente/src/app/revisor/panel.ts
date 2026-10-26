/**
 * Panel del revisor (docs/fase1-escala.md, «Recomendación para la vista del revisor»):
 * aportes agrupados por bloque con un contador de laboratorios, propuestas idénticas
 * colapsadas, cola de conflictos en orden de documento y filtros que viven en la URL.
 * Las funciones de datos son puras; las de dibujo arman el DOM solo con `textContent`.
 */
import { detectarConflictos, type Conflicto } from '../../cambios/conflictos';
import { ANCLA_INICIO, listarBloques } from '../../cambios/sugerencias';
import { jsonEstable } from '../../cambios/tokens';
import { textoVisible } from '../../editor/decoraciones';
import { boton, el, NOMBRE_TIPO, resumenCambio } from '../../editor/ui';
import type { DocJSON } from '../../tipos';
import type { Aportes, Comentario, EstadoSugerencia, Etapa, SugerenciaServidor } from '../tipos-api';

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

/** Agrupa por bloque (en el orden de aparición) y colapsa las propuestas idénticas. */
export function agruparPorBloque(sugerencias: SugerenciaServidor[]): GrupoBloque[] {
  const grupos = new Map<string, GrupoBloque>();
  for (const s of sugerencias) {
    let g = grupos.get(s.bloqueId);
    if (!g) {
      g = { bloqueId: s.bloqueId, laboratorios: [], filas: [] };
      grupos.set(s.bloqueId, g);
    }
    const lab = labDe(s);
    agregarLab(g.laboratorios, lab);
    const clave = claveIdentica(s);
    // Dos sugerencias del mismo laboratorio nunca se funden: son cambios distintos.
    const fila = g.filas.find((f) => f.clave === clave && !f.laboratorios.some((l) => l.usuarioId === lab.usuarioId));
    if (fila) {
      fila.sugerencias.push(s);
      fila.laboratorios.push(lab);
    } else {
      g.filas.push({ clave, sugerencias: [s], laboratorios: [lab] });
    }
  }
  return [...grupos.values()];
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

export interface ContextoPanel {
  base: DocJSON;
  versionId: number;
  etapa: Etapa;
  /** Decisión del revisor sobre todas las sugerencias de una fila (Task 7). */
  alDecidir?: (sugerencias: SugerenciaServidor[], estado: EstadoSugerencia) => void;
}

const puedeDecidir = (ctx: ContextoPanel) => ctx.etapa === 'edicion_final';

function botonesDecision(sugs: SugerenciaServidor[], ctx: ContextoPanel): HTMLElement {
  const habilitado = puedeDecidir(ctx);
  const crear = (texto: string, estado: EstadoSugerencia, clase: string) => {
    const b = boton(texto, () => ctx.alDecidir?.(sugs, estado), `decision ${clase}`);
    b.disabled = !habilitado;
    if (!habilitado) b.title = 'Las decisiones se habilitan en la edición final.';
    return b;
  };
  return el('div', { class: 'botones' }, crear('Aceptar', 'aceptada', 'aceptar'), crear('Rechazar', 'rechazada', 'rechazar'));
}

function etiquetaTipo(s: SugerenciaServidor): string {
  return s.grupo !== undefined ? 'Bloque movido' : NOMBRE_TIPO[s.tipo];
}

function filaPropuesta(f: FilaPropuesta, ctx: ContextoPanel): HTMLElement {
  const s = f.sugerencias[0];
  const estados = [...new Set(f.sugerencias.map((x) => NOMBRE_ESTADO[x.estado ?? 'pendiente']))];
  const anterior = s.versionId !== undefined && s.versionId !== ctx.versionId;
  const motivos = f.sugerencias.filter((x) => x.motivo);
  return el(
    'li',
    { class: `fila-propuesta ${claseLab(f.laboratorios[0].usuarioId)}`, 'data-sug': s.id },
    el(
      'div',
      { class: 'fila-cabeza' },
      el('span', { class: 'chips' }, ...f.laboratorios.map(chipLab)),
      el('span', { class: 'etiqueta-tipo' }, etiquetaTipo(s)),
      el('span', { class: 'estado' }, estados.join(' / ')),
      anterior ? el('span', { class: 'version-anterior' }, `Versión base anterior (v${s.versionId})`) : null,
    ),
    el('div', { class: 'labs-fila' }, textoLabs(f.laboratorios)),
    resumenCambio(s),
    ...motivos.map((x) => el('p', { class: 'motivo-leido' }, `Motivo (${labDe(x).laboratorio}): ${x.motivo}`)),
    botonesDecision(f.sugerencias, ctx),
  );
}

function filaComentario(c: Comentario): HTMLElement {
  const lab = labDe(c);
  return el(
    'li',
    { class: `comentario estado-${c.estado}` },
    el(
      'div',
      { class: 'fila-cabeza' },
      chipLab(lab),
      el('span', { class: 'etiqueta-tipo' }, 'Comentario'),
      el('span', { class: 'estado' }, c.estado === 'abierto' ? 'Abierto' : 'Resuelto'),
    ),
    el('div', { class: 'labs-fila' }, lab.laboratorio),
    el('p', { class: 'texto-comentario' }, c.texto),
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
        coms.length > 0 ? el('ul', { class: 'comentarios' }, ...coms.map(filaComentario)) : null,
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
  return el(
    'div',
    { class: `propuesta-lab ${claseLab(f.laboratorios[0].usuarioId)}`, 'data-sug': s.id },
    el('div', { class: 'fila-cabeza' }, el('span', { class: 'chips' }, ...f.laboratorios.map(chipLab)), el('span', { class: 'etiqueta-tipo' }, etiquetaTipo(s))),
    el('div', { class: 'labs-fila' }, textoLabs(f.laboratorios)),
    resumenCambio(s),
    botonesDecision(f.sugerencias, ctx),
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
