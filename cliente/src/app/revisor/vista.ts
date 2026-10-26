/**
 * Vista del revisor (`#/revisar/{id}`): la base (solo lectura) con las sugerencias de
 * todos los laboratorios superpuestas, un color por laboratorio; al lado, la cola de
 * conflictos y los aportes por bloque, con filtros que se recuerdan en la URL.
 * Las decisiones solo se habilitan en `edicion_final` (docs/api.md §3).
 */
import { Editor } from '@tiptap/core';
import { claveDecoraciones, decoracionesRevisor } from '../../editor/decoraciones';
import { extensionesDemo } from '../../editor/editor';
import { el, mensajeDe } from '../../editor/ui';
import { ErrorApi, SIN_CONEXION, type Api } from '../api';
import type { Vista } from '../router';
import type { Aportes, Base, CapituloLista, Consulta, Etapa } from '../tipos-api';
import {
  abreviaturaLab,
  analizarConflictos,
  aplicarFiltros,
  chipLab,
  claseAutor,
  consultaDeFiltros,
  dibujarCoincidencias,
  dibujarCola,
  dibujarPanel,
  labDe,
  leerFiltros,
  type ConflictoCola,
  type ContextoPanel,
  type Filtros,
  type LabRef,
} from './panel';
import './revisor.css';

function mensajeError(e: unknown): string {
  if (e instanceof ErrorApi) {
    switch (e.codigo) {
      case SIN_CONEXION:
        return 'No hay conexión con el servidor. Revise su conexión a Internet e intente de nuevo.';
      case 'sin_permiso':
        return 'No tiene permiso para revisar este capítulo: hace falta el rol revisor.';
      case 'no_encontrado':
        return 'El capítulo no existe.';
      case 'etapa_no_permite':
        return 'Los aportes de los laboratorios se pueden ver desde que se abre la consulta.';
    }
  }
  return mensajeDe(e);
}

const AVISO_ETAPA: Partial<Record<Etapa, string>> = {
  consulta:
    'La consulta sigue abierta: puede mirar el avance de los laboratorios, pero las decisiones se habilitan en la edición final.',
  preparacion: 'La consulta aún no comienza. Las decisiones se habilitan en la edición final.',
};

export function vistaRevisor(
  api: Api,
  capituloId: number,
  consulta: URLSearchParams = new URLSearchParams(),
): Vista & { listo: Promise<void> } {
  let vigente = true;
  let listo: Promise<void> = Promise.resolve();
  let editor: Editor | null = null;
  let filtros: Filtros = leerFiltros(consulta);
  const rutaBase = `#/revisar/${capituloId}`;

  function recordarFiltros(): void {
    const q = consultaDeFiltros(filtros);
    history.replaceState(history.state, '', q ? `${rutaBase}?${q}` : rutaBase);
  }

  return {
    montar(raiz) {
      const titulo = el('h1', {}, `Capítulo ${capituloId}`);
      const errores = el('div', { class: 'error', role: 'alert', hidden: '' });
      const avisos = el('div', { class: 'avisos-revisor' });
      const barra = el('div', { class: 'filtros-revisor', hidden: '' });
      const leyenda = el('ul', { class: 'leyenda-labs', 'aria-label': 'Laboratorios' });
      const areaEditor = el('div', { class: 'editor', 'data-modo': 'revisor' });
      const cola = el('div', { class: 'contenedor-cola' });
      const tituloCola = el('h2', {}, 'Conflictos');
      const panel = el('div', { class: 'panel-bloques' });
      const coincidencias = el('div', { class: 'contenedor-coincidencias', hidden: '' });
      const cuerpo = el(
        'div',
        { class: 'revisor', hidden: '' },
        el('section', { class: 'revisor-documento', 'aria-label': 'Documento base con las sugerencias' }, areaEditor),
        el('aside', { class: 'revisor-panel' }, leyenda, tituloCola, cola, coincidencias, el('h2', {}, 'Aportes por bloque'), panel),
      );
      raiz.append(
        el(
          'main',
          { class: 'app app-revisor vista-revisor' },
          el(
            'header',
            { class: 'cabecera-app' },
            el('div', {}, titulo, el('div', { class: 'subtitulo' }, 'Revisión de los aportes de los laboratorios')),
            el('div', { class: 'cabecera-acciones' }, el('a', { href: '#/capitulos', class: 'enlace-boton' }, 'Volver a los capítulos')),
          ),
          errores,
          avisos,
          barra,
          cuerpo,
        ),
      );

      const mostrarError = (m: string) => {
        errores.textContent = m;
        errores.hidden = false;
      };

      listo = Promise.all([
        api.get<Consulta>('/consulta'),
        api.get<CapituloLista[]>('/capitulos'),
        api.get<Base>(`/capitulos/${capituloId}/base`),
        api.get<Aportes>(`/capitulos/${capituloId}/aportes`),
      ]).then(
        ([cons, capitulos, base, aportes]) => {
          if (!vigente) return;
          try {
            const cap = capitulos.find((c) => c.id === capituloId);
            if (cap) titulo.textContent = `${cap.orden}. ${cap.titulo}`;
            const ctx: ContextoPanel = { base: base.docJson, versionId: base.versionId, etapa: cons.etapa };
            const avisoEtapa = AVISO_ETAPA[cons.etapa];
            if (avisoEtapa) avisos.append(el('p', { class: 'aviso aviso-etapa', role: 'status' }, avisoEtapa));

            // Laboratorios presentes (para el filtro y la leyenda), por nombre.
            const labs: LabRef[] = [];
            for (const x of [...aportes.sugerencias, ...aportes.comentarios]) {
              const l = labDe(x);
              if (!labs.some((y) => y.usuarioId === l.usuarioId)) labs.push(l);
            }
            labs.sort((a, b) => a.laboratorio.localeCompare(b.laboratorio, 'es'));
            leyenda.replaceChildren(...labs.map((l) => el('li', {}, chipLab(l), ' ', l.laboratorio)));

            const analisis = analizarConflictos(aportes.sugerencias, base.docJson, base.versionId);
            const colaCompleta = analisis.cola;
            const enConflicto = new Set(colaCompleta.flatMap((c) => c.ids));
            // Etiqueta de cada marca del documento: nombre (title) y abreviatura del laboratorio.
            const porAutor = new Map(aportes.sugerencias.map((x) => [x.autor, labDe(x)] as const));
            const etiquetaAutor = (autor: string) => {
              const l = porAutor.get(autor);
              return l ? { titulo: l.laboratorio, abreviatura: abreviaturaLab(l.laboratorio) } : undefined;
            };
            const sinAportes = aportes.sugerencias.length === 0 && aportes.comentarios.length === 0;
            const anteriores = aportes.sugerencias.filter((s) => s.versionId !== undefined && s.versionId !== base.versionId).length;
            if (anteriores > 0) {
              avisos.append(
                el(
                  'p',
                  { class: 'aviso', role: 'status' },
                  `${anteriores === 1 ? 'Hay 1 sugerencia' : `Hay ${anteriores} sugerencias`} sobre una versión base anterior: aparecen en el panel, pero no sobre el documento.`,
                ),
              );
            }

            editor = new Editor({
              element: areaEditor,
              extensions: extensionesDemo(),
              content: structuredClone(base.docJson),
              editable: false,
            });

            const redibujar = () => {
              const datos = aplicarFiltros(aportes, filtros, enConflicto);
              const visibles = (lista: ConflictoCola[]) =>
                filtros.ver === 'comentarios'
                  ? []
                  : lista.filter((c) => filtros.lab === null || c.sugerencias.some((s) => labDe(s).usuarioId === filtros.lab));
              const deLaCola = visibles(colaCompleta);
              tituloCola.textContent = `Conflictos (${deLaCola.length})`;
              dibujarCola(cola, deLaCola, ctx);
              dibujarCoincidencias(coincidencias, filtros.soloConflictos ? [] : visibles(analisis.coincidencias), ctx);
              dibujarPanel(panel, datos, ctx, sinAportes);
              if (editor) {
                // Sobre el documento, solo las sugerencias de la base vigente (las otras no ubican sus rangos).
                const vigentes = datos.sugerencias.filter((s) => s.versionId === undefined || s.versionId === base.versionId);
                try {
                  const set = decoracionesRevisor(editor.state.doc, vigentes, { conflictos: colaCompleta, claseAutor, etiquetaAutor });
                  editor.view.dispatch(editor.state.tr.setMeta(claveDecoraciones, set));
                } catch (e) {
                  mostrarError(`No se pudieron mostrar las sugerencias sobre el documento: ${mensajeDe(e)}`);
                }
              }
            };

            // Filtros.
            const selLab = el('select', { name: 'lab' });
            selLab.append(el('option', { value: '' }, 'Todos los laboratorios'));
            for (const l of labs) selLab.append(el('option', { value: String(l.usuarioId) }, l.laboratorio));
            if (filtros.lab !== null && !labs.some((l) => l.usuarioId === filtros.lab)) {
              selLab.append(el('option', { value: String(filtros.lab) }, `Laboratorio ${filtros.lab} (sin aportes)`));
            }
            selLab.value = filtros.lab === null ? '' : String(filtros.lab);
            const casilla = (nombre: string, texto: string, marcada: boolean) => {
              const input = el('input', { type: 'checkbox', name: nombre });
              input.checked = marcada;
              return { input, etiqueta: el('label', {}, input, ` ${texto}`) };
            };
            const conflictos = casilla('conflictos', 'Solo conflictos', filtros.soloConflictos);
            const pendientes = casilla('pendientes', 'Solo pendientes', filtros.soloPendientes);
            const selVer = el('select', { name: 'ver' });
            selVer.append(
              el('option', { value: 'todo' }, 'Cambios y comentarios'),
              el('option', { value: 'cambios' }, 'Solo cambios'),
              el('option', { value: 'comentarios' }, 'Solo comentarios'),
            );
            selVer.value = filtros.ver;
            const alCambiar = () => {
              filtros = {
                lab: selLab.value === '' ? null : Number(selLab.value),
                soloConflictos: conflictos.input.checked,
                soloPendientes: pendientes.input.checked,
                ver: selVer.value as Filtros['ver'],
              };
              recordarFiltros();
              redibujar();
            };
            for (const c of [selLab, conflictos.input, pendientes.input, selVer]) c.addEventListener('change', alCambiar);
            barra.replaceChildren(
              el('label', {}, 'Laboratorio: ', selLab),
              conflictos.etiqueta,
              pendientes.etiqueta,
              el('label', {}, 'Mostrar: ', selVer),
            );
            barra.hidden = false;
            cuerpo.hidden = false;
            redibujar();
          } catch (e) {
            // Un fallo al armar la vista (p. ej. el editor) no queda como promesa rechazada en silencio.
            mostrarError(`No se pudo mostrar la revisión: ${mensajeDe(e)}`);
          }
        },
        (e: unknown) => {
          if (!vigente) return;
          mostrarError(mensajeError(e));
        },
      );
    },
    desmontar() {
      vigente = false;
      editor?.destroy();
      editor = null;
    },
    get listo() {
      return listo;
    },
  };
}
