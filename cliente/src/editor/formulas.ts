/**
 * Edición de fórmulas con MathLive (spec §5.1, Task 4).
 *
 * - `abrirEditorFormula` abre un diálogo propio (no `prompt`) con un `<math-field>` y una
 *   vista previa KaTeX (`trust: false`); devuelve el LaTeX nuevo o `null` si se cancela.
 * - MathLive se carga con `import()` dinámico solo al abrir el diálogo (chunk aparte) y se
 *   configura sin recursos externos: sin carpeta de fuentes (usa las fuentes KaTeX que ya
 *   empaqueta Vite con `katex.min.css`) y sin sonidos. Si no carga, el diálogo sigue
 *   funcionando con un `textarea` para el LaTeX.
 * - Teclado: Esc cancela, Enter en el campo no acepta (solo el botón Aceptar), Tab queda
 *   atrapado dentro del diálogo y al cerrar el foco vuelve a donde estaba.
 * - `editarFormula` reemplaza `attrs.latex` de un nodo `matematica` o `ecuacion` con una
 *   transacción normal del editor: la ven el motor de cambios, el historial y el autoguardado.
 */
import type { Editor } from '@tiptap/core';
import katex from 'katex';
import './formulas.css';
import { boton, el } from './ui';

/** Lo que usa este módulo de MathLive (permite simularlo en las pruebas). */
export interface ModuloMathLive {
  MathfieldElement: {
    new (): HTMLElement & { value: string; mathVirtualKeyboardPolicy?: string };
    fontsDirectory: string | null;
    soundsDirectory: string | null;
    keypressSound: unknown;
    plonkSound: unknown;
  };
}

export const cargarMathLive = (): Promise<ModuloMathLive> =>
  import('mathlive') as unknown as Promise<ModuloMathLive>;

export interface OpcionesFormula {
  latex: string;
  enBloque: boolean;
  /** Al abortarse, el diálogo se cierra como si se cancelara. */
  senal?: AbortSignal;
}

export interface DepsFormula {
  cargar?: () => Promise<ModuloMathLive>;
}

export const TIPOS_FORMULA = new Set(['matematica', 'ecuacion']);

/** Sin recursos externos: ni fuentes descargadas por MathLive ni sonidos. */
export function configurarMathLive(m: ModuloMathLive): void {
  const MF = m.MathfieldElement;
  MF.fontsDirectory = null;
  MF.soundsDirectory = null;
  MF.keypressSound = null;
  MF.plonkSound = null;
}

/** Vista previa KaTeX (sin comandos de confianza: `trust: false`). */
function pintarPrevia(destino: HTMLElement, latex: string, enBloque: boolean): void {
  destino.replaceChildren();
  if (latex.trim() === '') {
    destino.append(el('span', { class: 'vacio' }, '(vacía)'));
    return;
  }
  try {
    katex.render(latex, destino, { displayMode: enBloque, throwOnError: false, trust: false });
  } catch {
    destino.textContent = latex;
  }
}

let contadorDialogos = 0;
/** Menús y popovers de MathLive: con uno abierto, Esc es para cerrarlo a él. */
const POPOVERS_MATHLIVE = '#mathlive-suggestion-popover.is-visible, #mathlive-environment-popover.is-visible';
function hayMenuMathLive(ev: Event): boolean {
  if (document.querySelector(POPOVERS_MATHLIVE)) return true;
  return ev
    .composedPath()
    .some((n) => n instanceof Element && (n.classList.contains('ui-menu-container') || n.getAttribute('role') === 'menu'));
}

const ENFOCABLES = 'button:not([disabled]), textarea:not([disabled]), math-field, [tabindex]:not([tabindex="-1"])';

export async function abrirEditorFormula(opciones: OpcionesFormula, deps: DepsFormula = {}): Promise<string | null> {
  const { latex, enBloque, senal } = opciones;
  if (senal?.aborted) return null;
  const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  let modulo: ModuloMathLive | null = null;
  try {
    modulo = await (deps.cargar ?? cargarMathLive)();
    configurarMathLive(modulo);
  } catch {
    modulo = null;
  }
  if (senal?.aborted) return null;

  const id = `formula-${++contadorDialogos}`;
  const titulo = el(
    'h2',
    { id: `${id}-titulo` },
    `${latex === '' ? 'Nueva' : 'Editar'} ${enBloque ? 'ecuación en bloque' : 'fórmula'}`,
  );
  const previa = el('div', { class: 'vista-previa-formula', 'aria-live': 'polite' });
  const error = el('p', { class: 'error', role: 'alert' });
  error.hidden = true;

  let campo: HTMLElement & { value: string };
  let aviso: HTMLElement | null = null;
  if (modulo) {
    const mf = new modulo.MathfieldElement();
    mf.setAttribute('aria-label', 'Fórmula');
    mf.id = `${id}-campo`;
    mf.className = 'campo-formula';
    mf.mathVirtualKeyboardPolicy = 'manual';
    mf.value = latex;
    campo = mf;
  } else {
    aviso = el(
      'p',
      { class: 'aviso' },
      'No se pudo cargar el editor visual de fórmulas. Escriba el LaTeX directamente; la vista previa muestra el resultado.',
    );
    const area = el('textarea', { id: `${id}-campo`, class: 'campo-formula campo-latex', rows: '3', spellcheck: 'false' });
    area.value = latex;
    campo = area;
  }
  const etiqueta = el('label', { for: `${id}-campo` }, modulo ? 'Fórmula' : 'LaTeX de la fórmula');
  const actualizarPrevia = () => pintarPrevia(previa, campo.value, enBloque);
  campo.addEventListener('input', () => {
    error.hidden = true;
    actualizarPrevia();
  });

  return new Promise<string | null>((resolver) => {
    let cerrado = false;
    const cerrar = (resultado: string | null) => {
      if (cerrado) return;
      cerrado = true;
      senal?.removeEventListener('abort', alAbortar);
      fondo.remove();
      if (previo?.isConnected) previo.focus();
      resolver(resultado);
    };
    const alAbortar = () => cerrar(null);

    const cancelar = boton('Cancelar', () => cerrar(null), 'secundario');
    const aceptar = boton(
      'Aceptar',
      () => {
        const nuevo = campo.value;
        if (nuevo.trim() === '') {
          error.textContent = 'Escriba una fórmula antes de aceptar (o cancele).';
          error.hidden = false;
          return;
        }
        // Sin edición (aunque MathLive haya normalizado el LaTeX al cargarlo): el original intacto.
        if (nuevo === inicial) return cerrar(latex);
        cerrar(nuevo);
      },
      'primario',
    );

    const dialogo = el(
      'div',
      { class: 'dialogo-formula', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titulo.id },
      titulo,
      aviso,
      etiqueta,
      campo,
      el('p', { class: 'etiqueta-previa' }, 'Vista previa'),
      previa,
      error,
      el('div', { class: 'botones' }, cancelar, aceptar),
    );
    const fondo = el('div', { class: 'fondo-dialogo-formula' }, dialogo);

    // Fase de captura: Esc cancela antes de que MathLive lo use para su modo LaTeX.
    dialogo.addEventListener(
      'keydown',
      (ev) => {
        if (ev.key === 'Escape') {
          if (hayMenuMathLive(ev)) return; // MathLive cierra su menú; el diálogo sigue abierto
          ev.preventDefault();
          ev.stopPropagation();
          cerrar(null);
        }
      },
      true,
    );
    // Enter nunca acepta desde el campo; Tab queda dentro del diálogo.
    dialogo.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Tab') return;
      const lista = [...dialogo.querySelectorAll<HTMLElement>(ENFOCABLES)];
      if (lista.length === 0) return;
      const actual = lista.indexOf(document.activeElement as HTMLElement);
      const siguiente = ev.shiftKey
        ? actual <= 0
          ? lista.length - 1
          : actual - 1
        : actual < 0 || actual === lista.length - 1
          ? 0
          : actual + 1;
      ev.preventDefault();
      lista[siguiente].focus();
    });

    senal?.addEventListener('abort', alAbortar);
    document.body.append(fondo);
    // Valor inicial tal como lo deja el campo (MathLive normaliza al asignar o al montar).
    const inicial = campo.value;
    actualizarPrevia();
    campo.focus();
  });
}

/* ---------- Integración con el editor ---------- */

/** Sigue una posición del documento a través de las transacciones; `null` si se borró. */
export function seguirPosicion(ed: Editor, inicial: number): { pos(): number | null; soltar(): void } {
  let pos: number | null = inicial;
  const alTransaccion = ({ transaction }: { transaction: { mapping: { mapResult(p: number): { pos: number; deleted: boolean } } } }) => {
    if (pos === null) return;
    const r = transaction.mapping.mapResult(pos);
    pos = r.deleted ? null : r.pos;
  };
  ed.on('transaction', alTransaccion);
  return { pos: () => pos, soltar: () => ed.off('transaction', alTransaccion) };
}

/** Posición del nodo fórmula cuyo DOM contiene `objetivo`, o null. */
export function formulaEnDOM(ed: Editor, objetivo: EventTarget | null): number | null {
  const dom = (objetivo as HTMLElement | null)?.closest?.('.vista-matematica, .vista-ecuacion');
  if (!dom || !ed.view.dom.contains(dom)) return null;
  let encontrada: number | null = null;
  try {
    const p = ed.view.posAtDOM(dom, 0);
    for (const c of [p, p - 1]) {
      if (c >= 0 && ed.view.nodeDOM(c) === dom && TIPOS_FORMULA.has(ed.state.doc.nodeAt(c)?.type.name ?? '')) {
        encontrada = c;
      }
    }
  } catch {
    // posAtDOM falla en nodos sin descripción: se busca abajo
  }
  if (encontrada !== null) return encontrada;
  ed.state.doc.descendants((n, p) => {
    if (encontrada === null && TIPOS_FORMULA.has(n.type.name) && ed.view.nodeDOM(p) === dom) encontrada = p;
    return encontrada === null;
  });
  return encontrada;
}

/**
 * Abre el diálogo sobre la fórmula en `pos` y, si se acepta y todavía se puede editar,
 * reemplaza su `attrs.latex` con una transacción normal (conserva bid y demás attrs).
 */
export async function editarFormula(
  ed: Editor,
  pos: number,
  puedeEditar: () => boolean,
  senal?: AbortSignal,
  deps: DepsFormula = {},
): Promise<boolean> {
  const nodo = ed.state.doc.nodeAt(pos);
  if (!nodo || !TIPOS_FORMULA.has(nodo.type.name) || !puedeEditar()) return false;
  const tipo = nodo.type.name;
  const seguidor = seguirPosicion(ed, pos);
  try {
    const nuevo = await abrirEditorFormula(
      { latex: String(nodo.attrs.latex ?? ''), enBloque: tipo === 'ecuacion', ...(senal ? { senal } : {}) },
      deps,
    );
    const p = seguidor.pos();
    if (nuevo === null || p === null || !puedeEditar() || ed.isDestroyed) return false;
    const actual = ed.state.doc.nodeAt(p);
    if (!actual || actual.type.name !== tipo || actual.attrs.latex === nuevo) return false;
    ed.view.dispatch(ed.state.tr.setNodeMarkup(p, undefined, { ...actual.attrs, latex: nuevo }));
    return true;
  } finally {
    seguidor.soltar();
  }
}
