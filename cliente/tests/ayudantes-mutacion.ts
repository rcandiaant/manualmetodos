import type { DocJSON } from '../src/tipos';
import { ecuacion, item, parrafo, texto } from './ayudantes-doc';

/**
 * Generador de copias mutadas (PRNG con semilla) compartido por la prueba de propiedad
 * y por `scripts/escala.ts`. Opera sobre cualquier DocJSON con `bid` (sintético o real).
 */

/** mulberry32: PRNG determinista de 32 bits. */
export function prng(semilla: number) {
  let a = semilla >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const entero = (n: number) => Math.floor(r() * n);
  const elegir = <T>(xs: T[]): T => xs[entero(xs.length)];
  return { r, entero, elegir };
}
export type Azar = ReturnType<typeof prng>;

export const PALABRAS = ['Pesar', '10', 'g', 'de', 'suelo', 'agua', 'destilada', 'agitar', 'durante', '5', 'min', 'filtrar', 'la', 'solución', 'NaCl', 'pH', 'muestra', '42,0'];

export const frase = (az: Azar, n = 3 + az.entero(8)) =>
  Array.from({ length: n }, () => az.elegir(PALABRAS)).join(' ') + '.';

/** Contenido inline con algo de formato. */
export function enlinea(az: Azar): DocJSON[] {
  const nodos: DocJSON[] = [texto(frase(az) + ' ')];
  if (az.r() < 0.3) nodos.push(texto(az.elegir(PALABRAS), ['negrita']), texto(' y '));
  if (az.r() < 0.2) nodos.push(texto('NH'), texto('4', ['subindice']), texto(' '));
  nodos.push(texto(frase(az)));
  return nodos;
}

export const conInline = (b: DocJSON, az: Azar): DocJSON => ({ ...b, content: enlinea(az) });

export interface Lugares {
  textos: DocJSON[];
  listas: DocJSON[];
  items: DocJSON[];
}

export function lugares(d: DocJSON): Lugares {
  const l: Lugares = { textos: [], listas: [], items: [] };
  const visitar = (n: DocJSON) => {
    if (['parrafo', 'seccion', 'celda'].includes(n.type ?? '')) l.textos.push(n);
    if (n.type === 'listaOrdenada' || n.type === 'listaVinetas') l.listas.push(n);
    if (n.type === 'item') l.items.push(n);
    for (const h of n.content ?? []) visitar(h);
  };
  visitar(d);
  return l;
}

let nuevos = 0;

/** Edita texto: reemplaza, inserta o borra una palabra, o pone negrita. */
function editarTexto(az: Azar, d: DocJSON): void {
  const b = az.elegir(lugares(d).textos);
  const textos = (b.content ?? []).filter((n) => n.type === 'text');
  if (textos.length === 0) {
    b.content = [texto(frase(az))];
    return;
  }
  const t = az.elegir(textos);
  const palabras = (t.text ?? '').split(' ');
  const i = az.entero(palabras.length);
  switch (az.entero(4)) {
    case 0:
      palabras[i] = az.elegir(PALABRAS);
      break;
    case 1:
      palabras.splice(i, 0, az.elegir(PALABRAS));
      break;
    case 2:
      if (palabras.length > 1) palabras.splice(i, 1);
      break;
    default:
      t.marks = [{ type: 'negrita' }];
  }
  t.text = palabras.join(' ') || 'x';
}

/**
 * Inserta un bloque nuevo: en el cuerpo, dentro de un ítem o como ítem nuevo
 * (en cualquier posición de una lista, también como primer ítem).
 */
function insertarBloque(az: Azar, d: DocJSON): void {
  const nuevo = (): DocJSON =>
    az.r() < 0.8 ? conInline(parrafo(`n${++nuevos}`), az) : ecuacion(`n${++nuevos}`, 'y');
  const { items, listas } = lugares(d);
  const opcion = az.entero(3);
  if (opcion === 1 && items.length > 0) {
    const it = az.elegir(items);
    it.content!.splice(1 + az.entero(it.content!.length), 0, nuevo());
  } else if (opcion === 2 && listas.length > 0) {
    const l = az.elegir(listas);
    l.content!.splice(az.entero(l.content!.length + 1), 0, item(null, conInline(parrafo(`n${++nuevos}`), az)));
  } else {
    d.content!.splice(2 + az.entero(d.content!.length - 1), 0, nuevo());
  }
}

/** Elimina un bloque del cuerpo, un bloque no inicial de un ítem o un ítem entero. */
function eliminarBloque(az: Azar, d: DocJSON): void {
  const { items, listas } = lugares(d);
  const opcion = az.entero(3);
  const itemsLargos = items.filter((it) => it.content!.length > 1);
  if (opcion === 1 && itemsLargos.length > 0) {
    const it = az.elegir(itemsLargos);
    it.content!.splice(1 + az.entero(it.content!.length - 1), 1);
  } else if (opcion === 2 && listas.some((l) => l.content!.length > 1)) {
    const l = az.elegir(listas.filter((x) => x.content!.length > 1));
    l.content!.splice(az.entero(l.content!.length), 1);
  } else if (d.content!.length > 3) {
    d.content!.splice(2 + az.entero(d.content!.length - 2), 1);
  }
}

/** Lista que contiene directamente a `it`. */
const listaDe_ = (d: DocJSON, it: DocJSON): DocJSON | undefined => lugares(d).listas.find((l) => l.content!.includes(it));

/** Backspace al inicio de un ítem que no es el primero: su contenido pasa al ítem anterior. */
function unirItemAlAnterior(az: Azar, d: DocJSON): void {
  const candidatos = lugares(d).items.filter((it) => (listaDe_(d, it)?.content!.indexOf(it) ?? 0) > 0);
  if (candidatos.length === 0) return;
  const it = az.elegir(candidatos);
  const l = listaDe_(d, it)!;
  const i = l.content!.indexOf(it);
  l.content![i - 1].content!.push(...it.content!);
  l.content!.splice(i, 1);
}

/** Saca un ítem de su lista (que conserva al menos uno) y lo pone en otra lista, en cualquier posición. */
function moverBloqueAOtraLista(az: Azar, d: DocJSON): void {
  const { items, listas } = lugares(d);
  const candidatos = items.filter((it) => listaDe_(d, it)!.content!.length > 1);
  if (candidatos.length === 0) return;
  const it = az.elegir(candidatos);
  const origen = listaDe_(d, it)!;
  const dentro = new Set(lugares(it).listas);
  const destinos = listas.filter((l) => l !== origen && !dentro.has(l));
  if (destinos.length === 0) return;
  const destino = az.elegir(destinos);
  origen.content!.splice(origen.content!.indexOf(it), 1);
  destino.content!.splice(az.entero(destino.content!.length + 1), 0, it);
}

export const MUTACIONES = [
  editarTexto,
  editarTexto,
  insertarBloque,
  eliminarBloque,
  unirItemAlAnterior,
  moverBloqueAOtraLista,
];

/** Aplica de 1 a `max` mutaciones al azar sobre `d` (en sitio). */
export function mutar(az: Azar, d: DocJSON, max = 4): void {
  const n = 1 + az.entero(max);
  for (let m = 0; m < n; m++) az.elegir(MUTACIONES)(az, d);
}
