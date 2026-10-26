/**
 * Comentarios del laboratorio (spec §5.1; docs/api.md §4.4).
 *
 * - "Comentar" (barra): con texto seleccionado, abre el formulario en el panel. Se envía
 *   `POST /capitulos/{id}/comentarios` con el `bloqueId` del bloque y el `rango` en tokens
 *   (`tokenizarBloque`, los mismos offsets que usan las sugerencias y `posicionEnDoc`).
 *   Una selección que cruza bloques se recorta al primero.
 * - Un bloque `especial` (o una ecuación) seleccionado entero se comenta con el rango
 *   `{desde: 0, hasta: 1}` (su único token): no se puede editar, pero sí comentar.
 * - Un bloque nuevo (sin `bid`) no se puede comentar: no tiene ancla en la base.
 * - Los comentarios propios se listan (`GET …/comentarios`), se editan (`PATCH /comentarios/{id}`)
 *   y se borran (`DELETE`, con confirmación en la página). Cada uno queda anclado a su
 *   bloque con una decoración en el editor.
 * - Texto no enviado (comentario nuevo o edición): queda en el campo y en un borrador local
 *   (`mm:comentarios:<usuarioId>:<capituloId>:<versionId>`). Los fallos se muestran con `role="alert"`
 *   y el mismo botón reintenta. Una edición recuperada cuyo comentario no está en la lista
 *   se conserva en el borrador: si la lista cargó (el comentario ya no existe) se muestra
 *   para copiar con "Descartar"; si la carga falló, se guarda hasta que cargue.
 *   El borrador se lee una sola vez, al crear el módulo (antes de cualquier escritura).
 * - Fuera de la etapa `consulta` (`usarBorrador: false`) el borrador no se lee ni se escribe:
 *   la vista lo ofrece para copiar (`cajaBorradoresSinEnviar`, panel.ts).
 * - La lista se carga sin bloquear el editor; un comentario creado antes de que llegue
 *   la lista se conserva al fusionarla.
 *
 * Marco del `rango`: los offsets son tokens del bloque **en la copia del laboratorio** en
 * el momento de comentar (el contrato no fija el marco). Si el bloque ya tenía cambios no
 * coinciden con la base, y si el laboratorio sigue editando el bloque el ancla propia
 * puede correrse (se recorta al largo del bloque). El revisor ancla por `bloqueId`.
 */
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration } from '@tiptap/pm/view';
import { bidDe, esBloque } from '../../cambios/sugerencias';
import { tokenizarBloque, tokensANodos } from '../../cambios/tokens';
import { posicionEnDoc, textoVisible, ubicarBloque } from '../../editor/decoraciones';
import { boton, el, mensajeDe } from '../../editor/ui';
import type { DocJSON, Rango } from '../../tipos';
import { ErrorApi, type Api } from '../api';
import { formatearFecha } from '../inicio';
import type { Comentario, ComentarioEntrada, IdCreado } from '../tipos-api';

const MAX_COMENTARIO = 4000;

export interface Ancla {
  bloqueId: string;
  rango: Rango;
  /** Texto comentado, para mostrarlo. */
  cita: string;
}

export const SIN_SELECCION = 'Seleccione el texto que quiere comentar y pulse «Comentar».';
export const BLOQUE_NUEVO =
  'Ese texto está en un bloque nuevo: no se puede comentar. Explíquelo en el motivo del cambio o comente un bloque existente.';

/** Ancla (bloque y rango en tokens) de la selección del editor, o el motivo por el que no hay. */
export function anclaDeSeleccion(state: EditorState): Ancla | { error: string } {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.isBlock && !sel.node.isTextblock) {
    const json = sel.node.toJSON() as DocJSON;
    if (!esBloque(json)) return { error: SIN_SELECCION }; // contenedor (lista, tabla…)
    const bid = bidDe(json);
    if (bid === null) return { error: BLOQUE_NUEVO };
    return { bloqueId: bid, rango: { desde: 0, hasta: 1 }, cita: textoVisible([json]) };
  }
  if (sel.empty) return { error: SIN_SELECCION };
  const $from = sel.$from;
  let d = $from.depth;
  while (d > 0 && !$from.node(d).isTextblock) d--;
  if (d === 0) return { error: SIN_SELECCION };
  const nodo = $from.node(d);
  const json = nodo.toJSON() as DocJSON;
  const bid = bidDe(json);
  if (bid === null) return { error: BLOQUE_NUEVO };
  const inicio = $from.start(d);
  const a = sel.from - inicio;
  const b = Math.min(sel.to, inicio + nodo.content.size) - inicio;
  const tokens = tokenizarBloque(json);
  let desde = tokens.length;
  let hasta = 0;
  let p = 0;
  tokens.forEach((t, i) => {
    const largo = t.nodo ? 1 : t.texto.length;
    if (desde === tokens.length && p + largo > a) desde = i;
    if (p < b) hasta = i + 1;
    p += largo;
  });
  if (hasta <= desde) return { error: SIN_SELECCION };
  return { bloqueId: bid, rango: { desde, hasta }, cita: textoVisible(tokensANodos(tokens.slice(desde, hasta))) };
}

/** Texto actual del rango comentado en el documento, o null si el bloque ya no está. */
export function citaEnDoc(doc: ProseMirrorNode, c: Pick<Comentario, 'bloqueId' | 'rango'>): string | null {
  const u = ubicarBloque(doc, c.bloqueId);
  if (!u) return null;
  const json = u.node.toJSON() as DocJSON;
  if (!u.node.isTextblock) return textoVisible([json]);
  return textoVisible(tokensANodos(tokenizarBloque(json).slice(c.rango.desde, c.rango.hasta)));
}

/** Decoraciones que anclan cada comentario a su bloque en el editor. */
export function decoracionesComentarios(doc: ProseMirrorNode, comentarios: Comentario[]): Decoration[] {
  const decos: Decoration[] = [];
  for (const c of comentarios) {
    const u = ubicarBloque(doc, c.bloqueId);
    if (!u) continue;
    const attrs = { 'data-comentario': String(c.id) };
    if (!u.node.isTextblock) {
      decos.push(Decoration.node(u.pos, u.pos + u.node.nodeSize, { ...attrs, class: 'comentario-ancla-bloque' }, { comentario: c.id }));
      continue;
    }
    const n = tokenizarBloque(u.node.toJSON() as DocJSON).length;
    const desde = Math.min(c.rango.desde, n);
    const hasta = Math.min(c.rango.hasta, n);
    if (hasta <= desde) {
      decos.push(Decoration.node(u.pos, u.pos + u.node.nodeSize, { ...attrs, class: 'comentario-ancla-bloque' }, { comentario: c.id }));
      continue;
    }
    decos.push(
      Decoration.inline(posicionEnDoc(doc, c.bloqueId, desde), posicionEnDoc(doc, c.bloqueId, hasta), { ...attrs, class: 'comentario-ancla' }, {
        comentario: c.id,
      }),
    );
  }
  return decos;
}

export const claveComentarios = (usuarioId: number, capituloId: number, versionId: number) =>
  `mm:comentarios:${usuarioId}:${capituloId}:${versionId}`;

interface BorradorComentarios {
  nuevo?: Ancla & { texto: string };
  ediciones?: Record<string, string>;
}

export interface OpcionesComentarios {
  api: Api;
  capituloId: number;
  usuarioId: number;
  /** Versión base vigente (para la clave del borrador local). */
  versionId: number;
  almacen?: Storage;
  editor(): Editor | null;
  /** Los comentarios cambiaron: hay que redibujar sus anclas. */
  alCambiar(): void;
  /** Una escritura respondió 409 `etapa_no_permite`. */
  alEtapaCerrada(): void;
  /** false en edicion_final: la lista va en "Mis aportes" (las anclas se siguen viendo). */
  mostrarLista?: boolean;
  /** false fuera de `consulta`: no se lee ni se escribe el borrador local. */
  usarBorrador?: boolean;
}

export interface Comentarios {
  elemento: HTMLElement;
  botonComentar: HTMLButtonElement;
  cargar(): Promise<void>;
  comentar(): void;
  habilitar(si: boolean): void;
  decoraciones(doc: ProseMirrorNode): Decoration[];
  /** ¿Hay texto de comentarios aún no guardado en el servidor? */
  sinGuardar(): boolean;
}

type Modo = 'ver' | 'editar' | 'confirmar';

interface EstadoItem {
  c: Comentario;
  modo: Modo;
  edicion: string;
  error: string | null;
  ocupado: boolean;
  li: HTMLLIElement;
}

export function crearComentarios(op: OpcionesComentarios): Comentarios {
  const clave = claveComentarios(op.usuarioId, op.capituloId, op.versionId);
  let comentarios: Comentario[] = [];
  const items = new Map<number, EstadoItem>();
  let habilitado = false;
  let nuevo: Ancla | null = null;
  let enviando = false;
  const usarBorrador = op.usarBorrador !== false;
  /** Comentarios creados en esta página (se conservan al fusionar la lista del servidor). */
  const creadosAqui = new Set<number>();
  /** Ediciones del borrador sin comentario en la lista. */
  const edicionesHuerfanas = new Map<string, string>();
  let listaCargada = false;

  const leerBorrador = (): BorradorComentarios => {
    if (!usarBorrador) return {};
    try {
      const crudo = op.almacen?.getItem(clave);
      const b = crudo ? (JSON.parse(crudo) as BorradorComentarios) : {};
      return b && typeof b === 'object' ? b : {};
    } catch {
      return {};
    }
  };
  function escribirBorrador(): void {
    const b: BorradorComentarios = {};
    if (nuevo && areaNuevo.value !== '') b.nuevo = { ...nuevo, texto: areaNuevo.value };
    if (!usarBorrador) return;
    const ediciones: Record<string, string> = Object.fromEntries(edicionesHuerfanas);
    for (const [id, it] of items) if (it.modo === 'editar' && it.edicion !== it.c.texto) ediciones[id] = it.edicion;
    if (Object.keys(ediciones).length > 0) b.ediciones = ediciones;
    try {
      if (!op.almacen) return;
      if (!b.nuevo && !b.ediciones) op.almacen.removeItem(clave);
      else op.almacen.setItem(clave, JSON.stringify(b));
    } catch {
      // sin almacén: el texto sigue en el campo
    }
  }

  /* ---------- Botón y aviso ---------- */

  const botonComentar = boton('Comentar', () => comentar(), 'boton-comentar', 'Comentar el texto seleccionado');
  botonComentar.addEventListener('mousedown', (ev) => ev.preventDefault()); // conserva la selección
  const aviso = el('div', { class: 'aviso aviso-comentar', role: 'alert' });
  aviso.hidden = true;

  /* ---------- Formulario nuevo ---------- */

  const citaNuevo = el('blockquote', { class: 'cita-comentario' });
  const areaNuevo = el('textarea', {
    rows: '3',
    maxlength: String(MAX_COMENTARIO),
    'aria-label': 'Texto del comentario',
  });
  const errorNuevo = el('div', { class: 'error', role: 'alert' });
  errorNuevo.hidden = true;
  const recuperado = el('p', { class: 'nota' }, 'Se recuperó un comentario que no alcanzó a enviarse.');
  recuperado.hidden = true;
  const guardarNuevo = boton('Guardar comentario', () => void enviarNuevo(), 'primario');
  const cancelarNuevo = boton('Cancelar', () => cerrarNuevo(), 'secundario');
  const formNuevo = el(
    'div',
    { class: 'comentario-nuevo' },
    el('h3', {}, 'Nuevo comentario'),
    recuperado,
    el('p', { class: 'nota' }, 'Sobre:'),
    citaNuevo,
    areaNuevo,
    errorNuevo,
    el('div', { class: 'botones' }, guardarNuevo, cancelarNuevo),
  );
  formNuevo.hidden = true;
  areaNuevo.addEventListener('input', () => escribirBorrador());

  function abrirNuevo(a: Ancla, texto = ''): void {
    nuevo = { bloqueId: a.bloqueId, rango: a.rango, cita: a.cita };
    citaNuevo.textContent = a.cita || '(sin texto)';
    areaNuevo.value = texto;
    errorNuevo.hidden = true;
    formNuevo.hidden = false;
    aplicarHabilitado();
    if (habilitado) areaNuevo.focus();
  }

  function cerrarNuevo(): void {
    nuevo = null;
    areaNuevo.value = '';
    formNuevo.hidden = true;
    recuperado.hidden = true;
    errorNuevo.hidden = true;
    escribirBorrador();
  }

  function mensajeError(accion: string, e: unknown): string {
    if (e instanceof ErrorApi && e.codigo === 'etapa_no_permite') {
      op.alEtapaCerrada();
      return `La consulta se cerró: no se pudo ${accion}. El texto queda en el campo para copiarlo.`;
    }
    return `No se pudo ${accion}: ${mensajeDe(e)}`;
  }

  async function enviarNuevo(): Promise<void> {
    if (!nuevo || enviando || !habilitado) return;
    const texto = areaNuevo.value;
    if (texto.trim() === '') {
      errorNuevo.textContent = 'Escriba el comentario antes de guardarlo.';
      errorNuevo.hidden = false;
      return;
    }
    const ancla = nuevo;
    const cuerpo: ComentarioEntrada = { bloqueId: ancla.bloqueId, rango: ancla.rango, texto };
    enviando = true;
    guardarNuevo.disabled = true;
    try {
      const r = await op.api.post<IdCreado>(`/capitulos/${op.capituloId}/comentarios`, cuerpo);
      comentarios.push({ ...cuerpo, id: r.id, estado: 'abierto', creado: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });
      creadosAqui.add(r.id);
      cerrarNuevo();
      pintarLista();
      op.alCambiar();
    } catch (e) {
      errorNuevo.textContent = `${mensajeError('guardar el comentario', e)} Pulse «Guardar comentario» para reintentar.`;
      errorNuevo.hidden = false;
    } finally {
      enviando = false;
      aplicarHabilitado();
    }
  }

  /* ---------- Lista ---------- */

  const lista = el('ul', { class: 'lista-comentarios' });
  const vacio = el('p', { class: 'vacio' }, 'Aún no hay comentarios. Seleccione texto y pulse «Comentar».');
  const errorCarga = el('div', { class: 'error', role: 'alert' });
  errorCarga.hidden = true;
  const listaHuerfanas = el('ul', { class: 'lista-huerfanos' });
  const cajaHuerfanas = el(
    'div',
    { class: 'aviso ediciones-huerfanas' },
    el('strong', {}, 'Ediciones de comentarios que ya no existen'),
    el('p', {}, 'Estas ediciones no alcanzaron a guardarse y su comentario ya no está. Cópielas si las necesita o descártelas.'),
    listaHuerfanas,
  );
  cajaHuerfanas.hidden = true;

  function pintarHuerfanas(): void {
    listaHuerfanas.replaceChildren(
      ...[...edicionesHuerfanas].map(([id, texto]) => {
        const area = el('textarea', { readonly: '', rows: '2', 'aria-label': 'Edición de un comentario que ya no existe' });
        area.value = texto;
        return el(
          'li',
          {},
          area,
          boton('Descartar', () => {
            edicionesHuerfanas.delete(id);
            escribirBorrador();
            pintarHuerfanas();
          }, 'secundario'),
        );
      }),
    );
    cajaHuerfanas.hidden = !listaCargada || edicionesHuerfanas.size === 0;
  }

  const elemento = el(
    'section',
    { class: 'comentarios-lab', 'aria-label': 'Mis comentarios' },
    el('h2', {}, 'Mis comentarios'),
    aviso,
    formNuevo,
    errorCarga,
    cajaHuerfanas,
    vacio,
    lista,
  );
  if (op.mostrarLista === false) elemento.hidden = true;

  function irA(id: number): void {
    const raiz = op.editor()?.view.dom;
    const objetivo = raiz?.querySelector<HTMLElement>(`[data-comentario="${id}"]`);
    if (!objetivo) return;
    objetivo.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    objetivo.classList.add('destello');
    window.setTimeout(() => objetivo.classList.remove('destello'), 1200);
  }

  function pintarItem(it: EstadoItem): void {
    const { c } = it;
    const doc = op.editor()?.state.doc;
    const cita = doc ? citaEnDoc(doc, c) : null;
    const ir = el(
      'button',
      { type: 'button', class: 'ir-comentario', title: 'Ver el texto comentado' },
      cita === null ? '(el texto comentado ya no está en su copia)' : `«${cita || '…'}»`,
    );
    ir.addEventListener('click', () => irA(c.id));
    const error = el('div', { class: 'error', role: 'alert' }, it.error ?? '');
    error.hidden = it.error === null;
    const partes: (HTMLElement | null)[] = [ir];
    if (it.modo === 'editar') {
      const area = el('textarea', { rows: '3', maxlength: String(MAX_COMENTARIO), 'aria-label': 'Editar comentario' });
      area.value = it.edicion;
      area.addEventListener('input', () => {
        it.edicion = area.value;
        escribirBorrador();
      });
      partes.push(
        area,
        error,
        el(
          'div',
          { class: 'botones' },
          boton('Guardar', () => void guardarEdicion(it), 'primario accion'),
          boton('Cancelar', () => {
            it.modo = 'ver';
            it.error = null;
            escribirBorrador();
            pintarItem(it);
          }, 'secundario'),
        ),
      );
    } else {
      partes.push(
        el('p', { class: 'texto-comentario' }, c.texto),
        el('p', { class: 'meta-comentario' }, `${c.estado === 'resuelto' ? 'Resuelto' : 'Abierto'} · ${formatearFecha(c.creado)}`),
        error,
      );
      if (it.modo === 'confirmar') {
        partes.push(
          el(
            'div',
            { class: 'confirmar-borrado' },
            el('p', {}, '¿Borrar este comentario?'),
            boton('Sí, borrar', () => void borrar(it), 'peligro accion'),
            boton('No', () => {
              it.modo = 'ver';
              pintarItem(it);
            }, 'secundario'),
          ),
        );
      } else {
        partes.push(
          el(
            'div',
            { class: 'botones' },
            boton('Editar', () => {
              it.modo = 'editar';
              it.edicion = c.texto;
              it.error = null;
              pintarItem(it);
              it.li.querySelector('textarea')?.focus();
            }, 'secundario accion'),
            boton('Borrar', () => {
              it.modo = 'confirmar';
              it.error = null;
              pintarItem(it);
            }, 'secundario accion'),
          ),
        );
      }
    }
    it.li.replaceChildren(...partes.filter((p): p is HTMLElement => p !== null));
    aplicarHabilitadoItem(it);
  }

  async function guardarEdicion(it: EstadoItem): Promise<void> {
    if (it.ocupado || !habilitado) return;
    const texto = it.edicion;
    if (texto.trim() === '') {
      it.error = 'El comentario no puede quedar vacío. Para quitarlo, use «Borrar».';
      pintarItem(it);
      return;
    }
    it.ocupado = true;
    aplicarHabilitadoItem(it);
    try {
      await op.api.patch(`/comentarios/${it.c.id}`, { texto });
      it.c = { ...it.c, texto };
      comentarios = comentarios.map((c) => (c.id === it.c.id ? it.c : c));
      it.modo = 'ver';
      it.error = null;
    } catch (e) {
      it.error =
        e instanceof ErrorApi && e.codigo === 'no_encontrado'
          ? 'Este comentario ya no existe en el servidor. Copie el texto si lo necesita.'
          : `${mensajeError('guardar el cambio del comentario', e)} Pulse «Guardar» para reintentar.`;
    } finally {
      it.ocupado = false;
    }
    escribirBorrador();
    pintarItem(it);
  }

  async function borrar(it: EstadoItem): Promise<void> {
    if (it.ocupado || !habilitado) return;
    it.ocupado = true;
    aplicarHabilitadoItem(it);
    try {
      await op.api.del(`/comentarios/${it.c.id}`);
      quitar(it.c.id);
      return;
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === 'no_encontrado') {
        quitar(it.c.id); // ya no estaba
        return;
      }
      it.modo = 'ver';
      it.error = mensajeError('borrar el comentario', e);
    } finally {
      it.ocupado = false;
    }
    pintarItem(it);
  }

  function quitar(id: number): void {
    comentarios = comentarios.filter((c) => c.id !== id);
    items.delete(id);
    escribirBorrador();
    pintarLista();
    op.alCambiar();
  }

  function pintarLista(): void {
    const deseados: HTMLLIElement[] = [];
    for (const c of comentarios) {
      let it = items.get(c.id);
      if (!it) {
        it = { c, modo: 'ver', edicion: c.texto, error: null, ocupado: false, li: el('li', { class: 'comentario-item', 'data-id': String(c.id) }) };
        items.set(c.id, it);
        pintarItem(it);
      }
      deseados.push(it.li);
    }
    lista.replaceChildren(...deseados);
    vacio.hidden = comentarios.length > 0;
  }

  /* ---------- Habilitado ---------- */

  function aplicarHabilitadoItem(it: EstadoItem): void {
    for (const b of it.li.querySelectorAll<HTMLButtonElement>('button.accion')) b.disabled = !habilitado || it.ocupado;
    for (const a of it.li.querySelectorAll('textarea')) a.readOnly = !habilitado;
  }

  function aplicarHabilitado(): void {
    botonComentar.disabled = !habilitado;
    guardarNuevo.disabled = !habilitado || enviando;
    areaNuevo.readOnly = !habilitado;
    for (const it of items.values()) aplicarHabilitadoItem(it);
  }

  /* ---------- API pública ---------- */

  function comentar(): void {
    const ed = op.editor();
    if (!ed || !habilitado) return;
    const a = anclaDeSeleccion(ed.state);
    if ('error' in a) {
      aviso.textContent = a.error;
      aviso.hidden = false;
      return;
    }
    aviso.hidden = true;
    if (nuevo && areaNuevo.value.trim() !== '' && !formNuevo.hidden) {
      aviso.textContent = 'Termine o cancele el comentario que está escribiendo antes de empezar otro.';
      aviso.hidden = false;
      areaNuevo.focus();
      return;
    }
    recuperado.hidden = true;
    abrirNuevo(a);
  }

  async function cargar(): Promise<void> {
    try {
      const lista = await op.api.get<Comentario[]>(`/capitulos/${op.capituloId}/comentarios`);
      const delServidor = Array.isArray(lista) ? lista : [];
      const ids = new Set(delServidor.map((c) => c.id));
      // Los creados aquí mientras cargaba la lista no se pierden.
      comentarios = [...delServidor, ...comentarios.filter((c) => creadosAqui.has(c.id) && !ids.has(c.id))];
      listaCargada = true;
      errorCarga.hidden = true;
    } catch (e) {
      errorCarga.replaceChildren(
        `No se pudieron cargar sus comentarios: ${mensajeDe(e)} `,
        boton('Reintentar', () => void cargar(), 'secundario'),
      );
      errorCarga.hidden = false;
    }
    // Las ediciones recuperadas (leídas al crear el módulo) se asocian a su comentario.
    const recuperadas = new Map(edicionesHuerfanas);
    const repintar: EstadoItem[] = [];
    for (const [id, texto] of recuperadas) {
      if (typeof texto !== 'string') continue;
      const c = comentarios.find((x) => String(x.id) === id);
      if (!c) {
        edicionesHuerfanas.set(id, texto); // se conserva en el borrador (y se muestra si la lista cargó)
        continue;
      }
      edicionesHuerfanas.delete(id);
      const previo = items.get(c.id);
      if (previo?.modo === 'editar') continue;
      const it: EstadoItem = {
        c,
        modo: 'editar',
        edicion: texto,
        error: 'Edición recuperada de este navegador: aún no se guarda.',
        ocupado: false,
        li: previo?.li ?? el('li', { class: 'comentario-item', 'data-id': String(c.id) }),
      };
      items.set(c.id, it);
      repintar.push(it);
    }
    pintarLista();
    for (const it of repintar) pintarItem(it);
    pintarHuerfanas();
    op.alCambiar();
  }

  /*
   * Borrador de la sesión anterior: se lee una sola vez y ya, antes de que el editor o
   * "Comentar" se habiliten, así ninguna escritura puede pisarlo. El comentario nuevo se
   * restaura en el formulario en el acto (no necesita la lista) y "Comentar" no lo
   * reemplaza mientras tenga texto. Las ediciones quedan en `edicionesHuerfanas`, que
   * cada `escribirBorrador()` fusiona, hasta que la lista llega y se asocian.
   */
  const previo = leerBorrador();
  for (const [id, texto] of Object.entries(previo.ediciones ?? {})) {
    if (typeof texto === 'string') edicionesHuerfanas.set(id, texto);
  }
  const nuevoPrevio = previo.nuevo;
  if (
    nuevoPrevio &&
    typeof nuevoPrevio.texto === 'string' &&
    typeof nuevoPrevio.bloqueId === 'string' &&
    nuevoPrevio.rango &&
    typeof nuevoPrevio.rango.desde === 'number' &&
    typeof nuevoPrevio.rango.hasta === 'number'
  ) {
    abrirNuevo({ bloqueId: nuevoPrevio.bloqueId, rango: nuevoPrevio.rango, cita: String(nuevoPrevio.cita ?? '') }, nuevoPrevio.texto);
    recuperado.hidden = false;
  }
  aplicarHabilitado();

  return {
    elemento,
    botonComentar,
    cargar,
    comentar,
    habilitar(si) {
      habilitado = si;
      aplicarHabilitado();
    },
    decoraciones: (doc) => decoracionesComentarios(doc, comentarios),
    sinGuardar: () =>
      (!formNuevo.hidden && areaNuevo.value.trim() !== '') ||
      edicionesHuerfanas.size > 0 ||
      [...items.values()].some((it) => it.modo === 'editar' && it.edicion !== it.c.texto),
  };
}
