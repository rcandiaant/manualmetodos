import type { DocJSON, Sugerencia, TipoSugerencia } from '../tipos';
import { textoVisible } from './decoraciones';

/** Ayudantes DOM mínimos compartidos por los modos de la demo. */

type Hijo = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...hijos: Hijo[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const h of hijos) if (h) e.append(h);
  return e;
}

export function boton(texto: string, alClic: () => void, clase = '', titulo?: string): HTMLButtonElement {
  const b = el('button', { type: 'button', class: clase, title: titulo });
  b.textContent = texto;
  b.addEventListener('click', alClic);
  return b;
}

export const NOMBRE_TIPO: Record<TipoSugerencia, string> = {
  contenido: 'Texto',
  formato: 'Formato',
  'bloque-insertado': 'Bloque nuevo',
  'bloque-eliminado': 'Bloque eliminado',
};

const recortar = (t: string, max = 160) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

/** «original» tachado → «propuesta» subrayada, como en la tarjeta de un cambio de Word. */
export function resumenCambio(s: Sugerencia): HTMLElement {
  const mostrar = (nodos: DocJSON[], clase: string) => {
    if (nodos.length === 0) return null;
    const t = textoVisible(nodos);
    const visible = t === '' ? '(vacío)' : t.trim() === '' ? '␣' : recortar(t);
    return el('span', { class: clase }, visible);
  };
  return el(
    'div',
    { class: 'resumen' },
    mostrar(s.original, 'res-eliminado'),
    s.original.length > 0 && s.propuesta.length > 0 ? ' → ' : null,
    mostrar(s.propuesta, 'res-insertado'),
  );
}

/** Caja de error visible (role=alert). Los errores nunca se ocultan al usuario. */
export function cajaError(contenedor: HTMLElement, mensaje: string | null): void {
  contenedor.replaceChildren();
  contenedor.hidden = mensaje === null;
  if (mensaje !== null) contenedor.append(el('strong', {}, 'Error: '), mensaje);
}

/**
 * Caja de avisos de cambios de estructura (I1): título explicativo y un aviso por
 * bloque. Se oculta si no hay avisos.
 */
export function cajaAvisosEstructura(contenedor: HTMLElement, avisos: string[], titulo: string): void {
  contenedor.replaceChildren();
  contenedor.hidden = avisos.length === 0;
  if (avisos.length === 0) return;
  contenedor.append(el('strong', {}, titulo), el('ul', {}, ...avisos.map((a) => el('li', {}, a))));
}

export const mensajeDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Lleva a la vista el elemento del editor marcado con `data-sug` y lo resalta un momento. */
export function resaltar(raiz: HTMLElement, id: string): void {
  const objetivo = [...raiz.querySelectorAll<HTMLElement>('[data-sug]')].find((n) => n.dataset.sug === id);
  if (!objetivo) return;
  objetivo.scrollIntoView({ block: 'center', behavior: 'smooth' });
  objetivo.classList.add('destello');
  window.setTimeout(() => objetivo.classList.remove('destello'), 1200);
}
