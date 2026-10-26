/**
 * Registro de cambios (`#/informe` y `#/informe/{id}`), solo para el rol revisor: una fila por
 * aporte de cada laboratorio con su decisión, filtros que viven en la consulta del hash
 * (`#/informe?lab=…&estado=…`), impresión y descarga CSV de las filas filtradas.
 *
 * - Carga `GET /consulta` y `GET /capitulos`, y luego `base` y `aportes` de cada capítulo con
 *   un máximo de `LIMITE_PETICIONES` peticiones a la vez, mostrando el avance. Si un capítulo
 *   falla, un aviso `role="alert"` lo nombra con «Reintentar» y el resto se muestra igual.
 * - En `preparacion` no hay aportes que ver: estado vacío, sin pedirlos.
 * - Tablas grandes (miles de filas): se pintan `TAMANO_PAGINA` filas y «Mostrar más» agrega
 *   otra página; «Mostrar todas» e «Imprimir» pintan el resto por tandas, una por cuadro
 *   (`requestAnimationFrame`), y recién entonces se llama a `window.print()`, así el papel
 *   lleva todas las filas filtradas sin congelar la página.
 * - El DOM se arma solo con `el`/`textContent` (nunca `innerHTML`).
 */
import './informe.css';
import { boton, el, mensajeDe } from '../../editor/ui';
import { ErrorApi, SIN_CONEXION, type Api } from '../api';
import { aLocal } from '../fechas';
import type { Vista } from '../router';
import { tieneRol } from '../sesion';
import type { Aportes, Base, CapituloLista, Consulta, Usuario } from '../tipos-api';
import {
  csvInforme,
  describirFiltros,
  filasInforme,
  filtrar,
  NO_ENCONTRADO,
  propuestaSinEtiqueta,
  type AportesCapitulo,
  type CapituloInforme,
  type FilaInforme,
  type FiltrosInforme,
} from './datos';
import type { ResultadoZip } from './zip';

/** Peticiones simultáneas como máximo al cargar los capítulos. */
export const LIMITE_PETICIONES = 4;
/** Filas que se pintan de una vez (página de «Mostrar más» y tanda por cuadro al imprimir). */
export const TAMANO_PAGINA = 500;

export interface DepsInforme {
  /** Por defecto `window.print()`. */
  imprimir?: () => void;
  /** Agenda una tanda de pintado; por defecto `requestAnimationFrame`. */
  cuadro?: (cb: () => void) => void;
  /** Reloj (título impreso y nombre del CSV). */
  ahora?: () => Date;
}

const ESTADOS = ['pendiente', 'aceptada', 'rechazada', 'modificada', 'abierto', 'resuelto'] as const;

/** Contadores: singular y plural por estado. */
const NOMBRE_ESTADO: Record<string, [string, string]> = {
  pendiente: ['pendiente', 'pendientes'],
  aceptada: ['aceptada', 'aceptadas'],
  rechazada: ['rechazada', 'rechazadas'],
  modificada: ['modificada', 'modificadas'],
  abierto: ['comentario abierto', 'comentarios abiertos'],
  resuelto: ['comentario resuelto', 'comentarios resueltos'],
};

/** Columna «Decisión» y opciones del filtro de estado. */
const DECISION: Record<string, string> = {
  pendiente: 'Pendiente',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  modificada: 'Modificada (redactar otra)',
  abierto: 'Comentario abierto',
  resuelto: 'Comentario resuelto',
};

const COLUMNAS = ['Capítulo', 'Ubicación', 'Original → Propuesta', 'Laboratorio', 'Motivo', 'Decisión', 'Resuelto por', 'Fecha', 'Nota'];

const plural = (n: number, [uno, varios]: [string, string]) => `${n} ${n === 1 ? uno : varios}`;

/** «Cargando 3 de 15 capítulos…». */
const textoAvance = (hechos: number, total: number) => `Cargando ${hechos} de ${total} ${total === 1 ? 'capítulo' : 'capítulos'}…`;

/** Semáforo: como mucho `max` tareas en curso; al terminar una, el turno pasa a la siguiente en cola. */
function limitador(max: number): <T>(tarea: () => Promise<T>) => Promise<T> {
  let activos = 0;
  const cola: (() => void)[] = [];
  return async (tarea) => {
    if (activos < max) activos++;
    else await new Promise<void>((r) => cola.push(r)); // hereda el lugar de quien termina
    try {
      return await tarea();
    } finally {
      const siguiente = cola.shift();
      if (siguiente) siguiente();
      else activos--;
    }
  };
}

const esEntero = (x: number | undefined): x is number => x !== undefined && Number.isInteger(x) && x > 0;

/** Filtros desde la consulta del hash; en `#/informe/{id}` el capítulo es el de la ruta. */
export function leerFiltros(q: URLSearchParams, capituloId?: number): FiltrosInforme {
  const f: FiltrosInforme = {};
  const cap = capituloId ?? (q.get('cap') ? Number(q.get('cap')) : undefined);
  if (esEntero(cap)) f.capituloId = cap;
  const lab = q.get('lab');
  if (lab) f.laboratorio = lab;
  const estado = q.get('estado');
  if (estado && (ESTADOS as readonly string[]).includes(estado)) f.estado = estado;
  const tipo = q.get('tipo');
  if (tipo === 'sugerencia' || tipo === 'comentario') f.tipo = tipo;
  if (q.get('reunion') === '1') f.soloReunion = true;
  return f;
}

/** Consulta del hash para los filtros (sin el capítulo cuando lo fija la ruta). */
export function consultaDeFiltros(f: FiltrosInforme, capituloFijo: boolean): string {
  const q = new URLSearchParams();
  if (!capituloFijo && f.capituloId !== undefined) q.set('cap', String(f.capituloId));
  if (f.laboratorio) q.set('lab', f.laboratorio);
  if (f.estado) q.set('estado', f.estado);
  if (f.tipo) q.set('tipo', f.tipo);
  if (f.soloReunion) q.set('reunion', '1');
  return q.toString();
}

/** Fecha de pared en Chile «DD-MM-AAAA HH:MM» y su «AAAAMMDD». */
function fechaChile(d: Date): { legible: string; compacta: string } {
  const local = aLocal(d.toISOString()); // AAAA-MM-DDTHH:MM
  const [fecha, hora] = local.split('T');
  const [a, m, dia] = fecha.split('-');
  return { legible: `${dia}-${m}-${a} ${hora}`, compacta: `${a}${m}${dia}` };
}

/** Descarga como archivo: Blob + URL con revocación diferida (revocar en el acto puede cortarla). */
function descargarArchivo(nombre: string, parte: BlobPart, tipo: string): void {
  const url = URL.createObjectURL(new Blob([parte], { type: tipo }));
  const a = el('a', { href: url, download: nombre });
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Propuesta con el tipo de cambio (`etiquetaCambio`) como etiqueta aparte (texto, no HTML). */
function celdaPropuesta(f: FilaInforme): HTMLElement {
  const caja = el('div', { class: 'propuesta-informe' });
  const etiqueta = f.tipo === 'comentario' ? 'comentario' : f.etiquetaCambio;
  const texto = propuestaSinEtiqueta(f);
  if (etiqueta) caja.append(el('span', { class: 'etiqueta-cambio' }, etiqueta));
  if (etiqueta && texto) caja.append(' ');
  if (texto) caja.append(texto);
  return caja;
}

function filaTabla(f: FilaInforme): HTMLTableRowElement {
  const cambio = el('td', { class: 'cambio-informe' });
  if (f.original) {
    cambio.append(
      el(
        'div',
        { class: 'original-informe', title: f.tipo === 'comentario' ? 'Texto anclado (aproximado)' : 'Texto original' },
        f.original,
      ),
    );
  }
  cambio.append(celdaPropuesta(f));
  const decision = el('td', {}, DECISION[f.estado] ?? f.estado);
  if (f.derivadaReunion) decision.append(' ', el('span', { class: 'reunion-informe' }, 'derivada a reunión'));
  return el(
    'tr',
    { 'data-tipo': f.tipo, 'data-cambio': f.cambio },
    el('td', {}, f.capitulo),
    el('td', { class: f.ubicacion === NO_ENCONTRADO ? 'no-encontrado' : undefined }, f.ubicacion),
    cambio,
    el('td', {}, f.laboratorio),
    el('td', {}, f.motivo),
    decision,
    el('td', {}, f.resueltoPor),
    el('td', { class: 'fecha-informe' }, f.resueltoEn),
    el('td', {}, f.nota),
  );
}

function mensajeError(e: unknown): string {
  if (e instanceof ErrorApi) {
    switch (e.codigo) {
      case SIN_CONEXION:
        return 'No hay conexión con el servidor. Revise su conexión a Internet e intente de nuevo.';
      case 'sin_permiso':
        return 'No tiene permiso para ver el registro de cambios: hace falta el rol revisor.';
      case 'no_encontrado':
        return 'El capítulo no existe.';
    }
  }
  return mensajeDe(e);
}

const codigoDe = (e: unknown): string | null => (e instanceof ErrorApi ? e.codigo : null);

interface Cargado {
  cap: CapituloInforme;
  aportes: AportesCapitulo;
}

export function vistaInforme(
  api: Api,
  capituloId?: number,
  consulta: URLSearchParams = new URLSearchParams(),
  deps: DepsInforme = {},
): Vista & { listo: Promise<void> } {
  let vigente = true;
  let listo: Promise<void> = Promise.resolve();
  const fijo = capituloId !== undefined;
  const rutaBase = fijo ? `#/informe/${capituloId}` : '#/informe';
  let filtros = leerFiltros(consulta, capituloId);
  const ahora = deps.ahora ?? (() => new Date());
  const cuadro = deps.cuadro ?? ((cb: () => void) => void window.requestAnimationFrame(() => cb()));
  const imprimir = deps.imprimir ?? (() => window.print());

  /** Capítulos pedidos (orden de `GET /capitulos`) y los ya cargados. */
  let objetivo: CapituloLista[] = [];
  const cargados = new Map<number, Cargado>();
  const fallidos = new Map<number, { cap: CapituloLista; error: unknown }>();
  let todas: FilaInforme[] = [];
  let filtradas: FilaInforme[] = [];
  let pintadas = 0;
  /** Cambia con cada redibujo: corta un pintado por tandas que quedó viejo. */
  let generacion = 0;

  return {
    montar(raiz) {
      const titulo = el('h1', {}, 'Registro de cambios');
      const subtitulo = el('div', { class: 'subtitulo' }, 'Todos los aportes de los laboratorios y su decisión');
      const enlaces = el('div', { class: 'cabecera-acciones' });
      if (fijo) {
        enlaces.append(
          el('a', { href: `#/revisar/${capituloId}`, class: 'enlace-boton' }, 'Volver a la revisión'),
          el('a', { href: '#/informe', class: 'enlace-boton' }, 'Todos los capítulos'),
        );
      }
      enlaces.append(el('a', { href: '#/capitulos', class: 'enlace-boton' }, 'Volver a los capítulos'));

      const errores = el('div', { class: 'error', role: 'alert', hidden: '' });
      const fallos = el('div', { class: 'error fallos-informe', role: 'alert', hidden: '' });
      const avance = el('p', { class: 'avance-informe', role: 'status' }, 'Cargando…');
      const vacio = el('p', { class: 'vacio-informe', hidden: '' });
      const ayuda = el(
        'p',
        { class: 'ayuda ayuda-informe no-imprimir' },
        'Una fila por aporte de cada laboratorio, en el orden del documento. Los filtros quedan en la dirección de la página: ' +
          'un enlace copiado reproduce esta vista. En los comentarios, el texto original es el fragmento anclado en la versión ' +
          'vigente y es aproximado: si el laboratorio editó ese párrafo antes de comentar, el recorte puede no coincidir del todo.',
      );
      const tituloImpreso = el('p', { class: 'titulo-impreso' });
      const contadores = el('p', { class: 'contadores-informe', role: 'status' });
      const barra = el('div', { class: 'filtros-informe no-imprimir', hidden: '' });
      const bImprimir = boton('Imprimir', () => void alImprimir(), 'primario');
      const bCsv = boton('Descargar CSV', () => alDescargar());
      const etiquetaZip = fijo ? 'Descargar el .tex final de este capítulo (.zip)' : 'Descargar todos los .tex finales (.zip)';
      const bZip = boton(etiquetaZip, () => void alDescargarZip());
      bImprimir.disabled = true;
      bCsv.disabled = true;
      bZip.disabled = true;
      const acciones = el('div', { class: 'acciones-informe no-imprimir' }, bImprimir, bCsv, bZip);
      const avisoZip = el('div', { class: 'error aviso-zip no-imprimir', role: 'alert', hidden: '' });
      const tbody = el('tbody');
      const tabla = el(
        'table',
        { class: 'tabla-informe', hidden: '' },
        el('thead', {}, el('tr', {}, ...COLUMNAS.map((c) => el('th', { scope: 'col' }, c)))),
        tbody,
      );
      const sinFilas = el('p', { class: 'sin-filas-informe', hidden: '' });
      const bMas = boton('', () => {
        pintarHasta(pintadas + TAMANO_PAGINA);
        actualizarMas();
      });
      const bTodas = boton('Mostrar todas', () => void pintarTodo());
      const mas = el('div', { class: 'mas-informe no-imprimir', hidden: '' }, bMas, bTodas);

      raiz.append(
        el(
          'main',
          { class: 'app vista-informe' },
          el('header', { class: 'cabecera-app' }, el('div', {}, titulo, subtitulo), enlaces),
          errores,
          fallos,
          avance,
          vacio,
          ayuda,
          barra,
          acciones,
          avisoZip,
          tituloImpreso,
          contadores,
          tabla,
          sinFilas,
          mas,
        ),
      );

      const mostrarError = (m: string, reintentar?: () => void) => {
        errores.replaceChildren(m);
        if (reintentar) errores.append(' ', el('span', { class: 'no-imprimir' }, boton('Reintentar', reintentar)));
        errores.hidden = false;
      };

      const capituloDe = (c: CapituloLista, base: Base): CapituloInforme => ({
        id: c.id,
        orden: c.orden,
        titulo: `${c.orden}. ${c.titulo}`,
        base: base.docJson,
      });

      // --- Pintado de la tabla ---

      function actualizarTituloImpreso(): void {
        const caps = objetivo.map((c) => ({ id: c.id, titulo: `${c.orden}. ${c.titulo}` }));
        let fecha = '';
        try {
          fecha = ` — ${fechaChile(ahora()).legible} (hora de Chile)`;
        } catch {
          // sin fecha antes que sin título
        }
        tituloImpreso.textContent = `Registro de cambios — ${describirFiltros(filtros, caps)}${fecha}`;
      }

      function pintarHasta(n: number): void {
        const hasta = Math.min(n, filtradas.length);
        if (hasta <= pintadas) return;
        const frag = document.createDocumentFragment();
        for (let i = pintadas; i < hasta; i++) frag.append(filaTabla(filtradas[i]));
        tbody.append(frag);
        pintadas = hasta;
      }

      function actualizarMas(): void {
        const quedan = filtradas.length - pintadas;
        mas.hidden = quedan <= 0;
        bMas.textContent = `Mostrar ${Math.min(TAMANO_PAGINA, quedan)} más (quedan ${quedan})`;
      }

      /** Pinta lo que falta por tandas, una por cuadro. false si un redibujo o la salida lo cortó. */
      function pintarTodo(): Promise<boolean> {
        const g = generacion;
        return new Promise((resolver) => {
          const paso = () => {
            if (!vigente || g !== generacion) return resolver(false);
            pintarHasta(pintadas + TAMANO_PAGINA);
            actualizarMas();
            if (pintadas < filtradas.length) cuadro(paso);
            else resolver(true);
          };
          paso();
        });
      }

      function contar(): void {
        const n = new Map<string, number>();
        let reunion = 0;
        for (const f of filtradas) {
          n.set(f.estado, (n.get(f.estado) ?? 0) + 1);
          if (f.derivadaReunion) reunion++;
        }
        const partes = [plural(filtradas.length, ['aporte', 'aportes'])];
        for (const e of ESTADOS) {
          const k = n.get(e) ?? 0;
          if (k > 0) partes.push(plural(k, NOMBRE_ESTADO[e]));
        }
        if (reunion > 0) partes.push(plural(reunion, ['derivada a reunión', 'derivadas a reunión']));
        contadores.textContent = partes.join(' · ');
      }

      function redibujar(): void {
        generacion++;
        filtradas = filtrar(todas, filtros);
        contar();
        actualizarTituloImpreso();
        tbody.replaceChildren();
        pintadas = 0;
        pintarHasta(TAMANO_PAGINA);
        actualizarMas();
        tabla.hidden = filtradas.length === 0;
        sinFilas.hidden = filtradas.length > 0;
        sinFilas.textContent =
          todas.length === 0 ? 'Todavía no hay aportes de los laboratorios.' : 'Ningún aporte coincide con los filtros.';
      }

      async function alImprimir(): Promise<void> {
        bImprimir.disabled = true;
        const texto = bImprimir.textContent;
        bImprimir.textContent = 'Preparando la impresión…';
        try {
          if (!(await pintarTodo()) || !vigente) return; // filtros cambiados a mitad: no imprime una tabla vieja
          actualizarTituloImpreso();
          imprimir();
        } finally {
          bImprimir.textContent = texto;
          bImprimir.disabled = false;
        }
      }

      function alDescargar(): void {
        try {
          descargarArchivo(`registro-cambios-${fechaChile(ahora()).compacta}.csv`, csvInforme(filtradas), 'text/csv;charset=utf-8');
        } catch (e) {
          mostrarError(`No se pudo descargar el CSV: ${mensajeDe(e)}`);
        }
      }

      // --- Descarga de los .tex finales (.zip) ---

      const nombreZip = () => `manual-final-${fechaChile(ahora()).compacta}.zip`;
      const cerrarAviso = () => {
        avisoZip.hidden = true;
        avisoZip.replaceChildren();
        bZip.disabled = false;
      };
      const bajarZip = (r: ResultadoZip) => {
        cerrarAviso();
        // Copia a un ArrayBuffer propio: `BlobPart` no acepta vistas sobre `ArrayBufferLike`.
        descargarArchivo(nombreZip(), r.zip.slice().buffer, 'application/zip');
      };

      async function alDescargarZip(): Promise<void> {
        bZip.disabled = true;
        const texto = bZip.textContent;
        bZip.textContent = 'Preparando el .zip…';
        avisoZip.hidden = true;
        try {
          const { armarZipFinales } = await import('./zip');
          const r = await armarZipFinales(api, objetivo);
          if (!vigente) return;
          if (r.faltantes.length === 0) {
            bajarZip(r);
            return;
          }
          const lista = el('ul');
          for (const t of r.faltantes) lista.append(el('li', {}, t));
          avisoZip.replaceChildren(
            el(
              'p',
              {},
              r.faltantes.length === 1
                ? 'Este capítulo no tiene versión final guardada y no estará en el .zip:'
                : `Estos ${r.faltantes.length} capítulos no tienen versión final guardada y no estarán en el .zip:`,
            ),
            lista,
            el('p', {}, 'El .zip incluirá un archivo FALTANTES.txt con esta lista.'),
            boton('Descargar de todos modos', () => bajarZip(r), 'primario'),
            ' ',
            boton('Cancelar', cerrarAviso),
          );
          avisoZip.hidden = false;
        } catch (e) {
          if (!vigente) return;
          avisoZip.replaceChildren(`No se pudo preparar el .zip: ${mensajeError(e)}`);
          avisoZip.hidden = false;
        } finally {
          bZip.textContent = texto;
          bZip.disabled = !avisoZip.hidden && avisoZip.querySelector('button') !== null; // aviso pendiente: se decide ahí
        }
      }

      // --- Filtros ---

      function armarFiltros(): void {
        const labs = [...new Set(todas.map((f) => f.laboratorio).filter((l) => l !== ''))].sort((a, b) =>
          a.localeCompare(b, 'es', { numeric: true }),
        );
        const opcion = (valor: string, texto: string) => el('option', { value: valor }, texto);
        const controles: HTMLElement[] = [];

        let selCap: HTMLSelectElement | null = null;
        if (!fijo) {
          selCap = el('select', { name: 'cap' }, opcion('', 'Todos los capítulos'));
          for (const c of objetivo) selCap.append(opcion(String(c.id), `${c.orden}. ${c.titulo}`));
          selCap.value = filtros.capituloId === undefined ? '' : String(filtros.capituloId);
          controles.push(el('label', {}, 'Capítulo: ', selCap));
        }
        const selLab = el('select', { name: 'lab' }, opcion('', 'Todos los laboratorios'));
        for (const l of labs) selLab.append(opcion(l, l));
        if (filtros.laboratorio && !labs.includes(filtros.laboratorio)) {
          selLab.append(opcion(filtros.laboratorio, `${filtros.laboratorio} (sin aportes)`));
        }
        selLab.value = filtros.laboratorio ?? '';
        const selEstado = el('select', { name: 'estado' }, opcion('', 'Todos los estados'));
        for (const e of ESTADOS) selEstado.append(opcion(e, DECISION[e]));
        selEstado.value = filtros.estado ?? '';
        const selTipo = el(
          'select',
          { name: 'tipo' },
          opcion('', 'Sugerencias y comentarios'),
          opcion('sugerencia', 'Solo sugerencias'),
          opcion('comentario', 'Solo comentarios'),
        );
        selTipo.value = filtros.tipo ?? '';
        const reunion = el('input', { type: 'checkbox', name: 'reunion' });
        reunion.checked = filtros.soloReunion === true;
        controles.push(
          el('label', {}, 'Laboratorio: ', selLab),
          el('label', {}, 'Estado: ', selEstado),
          el('label', {}, 'Tipo: ', selTipo),
          el('label', {}, reunion, ' Solo derivados a reunión'),
        );

        const alCambiar = () => {
          const f: FiltrosInforme = {};
          const cap = fijo ? capituloId : selCap?.value ? Number(selCap.value) : undefined;
          if (esEntero(cap)) f.capituloId = cap;
          if (selLab.value) f.laboratorio = selLab.value;
          if (selEstado.value) f.estado = selEstado.value;
          if (selTipo.value === 'sugerencia' || selTipo.value === 'comentario') f.tipo = selTipo.value;
          if (reunion.checked) f.soloReunion = true;
          filtros = f;
          const q = consultaDeFiltros(filtros, fijo);
          history.replaceState(history.state, '', q ? `${rutaBase}?${q}` : rutaBase);
          redibujar();
        };
        for (const c of [selCap, selLab, selEstado, selTipo, reunion]) c?.addEventListener('change', alCambiar);
        barra.replaceChildren(...controles);
        barra.hidden = false;
      }

      // --- Carga ---

      const cola = limitador(LIMITE_PETICIONES);
      /** Una petición en cola que recibe su turno después de salir de la vista ya no se envía. */
      const limitar = <T>(tarea: () => Promise<T>): Promise<T> =>
        cola(() => (vigente ? tarea() : Promise.reject(new Error('La vista se cerró.'))));

      /** Carga `base` y `aportes` de `lista`; los fallos quedan en `fallidos`. */
      async function cargarCapitulos(lista: CapituloLista[]): Promise<void> {
        let hechos = 0;
        avance.textContent = textoAvance(0, lista.length);
        avance.hidden = false;
        await Promise.all(
          lista.map(async (c) => {
            try {
              const [base, aportes] = await Promise.all([
                limitar(() => api.get<Base>(`/capitulos/${c.id}/base`)),
                limitar(() => api.get<Aportes>(`/capitulos/${c.id}/aportes`)),
              ]);
              cargados.set(c.id, {
                cap: capituloDe(c, base),
                aportes: { sugerencias: aportes.sugerencias ?? [], comentarios: aportes.comentarios ?? [] },
              });
              fallidos.delete(c.id);
            } catch (e) {
              fallidos.set(c.id, { cap: c, error: e });
            } finally {
              hechos++;
              if (vigente) avance.textContent = textoAvance(hechos, lista.length);
            }
          }),
        );
        if (!vigente) return;
        avance.hidden = true;
        mostrarResultado();
      }

      function mostrarResultado(): void {
        const errores_ = [...fallidos.values()];
        // 401: `api` ya llamó al flujo de sesión (lleva al login recordando la ruta).
        if (errores_.some((x) => codigoDe(x.error) === 'sin_sesion')) {
          fallos.hidden = true;
          return;
        }
        if (errores_.some((x) => codigoDe(x.error) === 'sin_permiso')) {
          fallos.hidden = true;
          mostrarError(mensajeError(new ErrorApi(403, 'sin_permiso', '')));
          return;
        }
        if (cargados.size === 0 && errores_.length > 0 && errores_.every((x) => codigoDe(x.error) === 'etapa_no_permite')) {
          fallos.hidden = true;
          vacio.textContent = 'El registro de cambios estará disponible cuando se abra la consulta a los laboratorios.';
          vacio.hidden = false;
          return;
        }
        if (errores_.length > 0) {
          const lista = el('ul');
          for (const x of errores_) lista.append(el('li', {}, `${x.cap.orden}. ${x.cap.titulo}: ${mensajeError(x.error)}`));
          fallos.replaceChildren(
            el(
              'p',
              {},
              errores_.length === 1
                ? 'No se pudo cargar un capítulo; el resto del informe se muestra igual:'
                : `No se pudieron cargar ${errores_.length} capítulos; el resto del informe se muestra igual:`,
            ),
            lista,
            el('span', { class: 'no-imprimir' }, boton('Reintentar', () => (listo = reintentar()))),
          );
          fallos.hidden = false;
        } else {
          fallos.hidden = true;
        }
        // Filas en el orden de `GET /capitulos` (luego `filasInforme` ordena por `orden`).
        const caps: CapituloInforme[] = [];
        const aportes = new Map<number, AportesCapitulo>();
        for (const c of objetivo) {
          const x = cargados.get(c.id);
          if (!x) continue;
          caps.push(x.cap);
          aportes.set(c.id, x.aportes);
        }
        todas = filasInforme(caps, aportes);
        armarFiltros();
        redibujar();
        bImprimir.disabled = false;
        bCsv.disabled = false;
        bZip.disabled = false;
      }

      async function reintentar(): Promise<void> {
        fallos.hidden = true;
        await cargarCapitulos([...fallidos.values()].map((x) => x.cap));
      }

      async function cargar(): Promise<void> {
        errores.hidden = true;
        avance.textContent = 'Cargando…';
        avance.hidden = false;
        let cons: Consulta;
        let caps: CapituloLista[];
        try {
          [cons, caps] = await Promise.all([api.get<Consulta>('/consulta'), api.get<CapituloLista[]>('/capitulos')]);
        } catch (e) {
          if (!vigente) return;
          avance.hidden = true;
          if (codigoDe(e) !== 'sin_sesion') mostrarError(mensajeError(e), () => (listo = cargar()));
          return;
        }
        if (!vigente) return;
        if (cons.etapa === 'preparacion') {
          avance.hidden = true;
          vacio.textContent = 'La consulta aún no comienza: el registro de cambios estará disponible cuando se abra la consulta a los laboratorios.';
          vacio.hidden = false;
          return;
        }
        if (fijo) {
          const c = caps.find((x) => x.id === capituloId);
          if (!c) {
            avance.hidden = true;
            mostrarError('El capítulo no existe.');
            return;
          }
          titulo.textContent = `Registro de cambios — ${c.orden}. ${c.titulo}`;
          objetivo = [c];
        } else {
          objetivo = [...caps].sort((a, b) => a.orden - b.orden);
        }
        await cargarCapitulos(objetivo);
      }

      listo = cargar();
    },
    desmontar() {
      vigente = false;
      generacion++;
    },
    get listo() {
      return listo;
    },
  };
}

/** Vista de la ruta: sin el rol revisor no se pide nada (el servidor también lo exige). */
export function vistaInformeUsuario(
  api: Api,
  u: Usuario,
  capituloId: number | undefined,
  consulta: URLSearchParams,
  deps: DepsInforme = {},
): Vista {
  if (tieneRol(u, 'revisor')) return vistaInforme(api, capituloId, consulta, deps);
  return {
    montar(raiz) {
      raiz.append(
        el(
          'main',
          { class: 'app vista-informe' },
          el('div', { class: 'error', role: 'alert' }, 'El registro de cambios es solo para el rol revisor.'),
          el('a', { href: '#/capitulos', class: 'enlace-boton' }, 'Volver al inicio'),
        ),
      );
    },
    desmontar() {},
  };
}
