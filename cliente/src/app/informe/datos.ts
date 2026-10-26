/**
 * Modelo puro del registro de cambios final (informe), sin DOM: una fila por aporte
 * (sugerencia o comentario, de cada laboratorio), con su ubicación en la base vigente,
 * filtros, descripción de los filtros para el título impreso y exportación CSV.
 *
 * Textos de una sugerencia: `original` y `propuesta` de `Sugerencia` (src/tipos.ts) son
 * arreglos `DocJSON[]` (nodos inline en `contenido`/`formato`, bloques enteros en
 * `bloque-insertado`/`bloque-eliminado`); aquí se pasan a texto plano con la matemática
 * como su LaTeX entre `$…$`. La propuesta lleva delante el tipo de cambio cuando no es de
 * contenido: «[formato: +negrita, −cursiva]», «[bloque insertado]», «[bloque eliminado]» o
 * «[bloque movido: lugar original|lugar nuevo]» (par con `grupo` = `mov:<bid>`).
 */
import { ANCLA_INICIO, bidDe, esBloque } from '../../cambios/sugerencias';
import { tokenizarBloque } from '../../cambios/tokens';
import type { DocJSON } from '../../tipos';
import { armarCsv } from '../csv';
import { aLocal } from '../fechas';
import type { Comentario, SugerenciaServidor } from '../tipos-api';

export type TipoAporte = 'sugerencia' | 'comentario';

export interface FilaInforme {
  capituloId: number;
  capitulo: string;
  tipo: TipoAporte;
  /** «3. Reactivos › ítem 2» o «Bloque no encontrado en la versión vigente». */
  ubicacion: string;
  /** Texto plano. En un comentario: original = texto anclado, propuesta = texto del comentario. */
  original: string;
  propuesta: string;
  laboratorio: string;
  motivo: string;
  /** pendiente|aceptada|rechazada|modificada (sugerencia) · abierto|resuelto (comentario). */
  estado: string;
  derivadaReunion: boolean;
  /** Nombre de quien resolvió y fecha local America/Santiago («2026-11-12 09:00»), o ''. */
  resueltoPor: string;
  resueltoEn: string;
  nota: string;
}

export interface CapituloInforme {
  id: number;
  titulo: string;
  base: DocJSON;
  /** Si viene, los capítulos se ordenan por él; si no, se respeta el orden recibido. */
  orden?: number;
}

export interface AportesCapitulo {
  sugerencias: SugerenciaServidor[];
  comentarios: Comentario[];
}

export interface FiltrosInforme {
  capituloId?: number;
  laboratorio?: string;
  estado?: string;
  soloReunion?: boolean;
  tipo?: TipoAporte;
}

export const NO_ENCONTRADO = 'Bloque no encontrado en la versión vigente';
const INICIO = 'Inicio del capítulo';
const CABECERA: Record<string, string> = { '@analito': 'Título (analito)', '@metodo': 'Subtítulo (método)' };

const INLINE = new Set(['text', 'matematica', 'referencia', 'notaPie', 'especialInline']);

/** Texto plano de nodos JSON: matemática como `$latex$`; bloques separados por espacio. */
export function textoPlano(nodos: DocJSON[]): string {
  return nodos
    .map((n): string => {
      switch (n.type) {
        case 'text':
          return n.text ?? '';
        case 'matematica':
        case 'ecuacion':
          return `$${String(n.attrs?.latex ?? '')}$`;
        case 'especial':
        case 'especialInline':
          return String(n.attrs?.latex ?? '');
        case 'referencia':
          return `[${String(n.attrs?.etiqueta ?? '')}]`;
        case 'notaPie':
          return `[nota: ${textoPlano(Array.isArray(n.attrs?.bloques) ? (n.attrs.bloques as DocJSON[]) : [])}]`;
        default:
          return textoPlano(n.content ?? []);
      }
    })
    .join(nodos.some((n) => INLINE.has(n.type ?? '')) ? '' : ' ');
}

/** Marcas del esquema (`extensiones.ts`) con su nombre en español, en este orden. */
const NOMBRE_MARCA: Record<string, string> = {
  negrita: 'negrita',
  cursiva: 'cursiva',
  subindice: 'subíndice',
  superindice: 'superíndice',
};
const ORDEN_MARCAS = Object.keys(NOMBRE_MARCA);

/** Marcas de cada unidad visible (carácter de texto o átomo inline), en orden. */
function marcasPorUnidad(nodos: DocJSON[], acc: string[][] = []): string[][] {
  for (const n of nodos) {
    const marcas = (n.marks ?? []).map((m) => m.type);
    if (n.type === 'text') for (let k = Array.from(n.text ?? '').length; k > 0; k--) acc.push(marcas);
    else if (INLINE.has(n.type ?? '')) acc.push(marcas);
    else marcasPorUnidad(n.content ?? [], acc);
  }
  return acc;
}

/**
 * Cambio de marcas de una sugerencia `formato`: «[formato: +negrita, −cursiva]». Compara
 * unidad a unidad (el texto es el mismo en ambos lados); si los largos no coinciden, compara
 * el conjunto de marcas de cada lado.
 */
export function cambioFormato(original: DocJSON[], propuesta: DocJSON[]): string {
  const a = marcasPorUnidad(original);
  const b = marcasPorUnidad(propuesta);
  const mas = new Set<string>();
  const menos = new Set<string>();
  const comparar = (x: string[], y: string[]) => {
    for (const m of y) if (!x.includes(m)) mas.add(m);
    for (const m of x) if (!y.includes(m)) menos.add(m);
  };
  if (a.length === b.length) a.forEach((x, i) => comparar(x, b[i]));
  else comparar([...new Set(a.flat())], [...new Set(b.flat())]);
  const rango = (m: string) => {
    const i = ORDEN_MARCAS.indexOf(m);
    return i === -1 ? ORDEN_MARCAS.length : i;
  };
  const nombres = (s: Set<string>, signo: string) =>
    [...s].sort((x, y) => rango(x) - rango(y) || x.localeCompare(y)).map((m) => `${signo}${NOMBRE_MARCA[m] ?? m}`);
  const partes = [...nombres(mas, '+'), ...nombres(menos, '−')];
  return partes.length === 0 ? '[formato]' : `[formato: ${partes.join(', ')}]`;
}

/** Propuesta legible: el texto, con el tipo de cambio delante cuando no es de contenido. */
function propuestaDe(s: SugerenciaServidor): string {
  const texto = textoPlano(s.propuesta ?? []);
  const con = (etiqueta: string) => (texto === '' ? etiqueta : `${etiqueta} ${texto}`);
  const movido = typeof s.grupo === 'string' && s.grupo.startsWith('mov:');
  switch (s.tipo) {
    case 'formato':
      return con(cambioFormato(s.original ?? [], s.propuesta ?? []));
    case 'bloque-insertado':
      return con(movido ? '[bloque movido: lugar nuevo]' : '[bloque insertado]');
    case 'bloque-eliminado':
      return con(movido ? '[bloque movido: lugar original]' : '[bloque eliminado]');
    default:
      return texto;
  }
}

interface Indice {
  ubicacion: Map<string, string>;
  posicion: Map<string, number>;
  nodo: Map<string, DocJSON>;
}

/**
 * Índice `bid → ubicación, posición, nodo` de la base, en un solo recorrido: número y
 * título de la `\section` que contiene el bloque y, dentro de listas, «› ítem N» por nivel.
 */
function indexar(base: DocJSON): Indice {
  const ind: Indice = { ubicacion: new Map(), posicion: new Map(), nodo: new Map() };
  let numero = 0;
  let seccion = INICIO;
  let i = 0;
  const visitar = (n: DocJSON, items: number[]): void => {
    if (esBloque(n)) {
      const bid = bidDe(n);
      if (n.type === 'seccion') {
        numero++;
        seccion = `${numero}. ${textoPlano(n.content ?? []).replace(/\s+/g, ' ').trim()}`;
      }
      if (bid !== null && !ind.ubicacion.has(bid)) {
        ind.ubicacion.set(bid, CABECERA[bid] ?? [seccion, ...items.map((k) => `ítem ${k}`)].join(' › '));
        ind.posicion.set(bid, i);
        ind.nodo.set(bid, n);
      }
      i++;
      return; // contenido inline: no hay bloques dentro
    }
    const esLista = n.type === 'listaOrdenada' || n.type === 'listaVinetas';
    (n.content ?? []).forEach((h, k) => visitar(h, esLista ? [...items, k + 1] : items));
  };
  visitar(base, []);
  return ind;
}

const ubicacionDe = (ind: Indice, bid: string): string =>
  bid === ANCLA_INICIO ? INICIO : (ind.ubicacion.get(bid) ?? NO_ENCONTRADO);

const posicionDe = (ind: Indice, bid: string): number =>
  bid === ANCLA_INICIO ? -1 : (ind.posicion.get(bid) ?? Number.POSITIVE_INFINITY);

/** Texto anclado de un comentario: los tokens `rango` del bloque en la base (acotados), o ''. */
function textoAnclado(ind: Indice, c: Comentario): string {
  const nodo = ind.nodo.get(c.bloqueId);
  if (!nodo) return '';
  const tokens = tokenizarBloque(nodo);
  const desde = Math.max(0, Math.min(c.rango.desde, tokens.length));
  const hasta = Math.max(desde, Math.min(c.rango.hasta, tokens.length));
  return tokens
    .slice(desde, hasta)
    .map((t) => (t.nodo ? textoPlano([t.nodo]) : t.texto))
    .join('');
}

/** Fecha ISO (UTC) a hora local America/Santiago «AAAA-MM-DD HH:MM»; '' si no hay. */
function fechaLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return aLocal(iso).replace('T', ' ');
  } catch {
    return iso; // fecha ilegible: se muestra tal cual antes que romper el informe
  }
}

const colador = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/**
 * Filas del informe: una por aporte y por laboratorio (no se colapsan las idénticas, spec
 * §5.4). Orden: capítulo, posición del bloque en la base vigente (los no encontrados al
 * final), laboratorio y, a igualdad, el orden recibido (sugerencias antes que comentarios).
 */
export function filasInforme(capitulos: CapituloInforme[], aportes: Map<number, AportesCapitulo>): FilaInforme[] {
  const ordenados = capitulos
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.orden ?? 0) - (b.c.orden ?? 0) || a.i - b.i)
    .map((x) => x.c);
  const salida: FilaInforme[] = [];
  for (const cap of ordenados) {
    const ap = aportes.get(cap.id);
    if (!ap || (ap.sugerencias.length === 0 && ap.comentarios.length === 0)) continue;
    const ind = indexar(cap.base);
    const conClave: { f: FilaInforme; pos: number; i: number }[] = [];
    for (const s of ap.sugerencias) {
      conClave.push({
        pos: posicionDe(ind, s.bloqueId),
        i: conClave.length,
        f: {
          capituloId: cap.id,
          capitulo: cap.titulo,
          tipo: 'sugerencia',
          ubicacion: ubicacionDe(ind, s.bloqueId),
          original: textoPlano(s.original ?? []),
          propuesta: propuestaDe(s),
          laboratorio: s.laboratorio ?? '',
          motivo: s.motivo ?? '',
          estado: s.estado ?? 'pendiente',
          derivadaReunion: s.derivadaReunion === true,
          resueltoPor: s.resueltoPorNombre ?? '',
          resueltoEn: fechaLocal(s.resueltoEn),
          nota: s.notaResolucion ?? '',
        },
      });
    }
    for (const c of ap.comentarios) {
      conClave.push({
        pos: posicionDe(ind, c.bloqueId),
        i: conClave.length,
        f: {
          capituloId: cap.id,
          capitulo: cap.titulo,
          tipo: 'comentario',
          ubicacion: ubicacionDe(ind, c.bloqueId),
          original: textoAnclado(ind, c),
          propuesta: c.texto,
          laboratorio: c.laboratorio ?? '',
          motivo: '',
          estado: c.estado,
          derivadaReunion: false,
          resueltoPor: c.resueltoPorNombre ?? '',
          resueltoEn: fechaLocal(c.resueltoEn),
          nota: c.notaResolucion ?? '',
        },
      });
    }
    conClave.sort(
      (a, b) =>
        (a.pos === b.pos ? 0 : a.pos < b.pos ? -1 : 1) ||
        colador.compare(a.f.laboratorio, b.f.laboratorio) ||
        a.i - b.i,
    );
    for (const x of conClave) salida.push(x.f);
  }
  return salida;
}

/** Filtros activos (un filtro vacío o ausente no restringe). */
export function filtrar(filas: FilaInforme[], f: FiltrosInforme): FilaInforme[] {
  return filas.filter(
    (x) =>
      (f.capituloId === undefined || x.capituloId === f.capituloId) &&
      (!f.laboratorio || x.laboratorio === f.laboratorio) &&
      (!f.estado || x.estado === f.estado) &&
      (!f.soloReunion || x.derivadaReunion) &&
      (!f.tipo || x.tipo === f.tipo),
  );
}

/** Descripción de los filtros activos para el título impreso; «Todos los aportes» sin filtros. */
export function describirFiltros(f: FiltrosInforme, capitulos: { id: number; titulo: string }[]): string {
  const partes: string[] = [];
  if (f.capituloId !== undefined) {
    const cap = capitulos.find((c) => c.id === f.capituloId);
    partes.push(`Capítulo: ${cap ? cap.titulo : String(f.capituloId)}`);
  }
  if (f.laboratorio) partes.push(`Laboratorio: ${f.laboratorio}`);
  if (f.estado) partes.push(`Estado: ${f.estado}`);
  if (f.tipo) partes.push(`Tipo: ${f.tipo === 'sugerencia' ? 'sugerencias' : 'comentarios'}`);
  if (f.soloReunion) partes.push('Solo derivadas a reunión');
  return partes.length === 0 ? 'Todos los aportes' : partes.join(' · ');
}

const CABECERA_CSV = [
  'Capítulo',
  'Tipo',
  'Ubicación',
  'Texto original',
  'Propuesta o comentario',
  'Laboratorio',
  'Motivo',
  'Estado',
  'Derivada a reunión',
  'Resuelto por',
  'Resuelto en',
  'Nota',
];

/** CSV del informe (BOM, `;`, LF y fórmulas neutralizadas, vía `armarCsv`). */
export function csvInforme(filas: FilaInforme[]): string {
  return armarCsv(
    CABECERA_CSV,
    filas.map((f) => [
      f.capitulo,
      f.tipo === 'sugerencia' ? 'Sugerencia' : 'Comentario',
      f.ubicacion,
      f.original,
      f.propuesta,
      f.laboratorio,
      f.motivo,
      f.estado,
      f.derivadaReunion ? 'Sí' : 'No',
      f.resueltoPor,
      f.resueltoEn,
      f.nota,
    ]),
  );
}
