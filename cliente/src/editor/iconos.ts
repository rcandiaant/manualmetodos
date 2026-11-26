/**
 * Íconos de la barra del editor: SVG de línea (24×24, trazo `currentColor`), dibujados aquí
 * para no sumar dependencias. Son decorativos (`aria-hidden`): el nombre del botón va en
 * texto oculto (`.oculto`) y la explicación en el tooltip (`data-tip`).
 */

const TRAZOS = {
  listaNumerada:
    '<path d="M10 6h11M10 12h11M10 18h11"/><path d="M4 4.5h1.5V9"/><path d="M4 9h3"/>' +
    '<path d="M4 14.5c.4-.6 1-.9 1.6-.9.8 0 1.4.5 1.4 1.2 0 .9-.9 1.5-3 3.2h3"/>',
  listaVinetas:
    '<path d="M9 6h12M9 12h12M9 18h12"/>' +
    '<circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/>' +
    '<circle cx="4.5" cy="18" r="1.2" fill="currentColor"/>',
  aumentarSangria: '<path d="M3 5h18M11 10h10M11 14h10M3 19h18"/><path d="M3 9l4 3-4 3"/>',
  reducirSangria: '<path d="M3 5h18M11 10h10M11 14h10M3 19h18"/><path d="M7 9l-4 3 4 3"/>',
  tabla: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M3 14.5h18M9 4v16M15 4v16"/>',
  agregarFila: '<rect x="3" y="3" width="18" height="10" rx="2"/><path d="M3 8h18M9 3v10M15 3v10"/><path d="M12 16v5M9.5 18.5h5"/>',
  quitarFila: '<rect x="3" y="3" width="18" height="10" rx="2"/><path d="M3 8h18M9 3v10M15 3v10"/><path d="M9.5 18.5h5"/>',
  agregarColumna: '<rect x="3" y="3" width="10" height="18" rx="2"/><path d="M3 9h10M3 15h10M8 3v18"/><path d="M18.5 9.5v5M16 12h5"/>',
  quitarColumna: '<rect x="3" y="3" width="10" height="18" rx="2"/><path d="M3 9h10M3 15h10M8 3v18"/><path d="M16 12h5"/>',
  referencia:
    '<path d="M10 13a4.5 4.5 0 0 0 6.8.5l2.7-2.7a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.5"/>' +
    '<path d="M14 11a4.5 4.5 0 0 0-6.8-.5l-2.7 2.7a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5"/>',
  notaPie: '<path d="M3 7h11M3 12h11M3 17h7"/><path d="M17.5 4.5H19V10"/><path d="M17 10h4"/><path d="M14 20h7" opacity=".55"/>',
  formula: '<path d="M17 5H6.5l6 7-6 7H17"/>',
  ecuacion: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15.5 7.5h-7l4 4.5-4 4.5h7"/>',
  comentar: '<path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 12.5h5"/>',
} as const;

export type NombreIcono = keyof typeof TRAZOS;

const NS = 'http://www.w3.org/2000/svg';

/** SVG decorativo del ícono (los trazos son constantes de este archivo, no datos externos). */
export function icono(nombre: NombreIcono): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24',
    width: '18',
    height: '18',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
    class: 'icono',
  })) {
    svg.setAttribute(k, v);
  }
  svg.innerHTML = TRAZOS[nombre];
  return svg;
}

/**
 * Convierte un botón de texto en uno con ícono: el texto queda oculto (nombre accesible,
 * y lo que buscan las pruebas por `textContent`) y, si `visible`, también a la vista.
 */
export function ponerIcono(b: HTMLButtonElement, nombre: NombreIcono, visible = false): void {
  const texto = b.textContent ?? '';
  const etiqueta = document.createElement('span');
  etiqueta.className = visible ? 'etiqueta-boton' : 'oculto';
  etiqueta.textContent = texto;
  b.replaceChildren(icono(nombre), etiqueta);
  b.classList.add(visible ? 'con-icono' : 'solo-icono');
}

/** Tooltip propio (CSS sobre `data-tip`) en lugar del `title` nativo, que tarda y se ve distinto. */
export function ponerTooltip(b: HTMLElement, texto: string): void {
  b.dataset.tip = texto;
  b.removeAttribute('title');
}
