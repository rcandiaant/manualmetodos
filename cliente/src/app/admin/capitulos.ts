/**
 * Administración de capítulos (`#/admin/capitulos`): importa un `.tex` en el navegador,
 * muestra una vista previa con avisos y bloques `especial`, y lo sube con
 * `POST /admin/capitulos` (solo en preparación; docs/api.md §4.6).
 */
import { boton, el } from '../../editor/ui';
import { importarLatex } from '../../latex/importar';
import type { DocJSON } from '../../tipos';
import { ErrorApi, type Api } from '../api';
import type { Vista } from '../router';
import type { CapituloCreado, Consulta } from '../tipos-api';
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

  const errores = cajaError();
  const exito = el('div', { class: 'exito', role: 'status', hidden: '' });
  const bloqueo = el('div', { class: 'bloqueo', hidden: '' });
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

  function actualizarBloqueo(): void {
    const abierto = etapa === 'preparacion';
    btnSubir.disabled = !abierto || doc === null || subiendo;
    if (etapa !== null && !abierto) {
      bloqueo.textContent =
        'No se puede subir: solo se pueden subir capítulos en la etapa de preparación. ' +
        (etapa === 'consulta'
          ? 'La consulta ya está abierta y los laboratorios trabajan sobre la base actual.'
          : 'La consulta ya cerró y estamos en edición final.');
      bloqueo.hidden = false;
    } else bloqueo.hidden = true;
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
    if (!doc || etapa !== 'preparacion' || subiendo) return;
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
      } else if (e instanceof ErrorApi && e.estado === 409 && e.codigo === 'etapa_no_permite') {
        mostrar(errores, 'No se puede subir: solo se pueden subir capítulos en la etapa de preparación.');
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
          el('p', { class: 'ayuda' }, 'Elija el archivo .tex de un capítulo. Se importa en este navegador y se revisa antes de subirlo.'),
          el('label', { for: 'archivo-tex' }, 'Archivo .tex'),
          archivo,
          errores,
          exito,
          bloqueo,
          previa,
          formulario,
        ),
      );
      listo = api.get<Consulta>('/consulta').then(
        (c) => {
          if (!vigente) return;
          etapa = c.etapa;
          actualizarBloqueo();
        },
        (e: unknown) => {
          if (vigente) mostrar(errores, mensajeError(e));
        },
      );
    },
    desmontar() {
      vigente = false;
      doc = null;
      tex = '';
    },
  };
}
