import { el, mensajeDe } from '../../editor/ui';
import { ErrorApi, SIN_CONEXION } from '../api';

/** Mensaje en español para un error de la API. */
export function mensajeError(e: unknown): string {
  if (e instanceof ErrorApi) {
    if (e.codigo === SIN_CONEXION) return 'No hay conexión con el servidor. Revise su conexión e intente de nuevo.';
    if (e.codigo === 'etapa_no_permite') return 'La etapa actual de la consulta no permite esta operación.';
    if (e.codigo === 'sin_permiso') return 'No tiene permiso para esta operación.';
  }
  return mensajeDe(e);
}

/** Cabecera común de las páginas de administración. */
export function cabeceraAdmin(titulo: string): HTMLElement {
  return el(
    'header',
    { class: 'cabecera-app' },
    el('div', {}, el('h1', {}, titulo)),
    el(
      'nav',
      { class: 'cabecera-acciones', 'aria-label': 'Administración' },
      el('a', { href: '#/admin', class: 'enlace-boton' }, 'Administración'),
      el('a', { href: '#/capitulos', class: 'enlace-boton' }, 'Inicio'),
    ),
  );
}

/** Caja de error visible (`role="alert"`), oculta mientras no hay mensaje. */
export function cajaError(): HTMLElement {
  return el('div', { class: 'error', role: 'alert', hidden: '' });
}

export function mostrar(caja: HTMLElement, texto: string | null): void {
  caja.textContent = texto ?? '';
  caja.hidden = texto === null;
}
