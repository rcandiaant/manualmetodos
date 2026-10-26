/**
 * Barra de herramientas del editor del laboratorio (spec §5.1).
 *
 * - Negrita, cursiva, subíndice y superíndice (sub y sup se excluyen por el esquema, M1).
 * - Listas numerada y con viñetas, con aumentar y reducir sangría para anidar.
 * - Tabla: insertar, agregar o quitar fila y columna (ajusta `columnas`).
 * - Nota al pie: insertar y editar en un panel lateral con su propio mini-editor
 *   sobre `attrs.bloques` (los cambios se aplican al momento).
 * - Símbolos (° ± ≤ ≥ µ · × →).
 * - "Referenciar ítem": lista los ítems con `etiqueta` del capítulo e inserta un nodo `referencia`.
 *
 * - Fórmulas (Task 4): "Fórmula" (en línea) y "Ecuación" (en bloque) abren el diálogo de
 *   `formulas.ts`; clic en una fórmula existente la edita. Nada de esto ocurre en solo lectura.
 *
 * "Comentar" (Task 5) se agrega después con `agregar`.
 * Los bloques creados aquí llevan `bid: null` (R27): son bloques nuevos.
 */
import { Editor, Extension, Node, type Extensions } from '@tiptap/core';
import { history, redo, undo } from '@tiptap/pm/history';
import type { Node as ProseMirrorNode, NodeType } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { extensionesManual } from '../esquema/extensiones';
import type { DocJSON } from '../tipos';
import { textoVisible } from './decoraciones';
import { alPulsarEnter, BloquesNuevos } from './editor';
import { abrirEditorFormula, editarFormula, formulaEnDOM } from './formulas';
import { boton, el } from './ui';

export const SIMBOLOS = ['°', '±', '≤', '≥', 'µ', '·', '×', '→'] as const;

const MARCAS: { marca: string; texto: string; titulo: string; clase: string }[] = [
  { marca: 'negrita', texto: 'N', titulo: 'Negrita (Ctrl+B)', clase: 'marca marca-negrita' },
  { marca: 'cursiva', texto: 'K', titulo: 'Cursiva (Ctrl+I)', clase: 'marca marca-cursiva' },
  { marca: 'subindice', texto: 'x₂', titulo: 'Subíndice (Ctrl+,)', clase: 'marca marca-subindice' },
  { marca: 'superindice', texto: 'x²', titulo: 'Superíndice (Ctrl+.)', clase: 'marca marca-superindice' },
];

/* ---------- Tablas ---------- */

interface TablaUbicada {
  pos: number;
  tabla: ProseMirrorNode;
  fila: number;
  columna: number;
}

/** Tabla, fila y columna que contienen el cursor, o null. */
export function ubicarTabla(ed: Editor): TablaUbicada | null {
  const { $from } = ed.state.selection;
  for (let d = $from.depth; d >= 2; d--) {
    if ($from.node(d).type.name === 'celda' && $from.node(d - 2).type.name === 'tabla') {
      return { pos: $from.before(d - 2), tabla: $from.node(d - 2), fila: $from.index(d - 2), columna: $from.index(d - 1) };
    }
  }
  return null;
}

/** Especificación de columnas en piezas: columnas (`l`, `c`, `r`, `p{…}`, …) y separadores. */
function piezasColumnas(spec: string): { texto: string; columna: boolean }[] | null {
  const piezas: { texto: string; columna: boolean }[] = [];
  let i = 0;
  while (i < spec.length) {
    const c = spec[i];
    if (c === ' ') {
      i++;
      continue;
    }
    if (c === '|') {
      piezas.push({ texto: c, columna: false });
      i++;
      continue;
    }
    if (/[lcrX]/.test(c)) {
      piezas.push({ texto: c, columna: true });
      i++;
      continue;
    }
    if (/[pmb@]/.test(c) && spec[i + 1] === '{') {
      const fin = spec.indexOf('}', i + 2);
      if (fin < 0) return null;
      piezas.push({ texto: spec.slice(i, fin + 1), columna: c !== '@' });
      i = fin + 1;
      continue;
    }
    return null; // forma no reconocida: no se toca
  }
  return piezas;
}

/** `columnas` con una columna más tras `indice` (copia la suya) o sin la columna `indice`. */
export function ajustarColumnas(spec: string, indice: number, accion: 'agregar' | 'quitar'): string {
  const piezas = piezasColumnas(spec);
  if (!piezas) return spec;
  const cols = piezas.map((p, k) => (p.columna ? k : -1)).filter((k) => k >= 0);
  const k = cols[Math.min(indice, cols.length - 1)];
  if (k === undefined) return spec;
  if (accion === 'agregar') {
    const sep = piezas[k + 1]?.texto === '|' ? [{ texto: '|', columna: false }] : [];
    piezas.splice(k + 1 + sep.length, 0, { texto: piezas[k].texto, columna: true }, ...sep);
  } else {
    const quitarSep = piezas[k + 1]?.texto === '|' && piezas[k - 1]?.texto === '|' ? 1 : 0;
    piezas.splice(k, 1 + quitarSep);
  }
  return piezas.map((p) => p.texto).join('');
}

function celdaVacia(ed: Editor): ProseMirrorNode {
  return ed.schema.nodes.celda.create({ bid: null });
}

/** Posición del contenido de la celda (fila, columna) de la tabla que empieza en `pos`. */
function posCelda(tabla: ProseMirrorNode, pos: number, fila: number, columna: number): number {
  let p = pos + 1;
  for (let f = 0; f < fila; f++) p += tabla.child(f).nodeSize;
  p += 1;
  const filaNodo = tabla.child(fila);
  for (let c = 0; c < columna; c++) p += filaNodo.child(c).nodeSize;
  return p + 1;
}

function reemplazarTabla(ed: Editor, u: TablaUbicada, nueva: ProseMirrorNode, fila: number, columna: number): boolean {
  const tr = ed.state.tr.replaceWith(u.pos, u.pos + u.tabla.nodeSize, nueva);
  const f = Math.max(0, Math.min(fila, nueva.childCount - 1));
  const c = Math.max(0, Math.min(columna, nueva.child(f).childCount - 1));
  tr.setSelection(TextSelection.create(tr.doc, posCelda(nueva, u.pos, f, c)));
  ed.view.dispatch(tr.scrollIntoView());
  ed.view.focus();
  return true;
}

export const comandosTabla = {
  insertar(ed: Editor, filas = 2, columnas = 2): boolean {
    const { schema } = ed;
    const fila = () => schema.nodes.filaTabla.create(null, Array.from({ length: columnas }, () => celdaVacia(ed)));
    const tabla = schema.nodes.tabla.create(
      { columnas: `|${Array(columnas).fill('l').join('|')}|` },
      Array.from({ length: filas }, fila),
    );
    const pos = posInsercionBloque(ed, schema.nodes.tabla);
    if (pos === null) return false;
    const tr = ed.state.tr.insert(pos, tabla);
    tr.setSelection(TextSelection.create(tr.doc, posCelda(tabla, pos, 0, 0)));
    ed.view.dispatch(tr.scrollIntoView());
    ed.view.focus();
    return true;
  },
  agregarFila(ed: Editor): boolean {
    const u = ubicarTabla(ed);
    if (!u) return false;
    const n = u.tabla.child(u.fila).childCount;
    const nuevaFila = ed.schema.nodes.filaTabla.create(null, Array.from({ length: n }, () => celdaVacia(ed)));
    const filas: ProseMirrorNode[] = [];
    u.tabla.forEach((f, _o, i) => {
      filas.push(f);
      if (i === u.fila) filas.push(nuevaFila);
    });
    return reemplazarTabla(ed, u, u.tabla.type.create(u.tabla.attrs, filas), u.fila + 1, u.columna);
  },
  quitarFila(ed: Editor): boolean {
    const u = ubicarTabla(ed);
    if (!u || u.tabla.childCount <= 1) return false;
    const filas: ProseMirrorNode[] = [];
    u.tabla.forEach((f, _o, i) => {
      if (i !== u.fila) filas.push(f);
    });
    return reemplazarTabla(ed, u, u.tabla.type.create(u.tabla.attrs, filas), u.fila, u.columna);
  },
  agregarColumna(ed: Editor): boolean {
    const u = ubicarTabla(ed);
    if (!u) return false;
    const filas: ProseMirrorNode[] = [];
    u.tabla.forEach((f) => {
      const celdas: ProseMirrorNode[] = [];
      f.forEach((c, _o, i) => {
        celdas.push(c);
        if (i === Math.min(u.columna, f.childCount - 1)) celdas.push(celdaVacia(ed));
      });
      filas.push(f.type.create(f.attrs, celdas));
    });
    const attrs = { ...u.tabla.attrs, columnas: ajustarColumnas(String(u.tabla.attrs.columnas ?? ''), u.columna, 'agregar') };
    return reemplazarTabla(ed, u, u.tabla.type.create(attrs, filas), u.fila, u.columna + 1);
  },
  quitarColumna(ed: Editor): boolean {
    const u = ubicarTabla(ed);
    if (!u) return false;
    if (u.tabla.child(u.fila).childCount <= 1) return false;
    const filas: ProseMirrorNode[] = [];
    u.tabla.forEach((f) => {
      const celdas: ProseMirrorNode[] = [];
      f.forEach((c, _o, i) => {
        if (i !== u.columna || f.childCount <= 1) celdas.push(c);
      });
      filas.push(f.type.create(f.attrs, celdas));
    });
    const attrs = { ...u.tabla.attrs, columnas: ajustarColumnas(String(u.tabla.attrs.columnas ?? ''), u.columna, 'quitar') };
    return reemplazarTabla(ed, u, u.tabla.type.create(attrs, filas), u.fila, u.columna);
  },
};

/** Primera posición tras el bloque del cursor donde cabe un bloque de `tipo` (subiendo de nivel si hace falta). */
function posInsercionBloque(ed: Editor, tipo: NodeType): number | null {
  const sel = ed.state.selection;
  if (sel instanceof NodeSelection) {
    const $p = ed.state.doc.resolve(sel.to);
    if ($p.parent.canReplaceWith($p.index(), $p.index(), tipo)) return sel.to;
  }
  const $pos = sel.$to;
  for (let d = $pos.depth; d >= 1; d--) {
    const i = $pos.index(d - 1) + 1;
    if ($pos.node(d - 1).canReplaceWith(i, i, tipo)) return $pos.after(d);
  }
  return null;
}

/* ---------- Referencias ---------- */

export interface ItemEtiquetado {
  etiqueta: string;
  texto: string;
}

/** Ítems del documento con `etiqueta`, en orden, con el comienzo de su texto. */
export function itemsEtiquetados(doc: ProseMirrorNode): ItemEtiquetado[] {
  const res: ItemEtiquetado[] = [];
  doc.descendants((n) => {
    if (n.type.name === 'item' && typeof n.attrs.etiqueta === 'string' && n.attrs.etiqueta !== '') {
      const t = n.firstChild ? textoVisible([n.firstChild.toJSON() as DocJSON]) : '';
      res.push({ etiqueta: n.attrs.etiqueta, texto: t.length > 60 ? `${t.slice(0, 59)}…` : t });
    }
    return !n.isTextblock;
  });
  return res;
}

/* ---------- Nota al pie: mini-editor ---------- */

/** Raíz del mini-editor: los bloques de la nota (`attrs.bloques`). */
const DocNota = Node.create({ name: 'doc', topNode: true, content: 'bloque+' });

const EdicionNota = Extension.create({
  name: 'edicionNota',
  addProseMirrorPlugins() {
    return [history()];
  },
  addKeyboardShortcuts() {
    const ed = this.editor;
    return {
      'Mod-z': () => undo(ed.state, ed.view.dispatch),
      'Mod-y': () => redo(ed.state, ed.view.dispatch),
      'Shift-Mod-z': () => redo(ed.state, ed.view.dispatch),
      'Mod-b': () => ed.commands.toggleMark('negrita'),
      'Mod-i': () => ed.commands.toggleMark('cursiva'),
      'Mod-,': () => ed.commands.toggleMark('subindice'),
      'Mod-.': () => ed.commands.toggleMark('superindice'),
      Enter: () => alPulsarEnter(ed),
    };
  },
});

/** Extensiones del mini-editor de notas: el esquema del manual con raíz `bloque+`. */
export function extensionesNota(): Extensions {
  return [DocNota, ...extensionesManual.filter((e) => e.name !== 'doc'), BloquesNuevos, EdicionNota];
}

const PARRAFO_VACIO: DocJSON = { type: 'parrafo', attrs: { bid: null } };

/* ---------- Barra ---------- */

export interface Barra {
  elemento: HTMLElement;
  /** Panel lateral de la nota al pie (la vista decide dónde ponerlo). */
  panelNota: HTMLElement;
  /** Mini-editor de la nota abierta, si hay. */
  editorNota(): Editor | null;
  abrirNota(pos: number): void;
  cerrarNota(): void;
  /** Agrega un botón (Fórmula, Comentar: tareas siguientes). */
  agregar(b: HTMLButtonElement): void;
  habilitar(si: boolean): void;
  actualizar(): void;
  destruir(): void;
}

export function crearBarra(ed: Editor): Barra {
  const elemento = el('div', { class: 'barra-lab', role: 'toolbar', 'aria-label': 'Herramientas de edición' });
  const botones: HTMLButtonElement[] = [];
  let habilitada = true;

  const grupo = (etiqueta: string, ...hijos: HTMLElement[]) => {
    const g = el('div', { class: 'barra-grupo', role: 'group', 'aria-label': etiqueta }, ...hijos);
    elemento.append(g);
    return g;
  };
  const accion = (texto: string, fn: () => unknown, titulo?: string, clase = '') => {
    const b = boton(texto, () => {
      if (habilitada) fn();
    }, clase, titulo);
    b.addEventListener('mousedown', (ev) => ev.preventDefault()); // conserva la selección
    botones.push(b);
    return b;
  };

  // Marcas
  const botonesMarca = MARCAS.map(({ marca, texto, titulo, clase }) => {
    const b = accion(texto, () => ed.chain().focus().toggleMark(marca).run(), titulo, clase);
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', titulo);
    return { b, marca };
  });
  grupo('Formato', ...botonesMarca.map((x) => x.b));

  // Listas
  grupo(
    'Listas',
    accion('Lista numerada', () => ed.chain().focus().toggleList('listaOrdenada', 'item').run()),
    accion('Lista con viñetas', () => ed.chain().focus().toggleList('listaVinetas', 'item').run()),
    accion('Aumentar sangría', () => ed.chain().focus().sinkListItem('item').run(), 'Anidar el ítem en el anterior'),
    accion('Reducir sangría', () => ed.chain().focus().liftListItem('item').run(), 'Sacar el ítem un nivel'),
  );

  // Tabla
  grupo(
    'Tabla',
    accion('Insertar tabla', () => comandosTabla.insertar(ed)),
    accion('Agregar fila', () => comandosTabla.agregarFila(ed)),
    accion('Quitar fila', () => comandosTabla.quitarFila(ed)),
    accion('Agregar columna', () => comandosTabla.agregarColumna(ed)),
    accion('Quitar columna', () => comandosTabla.quitarColumna(ed)),
  );

  // Símbolos
  grupo(
    'Símbolos',
    ...SIMBOLOS.map((s) => accion(s, () => ed.chain().focus().insertContent(s).run(), `Insertar ${s}`, 'simbolo')),
  );

  // Referencias
  let listaRefs: HTMLElement | null = null;
  const cerrarRefs = () => {
    listaRefs?.remove();
    listaRefs = null;
  };
  const botonRef = accion('Referenciar ítem', () => {
    if (listaRefs) return cerrarRefs();
    const items = itemsEtiquetados(ed.state.doc);
    listaRefs = el('div', { class: 'lista-referencias', role: 'menu', 'aria-label': 'Ítems con etiqueta' });
    if (items.length === 0) listaRefs.append(el('p', { class: 'vacio' }, 'Este capítulo no tiene ítems con etiqueta.'));
    for (const it of items) {
      const b = boton(`${it.etiqueta} — ${it.texto}`, () => {
        ed.chain().focus().insertContent({ type: 'referencia', attrs: { etiqueta: it.etiqueta } }).run();
        cerrarRefs();
      });
      b.setAttribute('role', 'menuitem');
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      listaRefs.append(b);
    }
    listaRefs.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') cerrarRefs();
    });
    grupoRef.append(listaRefs);
    listaRefs.querySelector('button')?.focus();
  });
  const grupoRef = grupo('Referencias', botonRef);
  grupoRef.classList.add('grupo-referencias');

  // Nota al pie
  const panelNota = el('aside', { class: 'panel-nota', 'aria-label': 'Nota al pie' });
  panelNota.hidden = true;
  const areaNota = el('div', { class: 'editor editor-nota' });
  let mini: Editor | null = null;
  let posNota: number | null = null;

  const seguirPosicion = ({ transaction }: { transaction: { mapping: { mapResult(p: number): { pos: number; deleted: boolean } } } }) => {
    if (posNota === null) return;
    const r = transaction.mapping.mapResult(posNota);
    if (r.deleted) cerrarNota();
    else posNota = r.pos;
  };
  ed.on('transaction', seguirPosicion);

  function cerrarNota(): void {
    mini?.destroy();
    mini = null;
    posNota = null;
    areaNota.replaceChildren();
    panelNota.hidden = true;
  }

  function abrirNota(pos: number): void {
    const nodo = ed.state.doc.nodeAt(pos);
    if (!nodo || nodo.type.name !== 'notaPie') return;
    cerrarNota();
    posNota = pos;
    const bloques = (nodo.attrs.bloques as DocJSON[] | undefined) ?? [];
    mini = new Editor({
      element: areaNota,
      extensions: extensionesNota(),
      editable: ed.isEditable,
      content: { type: 'doc', content: bloques.length > 0 ? structuredClone(bloques) : [PARRAFO_VACIO] },
      onUpdate: ({ editor: m }) => {
        if (posNota === null) return;
        const actual = ed.state.doc.nodeAt(posNota);
        if (!actual || actual.type.name !== 'notaPie') return;
        const nuevos = (m.getJSON().content ?? []) as DocJSON[];
        ed.view.dispatch(ed.state.tr.setNodeMarkup(posNota, undefined, { ...actual.attrs, bloques: nuevos }));
      },
    });
    panelNota.hidden = false;
    if (ed.isEditable) mini.commands.focus('end');
  }

  panelNota.append(
    el('h2', {}, 'Nota al pie'),
    el('p', { class: 'nota' }, 'Los cambios se aplican al momento en el texto.'),
    areaNota,
    boton('Cerrar nota', () => cerrarNota(), 'secundario'),
  );

  grupo(
    'Nota al pie',
    accion('Nota al pie', () => {
      const pos = ed.state.selection.from;
      const ok = ed
        .chain()
        .focus()
        .insertContent({ type: 'notaPie', attrs: { bloques: [PARRAFO_VACIO] } })
        .run();
      if (ok) abrirNota(pos);
    }),
  );

  // Fórmulas: un diálogo a la vez; pasar a solo lectura o destruir la barra lo cierra (cancela).
  let dialogoFormula: AbortController | null = null;
  const puedeEditar = () => habilitada && ed.isEditable && !ed.isDestroyed;
  const cerrarFormula = () => {
    dialogoFormula?.abort();
    dialogoFormula = null;
  };
  async function conDialogo(fn: (senal: AbortSignal) => Promise<unknown>): Promise<void> {
    if (dialogoFormula || !puedeEditar()) return;
    const control = new AbortController();
    dialogoFormula = control;
    try {
      await fn(control.signal);
    } finally {
      if (dialogoFormula === control) dialogoFormula = null;
    }
  }
  const insertarFormula = (enBloque: boolean) =>
    conDialogo(async (senal) => {
      const latex = await abrirEditorFormula({ latex: '', enBloque, senal });
      if (latex === null || !puedeEditar()) return;
      if (!enBloque) {
        ed.chain().focus().insertContent({ type: 'matematica', attrs: { latex } }).run();
        return;
      }
      const tipo = ed.schema.nodes.ecuacion;
      const pos = posInsercionBloque(ed, tipo);
      if (pos === null) return;
      const tr = ed.state.tr.insert(pos, tipo.create({ latex, bid: null }));
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      ed.view.dispatch(tr.scrollIntoView());
      ed.view.focus();
    });
  grupo(
    'Fórmulas',
    accion('Fórmula', () => void insertarFormula(false), 'Insertar una fórmula en la línea'),
    accion('Ecuación', () => void insertarFormula(true), 'Insertar una ecuación en bloque'),
  );

  // Clic en una nota o una fórmula existente: la nota se abre en el panel, la fórmula en el diálogo.
  const alClicEditor = (ev: MouseEvent) => {
    const posFormula = formulaEnDOM(ed, ev.target);
    if (posFormula !== null) {
      void conDialogo((senal) => editarFormula(ed, posFormula, puedeEditar, senal));
      return;
    }
    const objetivo = (ev.target as HTMLElement | null)?.closest?.('.vista-nota');
    if (!objetivo) return;
    const pos = ed.view.posAtDOM(objetivo, 0);
    const nodo = ed.state.doc.nodeAt(pos);
    if (nodo?.type.name === 'notaPie') abrirNota(pos);
  };
  ed.view.dom.addEventListener('click', alClicEditor);

  function actualizar(): void {
    for (const { b, marca } of botonesMarca) b.setAttribute('aria-pressed', String(ed.isActive(marca)));
  }
  ed.on('transaction', actualizar);
  actualizar();

  return {
    elemento,
    panelNota,
    editorNota: () => mini,
    abrirNota,
    cerrarNota,
    agregar(b) {
      botones.push(b);
      b.disabled = !habilitada;
      grupo('Otros', b);
    },
    habilitar(si) {
      habilitada = si;
      for (const b of botones) b.disabled = !si;
      if (!si) {
        cerrarRefs();
        cerrarFormula();
      }
      mini?.setEditable(si);
    },
    actualizar,
    destruir() {
      ed.off('transaction', actualizar);
      ed.off('transaction', seguirPosicion);
      ed.view.dom.removeEventListener('click', alClicEditor);
      cerrarRefs();
      cerrarNota();
      cerrarFormula();
    },
  };
}
