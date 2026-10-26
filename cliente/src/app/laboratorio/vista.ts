/**
 * Vista `#/capitulo/{id}` del laboratorio: edita su copia del capítulo con control de
 * cambios estilo Word y autoguardado (docs/api.md §4.2–4.3; spec §5.1).
 *
 * - Carga `GET …/base`, `GET …/copia` y `GET /consulta` (etapa).
 * - Borrador local distinto de lo que tiene el servidor:
 *   - si se escribió sobre la misma copia que el servidor tiene ahora (p. ej. la sesión
 *     venció antes de guardar), se recupera y se guarda solo, con un aviso visible;
 *   - si no, se ofrece "Recuperar borrador no guardado" o "Descartarlo" (el editor no se
 *     puede tocar hasta decidir, para no pisar el borrador);
 *   - fuera de la etapa `consulta`, se ofrece para copiar.
 * - Solo lectura fuera de la etapa `consulta` o cuando un guardado responde 409
 *   `etapa_no_permite` o `version_obsoleta` (con el borrador no guardado ofrecido para copiar).
 * - Indicador "Guardado hace N s" o el estado del autoguardado; los fallos van además
 *   en una caja `role="alert"`.
 * - Panel lateral (Task 5): "Mis cambios" con motivos (`panel.ts`), comentarios
 *   (`comentarios.ts`, botón "Comentar" en la barra) y, en `edicion_final`, "Mis aportes".
 *   En solo lectura los motivos y comentarios no se editan, pero las listas se ven.
 */
import { Editor } from '@tiptap/core';
import { avisosNoCubiertos } from '../../cambios/estructura';
import { calcularSugerencias } from '../../cambios/sugerencias';
import { jsonEstable } from '../../cambios/tokens';
import { crearBarra, type Barra } from '../../editor/barra';
import { claveDecoraciones, decoracionesDeCambios, textoVisible } from '../../editor/decoraciones';
import { boton, cajaAvisosEstructura, el, mensajeDe, resaltar } from '../../editor/ui';
import type { DocJSON } from '../../tipos';
import { ErrorApi, SIN_CONEXION, type Api } from '../api';
import { formatearFecha } from '../inicio';
import type { Vista } from '../router';
import { claveAutor, tieneRol } from '../sesion';
import type { Base, Consulta, Copia, FechaIso, Usuario } from '../tipos-api';
import {
  borrarBorrador,
  claveBorrador,
  crearAutoguardado,
  leerBorrador,
  MENSAJES,
  type Autoguardado,
  type Borrador,
  type InfoGuardado,
  type Reloj,
} from './autoguardado';
import { crearComentarios, type Comentarios } from './comentarios';
import './laboratorio.css';
import { cajaBorradoresSinEnviar, crearMisAportes, crearPanelCambios, type PanelCambios } from './panel';
import { extensionesLaboratorio, PERMITIR_ESPECIAL } from './protegidos';

export interface DepsCapitulo {
  almacen?: Storage;
  esperaMs?: number;
  reloj?: Reloj;
}

export type VistaCapitulo = Vista & { listo: Promise<void>; editor(): Editor | null };

/** Espera tras la última tecla antes de recalcular marcas y avisar al autoguardado. */
const ESPERA_RECALCULO_MS = 300;

function almacenLocal(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** "hace 5 s", "hace 3 min" o "el 03-11-2026 12:00". */
export function haceCuanto(desde: Date, ahora: Date): string {
  const s = Math.max(0, Math.round((ahora.getTime() - desde.getTime()) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  return `el ${formatearFecha(desde.toISOString())}`;
}

/** Texto plano de un documento (para copiar un borrador que ya no se puede guardar). */
export function textoDocumento(d: DocJSON): string {
  return (d.content ?? []).map((b) => textoVisible([b])).join('\n\n');
}

export function vistaCapitulo(api: Api, u: Usuario, idTexto: string, deps: DepsCapitulo = {}): VistaCapitulo {
  const almacen = deps.almacen ?? almacenLocal();
  const autor = claveAutor(u);
  let vigente = true;
  let listo: Promise<void> = Promise.resolve();

  let editor: Editor | null = null;
  let barra: Barra | null = null;
  let ag: Autoguardado | null = null;
  let panelCambios: PanelCambios | null = null;
  let comentarios: Comentarios | null = null;
  let base: DocJSON | null = null;
  let ultimoServidor: Date | undefined;
  let soloLectura = true;
  let cerrada = false;
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  let intervalo: ReturnType<typeof setInterval> | null = null;

  const titulo = el('h1', {}, 'Capítulo');
  const estado = el('span', { class: 'estado-guardado', 'aria-live': 'polite' });
  const avisoEtapa = el('div', { class: 'aviso aviso-etapa' });
  avisoEtapa.hidden = true;
  const errorGuardado = el('div', { class: 'error error-guardado', role: 'alert' });
  errorGuardado.hidden = true;
  const errorCalculo = el('div', { class: 'error', role: 'alert' });
  errorCalculo.hidden = true;
  const avisoBorrador = el('div', { class: 'aviso aviso-borrador' });
  avisoBorrador.hidden = true;
  const avisosEstructura = el('div', { class: 'aviso aviso-estructura', role: 'alert' });
  avisosEstructura.hidden = true;
  const areaBarra = el('div', { class: 'area-barra' });
  const areaEditor = el('div', { class: 'editor', 'data-modo': 'laboratorio' });
  const panel = el('aside', { class: 'panel panel-lab', 'aria-label': 'Panel del capítulo' }, avisosEstructura);

  const reloj = (): Date => deps.reloj?.ahora() ?? new Date();

  /* ---------- Marcas y autoguardado ---------- */

  function recalcular(): DocJSON | null {
    if (!editor || !base) return null;
    const doc = editor.state.doc;
    const copia = doc.toJSON() as DocJSON;
    try {
      const sugerencias = calcularSugerencias(base, copia, autor);
      panelCambios?.actualizar(sugerencias);
      const set = decoracionesDeCambios(doc, sugerencias, base).add(doc, comentarios?.decoraciones(doc) ?? []);
      editor.view.dispatch(editor.state.tr.setMeta(claveDecoraciones, set).setMeta('addToHistory', false));
      cajaAvisosEstructura(
        avisosEstructura,
        avisosNoCubiertos(base, copia, sugerencias),
        'Cambios de estructura que no se aplicarán: deshágalos (Ctrl+Z) y, si hace falta, ' +
          'elimine el bloque y escríbalo de nuevo donde corresponde, o explíquelo en un comentario.',
      );
      errorCalculo.hidden = true;
    } catch (e) {
      errorCalculo.hidden = false;
      errorCalculo.textContent = `No se pudieron calcular los cambios: ${mensajeDe(e)}`;
    }
    return copia;
  }

  /** Recalcula ya lo que esté esperando y se lo pasa al autoguardado. */
  function vaciarEspera(): void {
    if (temporizador === null) return;
    clearTimeout(temporizador);
    temporizador = null;
    const copia = recalcular();
    if (copia && ag && !soloLectura) ag.cambio(copia);
  }

  function alEditar(): void {
    if (soloLectura) return;
    if (temporizador !== null) clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      temporizador = null;
      const copia = recalcular();
      if (copia && ag) ag.cambio(copia);
    }, ESPERA_RECALCULO_MS);
    if (ag && ag.estado().estado === 'guardado') pintarIndicador({ estado: 'pendiente', mensaje: 'Cambios sin guardar…' });
  }

  function cargarDoc(d: DocJSON): void {
    if (!editor) return;
    editor
      .chain()
      .setMeta(PERMITIR_ESPECIAL, true)
      .setMeta('addToHistory', false)
      .setContent(structuredClone(d), { emitUpdate: false })
      .run();
    recalcular();
  }

  function fijarEditable(si: boolean): void {
    editor?.setEditable(si, false); // sin evento update: no es una edición
    barra?.habilitar(si);
    panelCambios?.habilitar(si);
    comentarios?.habilitar(si);
  }

  /** Un motivo espera una sugerencia que aún no está en el servidor: se guarda la copia ya. */
  function pedirGuardado(): void {
    if (!ag || !editor || soloLectura) return;
    vaciarEspera();
    if (!ag.sinConfirmar()) ag.cambio(editor.getJSON() as DocJSON);
    void ag.guardarYa();
  }

  /** Un PATCH/POST/DELETE del panel respondió 409 `etapa_no_permite`. */
  function alEtapaCerrada(): void {
    if (!cerrada) alCambiarEstado({ estado: 'cerrada', mensaje: MENSAJES.cerrada });
  }

  /* ---------- Indicador y errores ---------- */

  function pintarIndicador(info: InfoGuardado): void {
    estado.className = `estado-guardado estado-${info.estado}`;
    if (info.estado === 'guardado') {
      const ultimo = info.ultimoGuardado ?? ultimoServidor;
      estado.textContent = ultimo ? `Guardado ${haceCuanto(ultimo, reloj())}` : 'Sin cambios por guardar';
    } else {
      estado.textContent = info.mensaje;
    }
  }

  /** Caja con el texto del borrador para copiarlo a mano. */
  function cajaCopiar(d: DocJSON): HTMLElement {
    const area = el('textarea', { class: 'borrador-texto', readonly: '', rows: '6', 'aria-label': 'Texto del borrador no guardado' });
    area.value = textoDocumento(d);
    const copiar = boton('Copiar texto', () => {
      area.select();
      void navigator.clipboard?.writeText(area.value).catch(() => {});
    });
    return el('div', { class: 'copiar-borrador' }, area, copiar);
  }

  function alCambiarEstado(info: InfoGuardado): void {
    if (!vigente) return;
    pintarIndicador(info);
    const obsoleta = info.estado === 'error' && info.codigo === 'version_obsoleta';
    if (info.estado === 'cerrada' || obsoleta) {
      // Fallo terminal: el borrador ya no se podrá enviar (la clave es de esta versión base).
      cerrada = true;
      soloLectura = true;
      fijarEditable(false);
      const pendiente = ag?.sinConfirmar();
      errorGuardado.replaceChildren(
        el(
          'strong',
          {},
          obsoleta
            ? 'La versión del capítulo cambió en el servidor: esta página quedó en solo lectura. Recárguela para seguir sobre la versión vigente. '
            : 'La consulta se cerró: el capítulo quedó en solo lectura. ',
        ),
        pendiente
          ? 'Los últimos cambios no alcanzaron a guardarse en el servidor. Quedan en este navegador; puede copiarlos aquí:'
          : 'Todos sus cambios anteriores quedaron guardados.',
        ...(pendiente ? [cajaCopiar(pendiente)] : []),
        ...(panelCambios?.sinGuardar() || comentarios?.sinGuardar()
          ? [el('p', {}, 'Hay motivos o comentarios sin guardar: siguen en sus campos del panel para que pueda copiarlos.')]
          : []),
      );
      errorGuardado.hidden = false;
      return;
    }
    if (cerrada) return;
    if (info.estado === 'sin-conexion' || info.estado === 'sesion-vencida' || info.estado === 'error') {
      errorGuardado.replaceChildren(
        el('strong', {}, info.mensaje),
        ' Sus cambios quedan guardados en este navegador mientras tanto.',
      );
      errorGuardado.hidden = false;
    } else if (info.estado === 'guardado') {
      errorGuardado.hidden = true;
    }
  }

  /* ---------- Borrador local ---------- */

  function ofrecerBorrador(b: Borrador, servidor: FechaIso | null): void {
    const cuando = b.guardadoLocal ? ` (del ${formatearFecha(b.guardadoLocal)})` : '';
    const frente = servidor ? `la copia guardada en el servidor el ${formatearFecha(servidor)}` : 'lo guardado en el servidor';
    avisoBorrador.replaceChildren(
      el('p', {}, `Hay cambios sin guardar en este navegador${cuando}, distintos de ${frente}. ¿Qué desea hacer?`),
      el(
        'div',
        { class: 'botones' },
        boton(
          'Recuperar borrador no guardado',
          () => {
            avisoBorrador.hidden = true;
            cargarDoc(b.docJson);
            fijarEditable(true);
            const copia = editor?.getJSON() as DocJSON | undefined;
            if (copia && ag) {
              ag.cambio(copia);
              void ag.guardarYa();
            }
          },
          'primario',
        ),
        boton('Descartarlo', () => {
          borrarBorrador(almacen, claveBorrador(u.id, idTexto, versionActual));
          avisoBorrador.hidden = true;
          fijarEditable(true);
        }),
      ),
    );
    avisoBorrador.hidden = false;
  }

  function borradorParaCopiar(b: Borrador): void {
    avisoBorrador.replaceChildren(
      el('p', {}, 'Hay cambios en este navegador que no alcanzaron a guardarse y ya no se pueden enviar. Puede copiarlos aquí:'),
      cajaCopiar(b.docJson),
      boton('Descartarlo', () => {
        borrarBorrador(almacen, claveBorrador(u.id, idTexto, versionActual));
        avisoBorrador.hidden = true;
      }),
    );
    avisoBorrador.hidden = false;
  }

  /* ---------- Carga ---------- */

  let versionActual = 0;

  async function cargar(capituloId: number): Promise<void> {
    const [b, copia, consulta] = await Promise.all([
      api.get<Base>(`/capitulos/${capituloId}/base`),
      api.get<Copia>(`/capitulos/${capituloId}/copia`),
      api.get<Consulta>('/consulta'),
    ]);
    if (!vigente) return;
    base = b.docJson;
    versionActual = b.versionId;
    const otraVersion = copia.docJson !== null && copia.versionId !== b.versionId;
    const servidorDoc = copia.docJson !== null && !otraVersion ? copia.docJson : b.docJson;
    const actualizado = copia.docJson !== null && !otraVersion ? copia.actualizado : null;
    ultimoServidor = actualizado ? new Date(actualizado) : undefined;
    const analito = (servidorDoc.content ?? []).find((n) => n.type === 'analito');
    if (analito) titulo.textContent = textoVisible(analito.content ?? []) || 'Capítulo';

    const enConsulta = consulta.etapa === 'consulta';
    soloLectura = !enConsulta || otraVersion;
    if (!enConsulta) {
      avisoEtapa.textContent =
        consulta.etapa === 'preparacion'
          ? 'La consulta aún no comienza: el capítulo se muestra en solo lectura.'
          : 'La consulta está cerrada: el capítulo se muestra en solo lectura.';
      avisoEtapa.hidden = false;
    } else if (otraVersion) {
      avisoEtapa.textContent =
        'Su copia guardada corresponde a una versión anterior del capítulo. Se muestra en solo lectura ' +
        'para no reemplazarla; contacte al administrador.';
      avisoEtapa.hidden = false;
    }

    if (!enConsulta) {
      // Fuera de la consulta los borradores de motivos y comentarios ya no se pueden enviar.
      const caja = cajaBorradoresSinEnviar(almacen, u.id, capituloId, b.versionId);
      if (caja) panel.append(caja);
    }
    if (consulta.etapa !== 'edicion_final') {
      panelCambios = crearPanelCambios({
        api,
        capituloId,
        versionId: b.versionId,
        usuarioId: u.id,
        almacen,
        motivoObligatorio: consulta.motivoObligatorio === true,
        sugerenciasServidor: copia.docJson !== null && !otraVersion ? (copia.sugerencias ?? []) : [],
        resaltar: (id) => resaltar(areaEditor, id),
        pedirGuardado,
        alEtapaCerrada,
        usarBorrador: enConsulta,
      });
      panel.append(panelCambios.elemento);
    }
    const aportes = consulta.etapa === 'edicion_final' ? crearMisAportes(api, capituloId) : null;
    if (aportes) panel.append(aportes.elemento);
    comentarios = crearComentarios({
      api,
      capituloId,
      usuarioId: u.id,
      almacen,
      editor: () => editor,
      alCambiar: () => {
        if (vigente) recalcular();
      },
      alEtapaCerrada,
      mostrarLista: consulta.etapa !== 'edicion_final',
      usarBorrador: enConsulta,
    });
    panel.append(comentarios.elemento);

    const clave = claveBorrador(u.id, capituloId, b.versionId);
    let borrador = leerBorrador(almacen, clave);
    if (borrador && jsonEstable(borrador.docJson) === jsonEstable(servidorDoc)) {
      borrarBorrador(almacen, clave); // ya está en el servidor
      borrador = null;
    }

    editor = new Editor({
      element: areaEditor,
      extensions: extensionesLaboratorio(),
      content: structuredClone(servidorDoc),
      editable: false,
      onUpdate: () => alEditar(),
    });
    barra = crearBarra(editor);
    barra.agregar(comentarios.botonComentar);
    barra.habilitar(false);
    areaBarra.replaceChildren(barra.elemento);
    panel.append(barra.panelNota);
    recalcular();
    // No fatales y sin bloquear el editor: cada sección muestra su propio error con "Reintentar".
    void comentarios.cargar();
    void aportes?.cargar();

    if (!soloLectura) {
      ag = crearAutoguardado({
        api,
        capituloId,
        versionId: b.versionId,
        base: b.docJson,
        autor,
        almacen,
        actualizado,
        ...(panelCambios
          ? { motivoDe: panelCambios.motivoDe, alConfirmar: panelCambios.alConfirmarCopia }
          : {}),
        ...(deps.esperaMs !== undefined ? { esperaMs: deps.esperaMs } : {}),
        ...(deps.reloj ? { reloj: deps.reloj } : {}),
      });
      ag.alCambiarEstado(alCambiarEstado);
    }
    pintarIndicador(ag?.estado() ?? { estado: 'guardado', mensaje: '' });
    if (soloLectura) estado.textContent = 'Solo lectura';
    intervalo = setInterval(() => {
      if (ag?.estado().estado === 'guardado') pintarIndicador(ag.estado());
    }, 1000);

    if (!borrador) {
      fijarEditable(!soloLectura);
      return;
    }
    if (soloLectura) {
      borradorParaCopiar(borrador);
      return;
    }
    if (borrador.actualizadoServidor === actualizado) {
      // Continuación directa de lo que hay en el servidor: se recupera y se guarda solo.
      cargarDoc(borrador.docJson);
      fijarEditable(true);
      avisoBorrador.replaceChildren(
        el('p', {}, 'Se recuperaron cambios que no alcanzaron a guardarse en el servidor (estaban en este navegador).'),
      );
      avisoBorrador.hidden = false;
      ag!.cambio(editor.getJSON() as DocJSON);
      await ag!.guardarYa();
      return;
    }
    ofrecerBorrador(borrador, actualizado);
  }

  function mensajeCarga(e: unknown): string {
    if (e instanceof ErrorApi && e.codigo === SIN_CONEXION) {
      return 'No hay conexión con el servidor. Revise su conexión a Internet y recargue la página.';
    }
    if (e instanceof ErrorApi && e.codigo === 'no_encontrado') return 'El capítulo no existe.';
    return mensajeDe(e);
  }

  const alSalirPagina = (ev: BeforeUnloadEvent) => {
    vaciarEspera();
    if (!ag || soloLectura) return;
    const est = ag.estado().estado;
    if (est !== 'guardado' || ag.sinConfirmar()) {
      void ag.guardarYa(); // escribe el borrador local antes de enviar
      ev.preventDefault();
    }
  };

  return {
    get listo() {
      return listo;
    },
    editor: () => editor,
    montar(raiz) {
      const errorCarga = el('div', { class: 'error', role: 'alert' });
      errorCarga.hidden = true;
      raiz.replaceChildren(
        el(
          'div',
          { class: 'app-lab' },
          el(
            'header',
            { class: 'cabecera-lab' },
            el('a', { href: '#/capitulos', class: 'enlace-volver' }, '← Capítulos'),
            titulo,
            estado,
          ),
          errorCarga,
          avisoEtapa,
          errorGuardado,
          errorCalculo,
          avisoBorrador,
          el(
            'div',
            { class: 'disposicion-lab' },
            el('section', { class: 'columna-editor', 'aria-label': 'Copia del laboratorio' }, areaBarra, areaEditor),
            panel,
          ),
        ),
      );
      const mostrarError = (m: string) => {
        errorCarga.textContent = `No se pudo abrir el capítulo: ${m}`;
        errorCarga.hidden = false;
      };
      if (!tieneRol(u, 'laboratorio')) {
        mostrarError('esta vista es para cuentas de laboratorio.');
        return;
      }
      if (!/^[1-9]\d*$/.test(idTexto)) {
        mostrarError('el identificador no es válido.');
        return;
      }
      window.addEventListener('beforeunload', alSalirPagina);
      listo = cargar(Number(idTexto)).catch((e) => {
        if (vigente) mostrarError(mensajeCarga(e));
      });
    },
    async desmontar() {
      vigente = false;
      window.removeEventListener('beforeunload', alSalirPagina);
      if (intervalo !== null) clearInterval(intervalo);
      await listo.catch(() => {});
      vaciarEspera();
      if (temporizador !== null) clearTimeout(temporizador);
      if (ag) await ag.detener();
      barra?.destruir();
      editor?.destroy();
      editor = null;
    },
  };
}
