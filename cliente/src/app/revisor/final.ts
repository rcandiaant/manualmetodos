/**
 * Versión final del capítulo (Task 7, spec §5.2):
 * - «Componer versión final» aplica sobre la base las sugerencias aceptadas
 *   (`aplicarSugerencias`) y abre un editor sobre el resultado, donde el revisor puede
 *   redactar su propia versión o editar directamente.
 * - «Guardar versión final» hace `PUT /capitulos/{id}/final` con `{docJson, tex}`; si ya
 *   hay una guardada (`GET …/final`), se ofrece retomarla.
 * - «Exportar .tex» descarga `slug.tex` (UTF-8, LF). Antes avisa en la página si el
 *   documento tiene caracteres sin forma LaTeX o referencias colgantes; el aviso se
 *   oculta si cambian las decisiones (comportamiento de la Fase 1A).
 * Los errores se muestran con role=alert y nunca se tragan.
 */
import { Editor } from '@tiptap/core';
import { aplicarSugerencias, completarGrupo } from '../../cambios/aplicar';
import { extensionesDemo } from '../../editor/editor';
import { boton, el, mensajeDe, NOMBRE_TIPO } from '../../editor/ui';
import { validarDocumento } from '../../esquema/esquema';
import { exportarLatex } from '../../latex/exportar';
import { caracteresNoSoportados, referenciasColgantes } from '../../latex/revision';
import type { DocJSON } from '../../tipos';
import { ErrorApi, SIN_CONEXION, type Api } from '../api';
import type { Etapa, Final, FinalEntrada, SugerenciaServidor } from '../tipos-api';
import { labDe, representantes } from './panel';

export interface OpcionesFinal {
  api: Api;
  capituloId: number;
  base: DocJSON;
  versionId: number;
  etapa: Etapa;
  /** Sugerencias del capítulo (se actualizan en el lugar al decidir). */
  sugerencias: SugerenciaServidor[];
  /** Nombre del archivo exportado (`slug.tex`). */
  nombreArchivo: string;
}

export interface PanelFinal {
  /** Las decisiones cambiaron: el aviso de exportación ya no vale. */
  decisionesCambiaron(): void;
  destruir(): void;
  listo: Promise<void>;
}

/** `cap-1` o, si no sirve, un slug ASCII simple del título (misma forma que exige el servidor: `[a-z0-9-]`). */
export function nombreTex(slug: string | undefined, titulo: string | undefined, capituloId: number): string {
  if (slug && /^[a-z0-9-]{1,80}$/.test(slug)) return `${slug}.tex`;
  const ascii = (titulo ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${ascii || `capitulo-${capituloId}`}.tex`;
}

/** Descarga `texto` como archivo UTF-8 con saltos LF. */
export function descargarTexto(nombre: string, texto: string): void {
  const url = URL.createObjectURL(new Blob([texto.replace(/\r\n?/g, '\n')], { type: 'text/plain;charset=utf-8' }));
  const a = el('a', { href: url, download: nombre });
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  // Revocar en el acto puede cortar la descarga en algunos navegadores.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function mensajeGuardar(e: unknown): string {
  if (e instanceof ErrorApi) {
    switch (e.codigo) {
      case SIN_CONEXION:
        return 'No hay conexión con el servidor: la versión final no se guardó. Intente de nuevo.';
      case 'etapa_no_permite':
        return 'La versión final solo se puede guardar en la edición final.';
      case 'documento_invalido':
        return `El servidor rechazó el documento: ${e.message}`;
      case 'cuerpo_muy_grande':
        return 'La versión final es demasiado grande para guardarla (más de 4 MB).';
      case 'sin_sesion':
        return 'La sesión venció: vuelva a entrar. La versión final sigue abierta en esta página.';
    }
  }
  return mensajeDe(e);
}

const punto = (c: string) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

export function montarFinal(contenedor: HTMLElement, op: OpcionesFinal): PanelFinal {
  let editor: Editor | null = null;
  let editado = false;
  let vigente = true;

  const errores = el('div', { class: 'error', role: 'alert', hidden: '' });
  const estado = el('p', { class: 'estado-final', role: 'status' });
  const retomar = el('div', { class: 'retomar-final', hidden: '' });
  const borrador = el('div', { class: 'aviso borrador-final', role: 'status', hidden: '' });

  /*
   * Borrador local de la versión final. El router no puede cancelar un `hashchange`
   * (ya ocurrió cuando avisa), así que en vez de un aviso al navegar dentro de la
   * aplicación, cada edición se copia a localStorage y se ofrece al volver. Si el
   * almacenamiento no está disponible, se sigue sin borrador (el aviso de beforeunload
   * sigue funcionando).
   */
  const claveBorrador = `mm:revisor:final:${op.capituloId}`;
  const guardarBorrador = (docJson: DocJSON) => {
    try {
      localStorage.setItem(claveBorrador, JSON.stringify({ docJson, fecha: new Date().toISOString() }));
    } catch {
      // sin almacenamiento local
    }
  };
  const borrarBorrador = () => {
    try {
      localStorage.removeItem(claveBorrador);
    } catch {
      // sin almacenamiento local
    }
  };
  const leerBorrador = (): { docJson: DocJSON; fecha: string } | null => {
    try {
      const d = JSON.parse(localStorage.getItem(claveBorrador) ?? 'null') as { docJson?: unknown; fecha?: unknown } | null;
      return d && typeof d.docJson === 'object' && d.docJson !== null && typeof d.fecha === 'string'
        ? { docJson: d.docJson as DocJSON, fecha: d.fecha }
        : null;
    } catch {
      return null;
    }
  };
  const confirmacion = el('div', { class: 'aviso confirmacion-final', hidden: '' });
  const desactualizada = el(
    'p',
    { class: 'aviso aviso-desactualizada', role: 'status', hidden: '' },
    'Las decisiones cambiaron desde que se abrió esta versión. Vuelva a componerla si quiere incluirlas.',
  );
  /** Aviso en la página (no `confirm`) con lo que el .tex no puede representar. */
  const aviso = el('div', { class: 'aviso aviso-exportar', role: 'alert', hidden: '' });
  const contenedorEditor = el('div', { class: 'contenedor-editor-final' });

  const puedeGuardar = op.etapa === 'edicion_final';
  const bComponer = boton('Componer versión final', () => pedirConfirmacion('componer', componer), 'primario');
  const bGuardar = boton('Guardar versión final', () => void guardar(), 'primario');
  const bExportar = boton('Exportar .tex', () => exportar(false));

  const mostrarError = (m: string | null) => {
    errores.textContent = m ?? '';
    errores.hidden = m === null;
  };

  function actualizarBotones(): void {
    bGuardar.disabled = editor === null || !puedeGuardar;
    bGuardar.title = puedeGuardar ? '' : 'La versión final solo se puede guardar en la edición final.';
    bExportar.disabled = editor === null;
  }

  /** Abrir otra versión descarta las ediciones directas no guardadas: se confirma en la página. */
  function pedirConfirmacion(que: 'componer' | 'retomar', accion: () => void): void {
    if (!editor || !editado) {
      accion();
      return;
    }
    confirmacion.replaceChildren(
      el(
        'p',
        {},
        que === 'componer'
          ? 'Volver a componer descarta las ediciones de la versión final que no guardó.'
          : 'Retomar la versión guardada descarta las ediciones de la versión final que no guardó.',
      ),
      el(
        'div',
        { class: 'botones' },
        boton('Descartar mis ediciones y continuar', () => {
          confirmacion.hidden = true;
          borrarBorrador();
          accion();
        }),
        boton('Cancelar', () => (confirmacion.hidden = true), 'secundario'),
      ),
    );
    confirmacion.hidden = false;
  }

  function abrirEditor(doc: DocJSON, mensaje: string): void {
    editor?.destroy();
    contenedorEditor.replaceChildren();
    const area = el('div', { class: 'editor editor-final', 'aria-label': 'Versión final (editable)' });
    contenedorEditor.append(area);
    editor = new Editor({ element: area, extensions: extensionesDemo(), content: structuredClone(doc), editable: true });
    editado = false;
    editor.on('update', () => {
      editado = true;
      aviso.hidden = true;
      if (editor) guardarBorrador(editor.getJSON() as DocJSON);
    });
    aviso.hidden = true;
    desactualizada.hidden = true;
    estado.textContent = mensaje;
    actualizarBotones();
  }

  /** Sugerencias cuyo id aparece en el mensaje de error, descritas para el revisor. */
  function implicadas(mensaje: string, sugs: SugerenciaServidor[]): string {
    const lista = sugs.filter((s) => mensaje.includes(s.id));
    if (lista.length === 0) return '';
    const describir = (s: SugerenciaServidor) =>
      `${labDe(s).laboratorio} (${s.grupo !== undefined ? 'bloque movido' : NOMBRE_TIPO[s.tipo].toLowerCase()} en el bloque ${s.bloqueId})`;
    return ` Sugerencias implicadas: ${lista.map(describir).join('; ')}.`;
  }

  function componer(): void {
    const vigentes = op.sugerencias.filter((s) => s.versionId === undefined || s.versionId === op.versionId);
    const aceptadas = vigentes.filter((s) => s.estado === 'aceptada');
    const anteriores = op.sugerencias.filter((s) => s.estado === 'aceptada' && !vigentes.includes(s)).length;
    try {
      // Un bloque movido va entero: si un miembro quedó sin aceptar, completarGrupo lanza.
      const completas = completarGrupo(aceptadas, vigentes, vigentes.filter((s) => s.estado !== 'aceptada'));
      // Una propuesta idéntica de varios laboratorios se aplica una sola vez: dos idénticas
      // de autores distintos chocan en detectarConflictos. Queda un representante por fila
      // colapsada, con su bloque movido entero.
      const conjunto = completarGrupo(representantes(completas as SugerenciaServidor[]).sugs, vigentes);
      const doc = aplicarSugerencias(op.base, conjunto);
      const v = validarDocumento(doc);
      if (!v.ok) throw new Error(`el documento resultante no cumple el esquema: ${v.error}`);
      mostrarError(null);
      abrirEditor(
        doc,
        `Versión compuesta con ${aceptadas.length === 1 ? '1 sugerencia aceptada' : `${aceptadas.length} sugerencias aceptadas`}. ` +
          'Puede redactar su propia versión o editar directamente antes de guardarla.' +
          (anteriores > 0 ? ` ${anteriores} aceptada(s) sobre una versión base anterior no se aplican.` : ''),
      );
    } catch (e) {
      const m = mensajeDe(e);
      mostrarError(`No se pudo componer la versión final: ${m}${implicadas(m, vigentes)}`);
    }
  }

  async function guardar(): Promise<void> {
    if (!editor) return;
    const docJson = editor.getJSON() as DocJSON;
    bGuardar.disabled = true;
    try {
      const v = validarDocumento(docJson);
      if (!v.ok) throw new Error(`la versión final no cumple el esquema: ${v.error}`);
      const cuerpo: FinalEntrada = { docJson, tex: exportarLatex(docJson) };
      const r = await op.api.put<{ versionId: number }>(`/capitulos/${op.capituloId}/final`, cuerpo);
      if (!vigente) return;
      editado = false;
      borrarBorrador();
      mostrarError(null);
      estado.textContent = `Versión final guardada (v${r.versionId}).`;
      mostrarRetomar({ versionId: r.versionId, docJson, tex: cuerpo.tex });
    } catch (e) {
      if (!vigente) return;
      mostrarError(`No se guardó la versión final: ${mensajeGuardar(e)}`);
    } finally {
      if (vigente) actualizarBotones();
    }
  }

  function mostrarAviso(caracteres: ReturnType<typeof caracteresNoSoportados>, colgantes: string[]): void {
    const lugar = (b: string | null) => (b === null ? 'en el título' : `en el bloque ${b}`);
    aviso.replaceChildren(
      el('strong', {}, 'Antes de exportar: el .tex final puede no compilar o perder información.'),
      ...(caracteres.length > 0
        ? [
            el('p', {}, 'Caracteres sin forma LaTeX conocida (pdflatex puede fallar o no mostrarlos):'),
            el('ul', {}, ...caracteres.map((c) => el('li', {}, `«${c.caracter}» (${punto(c.caracter)}) ${lugar(c.bloqueId)}`))),
          ]
        : []),
      ...(colgantes.length > 0
        ? [
            el('p', {}, 'Referencias a etiquetas que ningún ítem declara (saldrán como «??»):'),
            el('ul', {}, ...colgantes.map((e) => el('li', {}, e))),
          ]
        : []),
      el(
        'div',
        { class: 'botones' },
        boton('Exportar de todos modos', () => exportar(true), 'primario'),
        boton('Cancelar', () => (aviso.hidden = true), 'secundario'),
      ),
    );
    aviso.hidden = false;
  }

  function exportar(deTodosModos: boolean): void {
    if (!editor) return;
    try {
      const doc = editor.getJSON() as DocJSON;
      if (!deTodosModos) {
        const caracteres = caracteresNoSoportados(doc);
        const colgantes = referenciasColgantes(doc);
        if (caracteres.length > 0 || colgantes.length > 0) {
          mostrarAviso(caracteres, colgantes);
          return;
        }
      }
      aviso.hidden = true;
      descargarTexto(op.nombreArchivo, exportarLatex(doc));
      mostrarError(null);
    } catch (e) {
      mostrarError(`No se pudo exportar: ${mensajeDe(e)}`);
    }
  }

  contenedor.replaceChildren(
    el('h2', {}, 'Versión final'),
    el(
      'p',
      { class: 'nota' },
      'Se aplican solo las sugerencias aceptadas. Las marcadas «Redactar otra» quedan como modificadas: escriba su versión en el editor.',
    ),
    borrador,
    retomar,
    el('div', { class: 'botones acciones-final' }, bComponer, bGuardar, bExportar),
    errores,
    confirmacion,
    desactualizada,
    aviso,
    estado,
    contenedorEditor,
  );
  actualizarBotones();

  // Borrador local de una sesión anterior (se salió de la vista o de la página sin guardar).
  const previo = leerBorrador();
  if (previo) {
    const cuando = new Date(previo.fecha).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' });
    borrador.replaceChildren(
      el('span', {}, `Hay un borrador local de la versión final que no se guardó en el servidor (${cuando}). `),
      boton('Recuperar el borrador local', () =>
        pedirConfirmacion('retomar', () => {
          abrirEditor(previo.docJson, 'Borrador local recuperado: aún no está guardado en el servidor.');
          editado = true;
          borrador.hidden = true;
        }),
      ),
      ' ',
      boton(
        'Descartar el borrador',
        () => {
          borrarBorrador();
          borrador.hidden = true;
        },
        'secundario',
      ),
    );
    borrador.hidden = false;
  }

  /** Ediciones sin guardar: el navegador pregunta antes de cerrar o recargar la página. */
  const alSalir = (ev: BeforeUnloadEvent) => {
    if (!editor || !editado) return;
    ev.preventDefault();
    ev.returnValue = '';
  };
  window.addEventListener('beforeunload', alSalir);

  function mostrarRetomar(f: Final): void {
    retomar.replaceChildren(
      el('span', {}, `Hay una versión final guardada (v${f.versionId}). `),
      boton('Retomar la versión final guardada', () =>
        pedirConfirmacion('retomar', () => abrirEditor(f.docJson, `Versión final guardada (v${f.versionId}) abierta para seguir editándola.`)),
      ),
    );
    retomar.hidden = false;
  }

  const listo = op.api.get<Final>(`/capitulos/${op.capituloId}/final`).then(
    (f) => {
      if (!vigente) return;
      mostrarRetomar(f);
    },
    (e: unknown) => {
      if (!vigente || (e instanceof ErrorApi && e.codigo === 'no_encontrado')) return;
      mostrarError(`No se pudo consultar la versión final guardada: ${mensajeDe(e)}`);
    },
  );

  return {
    decisionesCambiaron() {
      aviso.hidden = true;
      if (editor) desactualizada.hidden = false;
    },
    destruir() {
      // Las ediciones sin guardar ya están en el borrador local: se ofrecen al volver.
      vigente = false;
      window.removeEventListener('beforeunload', alSalir);
      editor?.destroy();
      editor = null;
    },
    listo,
  };
}
