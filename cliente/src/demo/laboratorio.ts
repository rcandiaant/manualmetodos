import { Editor } from '@tiptap/core';
import { detectarCambiosEstructura } from '../cambios/estructura';
import { calcularSugerencias } from '../cambios/sugerencias';
import type { DocJSON, Sugerencia } from '../tipos';
import { NOMBRE_LAB, descartarCopia, guardarCopia, type ContextoModo, type Lab, type Modo } from './almacen';
import { claveDecoraciones, decoracionesDeCambios } from './decoraciones';
import { extensionesDemo } from './editor';
import { NOMBRE_TIPO, boton, cajaAvisosEstructura, cajaError, el, mensajeDe, resaltar, resumenCambio } from './ui';

const ESPERA_MS = 300;

const MARCAS: { marca: string; texto: string; titulo: string }[] = [
  { marca: 'negrita', texto: 'N', titulo: 'Negrita (Ctrl+B)' },
  { marca: 'cursiva', texto: 'K', titulo: 'Cursiva (Ctrl+I)' },
  { marca: 'subindice', texto: 'x₂', titulo: 'Subíndice (Ctrl+,)' },
  { marca: 'superindice', texto: 'x²', titulo: 'Superíndice (Ctrl+.)' },
];

/**
 * Modo laboratorio: el editor contiene la copia del laboratorio (o la base). En cada
 * cambio (con espera de 300 ms) se recalculan las sugerencias frente a la base y se
 * redibujan las marcas estilo Word; el panel lista las sugerencias con su motivo.
 */
export function montarLaboratorio(contenedor: HTMLElement, ctx: ContextoModo, lab: Lab): Modo {
  const { estado } = ctx;
  const base = estado.base as DocJSON;
  const motivos = estado.motivos[lab];

  const estadoGuardado = el('span', { class: 'estado-guardado', 'aria-live': 'polite' });
  const error = el('div', { class: 'error', role: 'alert' });
  error.hidden = true;
  const barra = el('div', { class: 'barra', role: 'toolbar', 'aria-label': 'Formato' });
  const areaEditor = el('div', { class: 'editor', 'data-modo': 'laboratorio' });
  const lista = el('ol', { class: 'tarjetas' });
  const contador = el('span', { class: 'contador' });
  // I1: cambios de estructura que no se recogen como sugerencia.
  const avisosEstructura = el('div', { class: 'aviso aviso-estructura', role: 'alert' });
  avisosEstructura.hidden = true;

  let editor: Editor;
  let sugerencias: Sugerencia[] = [];
  let avisos: string[] = [];
  let sinGuardar = false;
  let temporizador: number | undefined;

  const marcarSinGuardar = (v: boolean) => {
    sinGuardar = v;
    estadoGuardado.textContent = v ? 'Cambios sin guardar' : estado.copias[lab] ? 'Copia guardada' : 'Sin copia guardada (se muestra la base)';
    estadoGuardado.classList.toggle('pendiente', v);
  };

  const guardar = () => {
    window.clearTimeout(temporizador);
    recalcular(); // las sugerencias (y sus ids) al día antes de filtrar motivos
    // Si la copia cambió, se borran las decisiones del revisor sobre este laboratorio.
    guardarCopia(estado, lab, editor.getJSON() as DocJSON);
    // Solo se conservan los motivos de sugerencias vigentes.
    const vigentes = new Set(sugerencias.map((s) => s.id));
    for (const id of Object.keys(motivos)) if (!vigentes.has(id)) delete motivos[id];
    const ok = ctx.guardar();
    marcarSinGuardar(false);
    if (!ok) estadoGuardado.textContent = 'Copia guardada solo en memoria (sin almacenamiento local)';
  };

  const restablecer = () => {
    if (!window.confirm(`¿Descartar la copia del ${NOMBRE_LAB[lab]} y volver a la base?`)) return;
    descartarCopia(estado, lab); // misma referencia `motivos`: se vacía en su lugar
    ctx.guardar();
    editor.commands.setContent(structuredClone(base));
    recalcular();
    marcarSinGuardar(false);
  };

  function tarjeta(s: Sugerencia, i: number): HTMLLIElement {
    const motivo = el('input', {
      type: 'text',
      class: 'motivo',
      placeholder: 'Motivo (opcional)',
      'aria-label': `Motivo de la sugerencia ${i + 1}`,
    });
    motivo.value = motivos[s.id] ?? '';
    motivo.addEventListener('input', () => {
      if (motivo.value.trim() === '') delete motivos[s.id];
      else motivos[s.id] = motivo.value;
      marcarSinGuardar(true);
    });
    const li = el(
      'li',
      { class: `tarjeta tipo-${s.tipo}`, 'data-sug': s.id },
      el('div', { class: 'tarjeta-cabeza' }, el('span', { class: 'etiqueta-tipo' }, NOMBRE_TIPO[s.tipo])),
      resumenCambio(s),
      motivo,
    );
    li.addEventListener('click', (ev) => {
      if (ev.target !== motivo) resaltar(areaEditor, s.id);
    });
    return li;
  }

  function recalcular(): void {
    try {
      const doc = editor.state.doc;
      const copia = doc.toJSON() as DocJSON;
      sugerencias = calcularSugerencias(base, copia, lab);
      avisos = detectarCambiosEstructura(base, copia);
      const set = decoracionesDeCambios(doc, sugerencias, base);
      editor.view.dispatch(editor.state.tr.setMeta(claveDecoraciones, set).setMeta('addToHistory', false));
      cajaError(error, null);
    } catch (e) {
      cajaError(error, `no se pudieron calcular las sugerencias: ${mensajeDe(e)}`);
    }
    contador.textContent =
      `${sugerencias.length} sugerencia${sugerencias.length === 1 ? '' : 's'}` +
      (avisos.length > 0 ? ` · ${avisos.length} cambio${avisos.length === 1 ? '' : 's'} de estructura sin aplicar` : '');
    cajaAvisosEstructura(
      avisosEstructura,
      avisos,
      'Cambios de estructura que no se aplicarán. Unir ítems, mover o reordenar bloques no se recoge como sugerencia: ' +
        'deshágalo (Ctrl+Z) y, si hace falta, proponga el cambio eliminando el bloque y escribiéndolo de nuevo donde corresponde, ' +
        'o explíquelo en el motivo de otra sugerencia.',
    );
    lista.replaceChildren(...sugerencias.map(tarjeta));
    if (sugerencias.length === 0) {
      lista.append(
        el(
          'li',
          { class: 'vacio' },
          avisos.length > 0
            ? 'Sin sugerencias de texto: los cambios de estructura de arriba no se recogen.'
            : 'Sin cambios respecto de la base. Edite el texto para proponer cambios.',
        ),
      );
    }
  }

  const botonesMarca = MARCAS.map(({ marca, texto, titulo }) => {
    const b = boton(texto, () => editor.chain().focus().toggleMark(marca).run(), `marca marca-${marca}`, titulo);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('mousedown', (ev) => ev.preventDefault()); // conserva la selección
    barra.append(b);
    return { b, marca };
  });
  function actualizarBarra(ed: Editor): void {
    for (const { b, marca } of botonesMarca) b.setAttribute('aria-pressed', String(ed.isActive(marca)));
  }

  editor = new Editor({
    element: areaEditor,
    extensions: extensionesDemo(),
    content: structuredClone(estado.copias[lab] ?? base),
    onUpdate: () => {
      marcarSinGuardar(true);
      window.clearTimeout(temporizador);
      temporizador = window.setTimeout(recalcular, ESPERA_MS);
    },
    onTransaction: ({ editor: ed }) => actualizarBarra(ed),
  });

  const alSalir = (ev: BeforeUnloadEvent) => {
    if (sinGuardar) ev.preventDefault();
  };
  window.addEventListener('beforeunload', alSalir);

  contenedor.replaceChildren(
    el(
      'div',
      { class: 'modo modo-laboratorio' },
      el(
        'section',
        { class: 'columna-editor', 'aria-label': 'Copia del laboratorio' },
        el(
          'div',
          { class: 'barra-superior' },
          barra,
          el(
            'div',
            { class: 'acciones' },
            estadoGuardado,
            boton('Descartar copia', restablecer, 'secundario'),
            boton('Guardar copia', guardar, 'primario'),
          ),
        ),
        error,
        areaEditor,
      ),
      el(
        'aside',
        { class: 'panel', 'aria-label': 'Sugerencias' },
        el('h2', {}, `Sugerencias del ${NOMBRE_LAB[lab]} `, contador),
        avisosEstructura,
        lista,
      ),
    ),
  );
  recalcular();
  marcarSinGuardar(false);

  return {
    destruir: ({ descartar = false } = {}) => {
      window.clearTimeout(temporizador);
      window.removeEventListener('beforeunload', alSalir);
      if (!descartar && sinGuardar && window.confirm(`El ${NOMBRE_LAB[lab]} tiene cambios sin guardar. ¿Guardarlos?`)) guardar();
      editor.destroy();
    },
  };
}
