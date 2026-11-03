/**
 * Administración de capítulos (`#/admin/capitulos`): importa un `.tex` en el navegador,
 * muestra una vista previa con avisos y bloques `especial`, y lo sube con
 * `POST /admin/capitulos` en cualquier etapa (docs/api.md §4.6). Si el slug ya existe, la subida
 * reemplaza el texto de ese capítulo, y el servidor lo rechaza (409) si ya tiene aportes.
 *
 * También lista los capítulos subidos: el orden y el título se editan en cualquier etapa
 * (`PATCH /admin/capitulos/{id}`) y un capítulo sin aportes se borra en cualquier etapa
 * (`DELETE /admin/capitulos/{id}`), con una confirmación en la página.
 */
import { boton, el } from '../../editor/ui';
import { importarLatex } from '../../latex/importar';
import type { DocJSON } from '../../tipos';
import { ErrorApi, type Api } from '../api';
import type { Vista } from '../router';
import type { CapituloCambio, CapituloCreado, CapituloLista, Consulta } from '../tipos-api';
import { cabeceraAdmin, cajaError, mensajeError, mostrar } from './comun';

/** Slug desde el nombre del archivo: minúsculas, sin tildes, con guiones (máx. 80). */
export function proponerSlug(nombre: string): string {
  const base = nombre
    .replace(/\.[A-Za-z0-9]+$/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return base || 'capitulo';
}

const RE_SLUG = /^[a-z0-9-]{1,80}$/;

function textoDe(n: DocJSON | undefined): string {
  if (!n) return '';
  if (typeof n.text === 'string') return n.text;
  return (n.content ?? []).map(textoDe).join('');
}

/** Recorre el documento y junta los nodos `especial` / `especialInline`. */
export function especialesDe(doc: DocJSON): string[] {
  const res: string[] = [];
  const ir = (n: DocJSON) => {
    if (n.type === 'especial' || n.type === 'especialInline') res.push(String(n.attrs?.latex ?? ''));
    for (const h of n.content ?? []) ir(h);
  };
  ir(doc);
  return res;
}

const recorte = (s: string, max = 160): string => (s.length > max ? `${s.slice(0, max)}…` : s);

const MAX_ORDEN = 100000;

/** Orden de la lista: por `orden` y, a igualdad, por `id` (como `GET /capitulos`). */
const porOrden = (a: CapituloLista, b: CapituloLista): number => a.orden - b.orden || a.id - b.id;

/**
 * Lo escrito en una fila y aún no guardado: sobrevive a los redibujados de la lista.
 * Guarda además los valores del servidor sobre los que se escribió: si una recarga trae otros
 * (p. ej. el capítulo se volvió a subir), el borrador se descarta para no revertirlos al guardar.
 */
interface Borrador {
  orden: string;
  titulo: string;
  baseOrden: number;
  baseTitulo: string;
}

export interface VistaCapitulos extends Vista {
  /** Promesa de la última operación asíncrona (carga de la etapa, subida). */
  readonly listo: Promise<void>;
  /** Importa el texto de un `.tex` y muestra la vista previa. */
  cargar(nombreArchivo: string, tex: string): void;
}

export function vistaCapitulos(api: Api): VistaCapitulos {
  let vigente = true;
  let listo: Promise<void> = Promise.resolve();
  let etapa: Consulta['etapa'] | null = null;
  let tex = '';
  let doc: DocJSON | null = null;
  let subiendo = false;
  let capitulos: CapituloLista[] = [];
  const borradores = new Map<number, Borrador>();
  let confirmando: number | null = null;
  let operando = false;

  const errores = cajaError();
  const exito = el('div', { class: 'exito', role: 'status', hidden: '' });
  const notaEtapa = el('p', { class: 'ayuda nota-etapa-capitulos', hidden: '' });
  const avisoReemplazo = el('div', { class: 'aviso-reemplazo', role: 'status', hidden: '' });
  const previa = el('section', { class: 'vista-previa', hidden: '' });
  const formulario = el('div', { class: 'formulario', hidden: '' });
  const entradaSlug = el('input', { name: 'slug', type: 'text', maxlength: '80', required: '' });
  const entradaTitulo = el('input', { name: 'titulo', type: 'text', maxlength: '255', required: '' });
  const entradaOrden = el('input', { name: 'orden', type: 'number', min: '0', max: '100000', step: '1', value: '1' });
  const errorSlug = el('div', { class: 'error-campo', 'data-campo': 'slug', role: 'alert', hidden: '' });
  const errorTitulo = el('div', { class: 'error-campo', 'data-campo': 'titulo', role: 'alert', hidden: '' });
  const errorOrden = el('div', { class: 'error-campo', 'data-campo': 'orden', role: 'alert', hidden: '' });
  const errorDoc = el('div', { class: 'error-campo', 'data-campo': 'docJson', role: 'alert', hidden: '' });
  const errorTex = el('div', { class: 'error-campo', 'data-campo': 'texOriginal', role: 'alert', hidden: '' });
  const porCampo: Record<string, HTMLElement> = {
    slug: errorSlug,
    titulo: errorTitulo,
    orden: errorOrden,
    docJson: errorDoc,
    texOriginal: errorTex,
  };
  const btnSubir = boton('Subir', () => void subir(), 'primario');

  const erroresLista = cajaError();
  const estadoLista = el('div', { class: 'estado-lista', role: 'status', hidden: '' });
  const cuerpoLista = el('tbody');

  function borradorDe(c: CapituloLista): Borrador {
    return borradores.get(c.id) ?? { orden: String(c.orden), titulo: c.titulo, baseOrden: c.orden, baseTitulo: c.titulo };
  }

  function filaCapitulo(c: CapituloLista): HTMLTableRowElement {
    const b = borradorDe(c);
    const orden = el('input', {
      type: 'number',
      name: `orden-${c.id}`,
      min: '0',
      max: String(MAX_ORDEN),
      step: '1',
      class: 'orden-capitulo',
      'aria-label': `Orden de «${c.titulo}»`,
    });
    const titulo = el('input', {
      type: 'text',
      name: `titulo-${c.id}`,
      maxlength: '255',
      class: 'titulo-capitulo',
      'aria-label': `Título de «${c.titulo}»`,
    });
    orden.value = b.orden;
    titulo.value = b.titulo;
    // Solo hay borrador si lo escrito difiere de lo guardado.
    const recordar = () => {
      if (orden.value === String(c.orden) && titulo.value === c.titulo) borradores.delete(c.id);
      else borradores.set(c.id, { orden: orden.value, titulo: titulo.value, baseOrden: c.orden, baseTitulo: c.titulo });
    };
    for (const entrada of [orden, titulo]) {
      entrada.addEventListener('input', recordar);
      entrada.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        recordar();
        void guardar(c);
      });
    }
    const btnGuardar = boton('Guardar', () => {
      recordar();
      void guardar(c);
    });
    // Se puede borrar en cualquier etapa; si el capítulo tiene aportes, el servidor responde 409 y se muestra su mensaje.
    const btnBorrar = boton(
      'Borrar',
      () => {
        recordar();
        confirmando = c.id;
        dibujarLista();
        cuerpoLista.querySelector<HTMLButtonElement>('.confirmar .cancelar')?.focus();
      },
      'borrar-capitulo',
    );
    const acciones = el('div', { class: 'acciones' }, btnGuardar, btnBorrar);
    const fila = el(
      'tr',
      { 'data-id': String(c.id) },
      el('td', {}, orden),
      el('td', {}, titulo),
      el('td', {}, el('code', {}, c.slug)),
      el('td', {}, acciones),
    );
    if (confirmando === c.id) {
      fila.lastElementChild?.append(
        el(
          'div',
          { class: 'confirmar' },
          el('p', {}, `¿Borrar el capítulo "${c.titulo}"? Esta acción no se puede deshacer.`),
          el(
            'div',
            { class: 'acciones' },
            boton('Borrar definitivamente', () => void borrar(c), 'borrar-definitivo'),
            boton(
              'Cancelar',
              () => {
                confirmando = null;
                dibujarLista();
              },
              'cancelar',
            ),
          ),
        ),
      );
    }
    return fila;
  }

  function dibujarLista(): void {
    // Las filas se recrean: si el foco estaba en un campo de la lista, se devuelve al mismo campo.
    const activo = document.activeElement;
    const conFoco = activo instanceof HTMLInputElement && cuerpoLista.contains(activo) ? activo.name : null;
    cuerpoLista.replaceChildren(...capitulos.map(filaCapitulo));
    if (capitulos.length === 0) {
      cuerpoLista.append(el('tr', {}, el('td', { colspan: '4', class: 'vacio' }, 'Aún no hay capítulos subidos.')));
    }
    if (conFoco) cuerpoLista.querySelector<HTMLInputElement>(`input[name="${conFoco}"]`)?.focus();
  }

  async function cargarLista(): Promise<void> {
    const lista = await api.get<CapituloLista[]>('/capitulos');
    if (!vigente) return;
    capitulos = [...lista].sort(porOrden);
    for (const [id, b] of [...borradores]) {
      const c = capitulos.find((x) => x.id === id);
      if (!c || c.orden !== b.baseOrden || c.titulo !== b.baseTitulo) borradores.delete(id);
    }
    dibujarLista();
    actualizarBloqueo(); // el aviso de reemplazo depende de los slugs existentes
  }

  async function hacerGuardado(c: CapituloLista): Promise<void> {
    if (operando) return;
    mostrar(erroresLista, null);
    estadoLista.hidden = true;
    const b = borradorDe(c);
    const titulo = b.titulo.trim();
    const orden = Number(b.orden);
    if (b.orden.trim() === '' || !Number.isInteger(orden) || orden < 0 || orden > MAX_ORDEN) {
      mostrar(erroresLista, `«${c.titulo}»: el orden es un entero de 0 a 100 000.`);
      return;
    }
    if (titulo.length < 1 || titulo.length > 255) {
      mostrar(erroresLista, `«${c.titulo}»: el título debe tener de 1 a 255 caracteres.`);
      return;
    }
    const cambio: CapituloCambio = {};
    if (orden !== c.orden) cambio.orden = orden;
    if (titulo !== c.titulo) cambio.titulo = titulo;
    if (cambio.orden === undefined && cambio.titulo === undefined) {
      borradores.delete(c.id);
      dibujarLista();
      mostrar(estadoLista, 'Sin cambios.');
      return;
    }
    operando = true;
    try {
      await api.patch(`/admin/capitulos/${c.id}`, cambio);
      if (!vigente) return;
      if (cambio.orden !== undefined) c.orden = cambio.orden;
      if (cambio.titulo !== undefined) c.titulo = cambio.titulo;
      borradores.delete(c.id);
      capitulos.sort(porOrden);
      dibujarLista();
      mostrar(estadoLista, 'Guardado.');
    } catch (e) {
      // No se redibuja: lo escrito sigue en los campos (y en el borrador).
      if (vigente) mostrar(erroresLista, `No se pudo guardar «${c.titulo}»: ${mensajeError(e)}`);
    } finally {
      operando = false;
    }
  }

  function guardar(c: CapituloLista): Promise<void> {
    listo = hacerGuardado(c);
    return listo;
  }

  async function hacerBorrado(c: CapituloLista): Promise<void> {
    if (operando) return;
    mostrar(erroresLista, null);
    estadoLista.hidden = true;
    operando = true;
    try {
      await api.del(`/admin/capitulos/${c.id}`);
      if (!vigente) return;
      capitulos = capitulos.filter((x) => x.id !== c.id);
      borradores.delete(c.id);
      confirmando = null;
      dibujarLista();
      mostrar(estadoLista, `Capítulo "${c.titulo}" borrado.`);
    } catch (e) {
      if (!vigente) return;
      confirmando = null;
      dibujarLista();
      // Un 409 (aportes) trae del servidor la explicación concreta.
      mostrar(erroresLista, e instanceof ErrorApi && e.estado === 409 ? e.message : mensajeError(e));
    } finally {
      operando = false;
    }
  }

  function borrar(c: CapituloLista): Promise<void> {
    listo = hacerBorrado(c);
    return listo;
  }

  /** El capítulo que la subida reemplazaría (mismo slug), o undefined si es uno nuevo. */
  const existente = (): CapituloLista | undefined => capitulos.find((c) => c.slug === entradaSlug.value.trim());

  /** Botón Subir, aviso de reemplazo y nota de la etapa (solo informativa: no bloquea nada). */
  function actualizarBloqueo(): void {
    btnSubir.disabled = doc === null || subiendo;
    const otro = doc === null ? undefined : existente();
    btnSubir.textContent = otro ? 'Subir y reemplazar' : 'Subir';
    if (otro) {
      avisoReemplazo.textContent =
        `Ya existe un capítulo con el slug «${otro.slug}»: la subida reemplazará el texto de "${otro.titulo}". ` +
        'Solo es posible si ningún laboratorio trabajó en él todavía.';
      avisoReemplazo.hidden = false;
    } else avisoReemplazo.hidden = true;
    if (etapa === 'consulta' || etapa === 'edicion_final') {
      notaEtapa.textContent =
        etapa === 'consulta'
          ? 'La consulta está abierta: un capítulo nuevo queda disponible para los laboratorios apenas se sube.'
          : 'La consulta ya cerró (edición final): un capítulo nuevo queda disponible para el revisor, sin aportes de laboratorios.';
      notaEtapa.hidden = false;
    } else notaEtapa.hidden = true;
  }

  function limpiarCampos(): void {
    for (const c of Object.values(porCampo)) mostrar(c, null);
  }

  function cargar(nombre: string, texto: string): void {
    mostrar(errores, null);
    exito.hidden = true;
    limpiarCampos();
    tex = texto;
    let r;
    try {
      r = importarLatex(texto);
    } catch (e) {
      doc = null;
      previa.hidden = true;
      formulario.hidden = true;
      mostrar(errores, `No se pudo importar el archivo: ${e instanceof Error ? e.message : String(e)}`);
      actualizarBloqueo();
      return;
    }
    doc = r.doc;
    const especiales = especialesDe(r.doc);
    const bloques = r.doc.content ?? [];
    entradaSlug.value = proponerSlug(nombre);
    const titulo = textoDe(bloques[0]).trim();
    entradaTitulo.value = titulo || entradaSlug.value;

    previa.replaceChildren(
      el('h2', {}, 'Vista previa de la importación'),
      el('p', {}, `Bloques: ${bloques.length}`),
      el('p', {}, `Bloques especiales: ${especiales.length}`),
      especiales.length
        ? el(
            'ul',
            { class: 'especiales' },
            ...especiales.map((l) => el('li', {}, el('code', {}, recorte(l)))),
          )
        : '',
      el('p', {}, `Avisos: ${r.avisos.length}`),
      r.avisos.length ? el('ul', { class: 'avisos' }, ...r.avisos.map((a) => el('li', {}, a))) : '',
      el(
        'ol',
        { class: 'esquema-previo' },
        ...bloques.map((b) => el('li', {}, el('strong', {}, `${b.type ?? '?'} `), recorte(textoDe(b) || String(b.attrs?.latex ?? ''), 100))),
      ),
    );
    previa.hidden = false;
    formulario.hidden = false;
    actualizarBloqueo();
  }

  async function hacerSubida(): Promise<void> {
    if (!doc || subiendo) return;
    mostrar(errores, null);
    exito.hidden = true;
    limpiarCampos();
    const slug = entradaSlug.value.trim();
    const titulo = entradaTitulo.value.trim();
    const orden = Number(entradaOrden.value);
    let ok = true;
    if (!RE_SLUG.test(slug)) {
      mostrar(errorSlug, 'El slug usa solo minúsculas, números y guiones (1 a 80).');
      ok = false;
    }
    if (titulo.length < 1 || titulo.length > 255) {
      mostrar(errorTitulo, 'El título debe tener de 1 a 255 caracteres.');
      ok = false;
    }
    if (!Number.isInteger(orden) || orden < 0 || orden > 100000) {
      mostrar(errorOrden, 'El orden es un entero de 0 a 100 000.');
      ok = false;
    }
    if (new TextEncoder().encode(tex).length > 1_048_576) {
      mostrar(errorTex, 'El archivo supera 1 MB.');
      ok = false;
    }
    if (!ok) return;
    subiendo = true;
    actualizarBloqueo();
    try {
      const r = await api.post<CapituloCreado>('/admin/capitulos', { slug, titulo, orden, texOriginal: tex, docJson: doc });
      if (!vigente) return;
      exito.textContent = `Capítulo subido (id ${r.id}, versión base ${r.versionId}).`;
      exito.hidden = false;
      await cargarLista().catch((e: unknown) => {
        if (vigente) mostrar(erroresLista, mensajeError(e));
      });
    } catch (e) {
      if (!vigente) return;
      if (e instanceof ErrorApi && e.estado === 400 && e.campos) {
        let alguno = false;
        for (const [k, v] of Object.entries(e.campos)) {
          if (porCampo[k]) {
            mostrar(porCampo[k], v);
            alguno = true;
          }
        }
        if (!alguno) mostrar(errores, mensajeError(e));
      } else if (e instanceof ErrorApi && e.estado === 409) {
        // p. ej. «N laboratorios ya trabajaron en este capítulo; no se puede reemplazar el texto.»
        mostrar(errores, e.message);
      } else mostrar(errores, mensajeError(e));
    } finally {
      subiendo = false;
      if (vigente) actualizarBloqueo();
    }
  }

  function subir(): Promise<void> {
    listo = hacerSubida();
    return listo;
  }

  return {
    get listo() {
      return listo;
    },
    cargar,
    montar(raiz) {
      const archivo = el('input', { type: 'file', accept: '.tex,text/x-tex,text/plain', id: 'archivo-tex' });
      archivo.addEventListener('change', () => {
        const f = archivo.files?.[0];
        if (!f) return;
        void f.text().then(
          (t) => vigente && cargar(f.name, t),
          (e: unknown) => vigente && mostrar(errores, mensajeError(e)),
        );
      });
      entradaSlug.addEventListener('input', actualizarBloqueo);
      formulario.append(
        el('label', { for: 'cap-slug' }, 'Slug'),
        entradaSlug,
        errorSlug,
        el('label', { for: 'cap-titulo' }, 'Título'),
        entradaTitulo,
        errorTitulo,
        el('label', { for: 'cap-orden' }, 'Orden'),
        entradaOrden,
        errorOrden,
        errorDoc,
        errorTex,
        avisoReemplazo,
        btnSubir,
      );
      entradaSlug.id = 'cap-slug';
      entradaTitulo.id = 'cap-titulo';
      entradaOrden.id = 'cap-orden';
      raiz.append(
        el(
          'main',
          { class: 'app admin' },
          cabeceraAdmin('Capítulos'),
          el(
            'section',
            { class: 'lista-capitulos' },
            el('h2', {}, 'Capítulos subidos'),
            el(
              'p',
              { class: 'ayuda' },
              'El orden y el título se pueden cambiar en cualquier etapa (Guardar o Enter). Un capítulo se puede borrar en cualquier etapa mientras no tenga aportes de laboratorios ni versión final.',
            ),
            erroresLista,
            estadoLista,
            el(
              'table',
              { class: 'tabla' },
              el('thead', {}, el('tr', {}, ...['Orden', 'Título', 'Slug', 'Acciones'].map((t) => el('th', {}, t)))),
              cuerpoLista,
            ),
          ),
          el('h2', {}, 'Subir un capítulo'),
          el(
            'p',
            { class: 'ayuda' },
            'Elija el archivo .tex de un capítulo. Se importa en este navegador y se revisa antes de subirlo. Se puede subir en cualquier etapa. Para reemplazar el texto de un capítulo, súbalo de nuevo con el mismo slug: solo es posible si ningún laboratorio trabajó en él.',
          ),
          el('label', { for: 'archivo-tex' }, 'Archivo .tex'),
          archivo,
          errores,
          exito,
          notaEtapa,
          previa,
          formulario,
        ),
      );
      const cargaEtapa = api.get<Consulta>('/consulta').then(
        (c) => {
          if (!vigente) return;
          etapa = c.etapa;
          actualizarBloqueo();
        },
        (e: unknown) => {
          if (vigente) mostrar(errores, mensajeError(e));
        },
      );
      const cargaLista = cargarLista().catch((e: unknown) => {
        if (vigente) mostrar(erroresLista, mensajeError(e));
      });
      listo = Promise.all([cargaEtapa, cargaLista]).then(() => undefined);
    },
    desmontar() {
      vigente = false;
      doc = null;
      tex = '';
      capitulos = [];
      borradores.clear();
      cuerpoLista.replaceChildren();
    },
  };
}
