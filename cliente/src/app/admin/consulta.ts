/**
 * Administración de la consulta (`#/admin/consulta`), docs/api.md §4.6.
 *
 * - Arriba, una insignia con la etapa vigente y las dos fechas en hora de Chile.
 * - Acciones rápidas (Abrir ahora, Cerrar ahora, Extender cierre, Volver a abrir, Volver a preparación),
 *   cada una con una confirmación en la página (nunca `confirm()`) que advierte la consecuencia.
 * - Edición libre de apertura y cierre (`datetime-local` en hora de Chile) y de `motivoObligatorio`.
 *   El admin puede fijar cualquier par de fechas con cierre > apertura, o vaciar ambas para volver a
 *   preparación. Si lo guardado cambia la etapa, también se pide confirmación.
 * - «Zona de pruebas» (solo si el servidor tiene REINICIO_PRUEBAS=1): reinicia los datos de prueba.
 */
import { boton, el } from '../../editor/ui';
import { ErrorApi, type Api } from '../api';
import { analizarLocal, aLocal } from '../fechas';
import type { Vista } from '../router';
import type { Consulta, ConsultaEntrada, Etapa, ReinicioResultado } from '../tipos-api';
import { cabeceraAdmin, cajaError, mensajeError, mostrar } from './comun';

export interface VistaConsulta extends Vista {
  readonly listo: Promise<void>;
}

export interface OpcionesConsulta {
  /** Reloj inyectable (ms desde la época), para las pruebas. */
  ahora?: () => number;
}

const CAMPOS = ['apertura', 'cierre', 'motivoObligatorio'] as const;
const DIA = 86_400_000;
const CONFIRMACION_REINICIO = 'REINICIAR';

const NOMBRE_ETAPA: Record<Etapa, string> = {
  preparacion: 'Preparación',
  consulta: 'Consulta abierta',
  edicion_final: 'Edición final',
};

export const AVISO_CIERRE = 'Los laboratorios ya no podrán editar; el revisor podrá decidir.';

/** ISO en UTC sin fracciones de segundo (la base guarda segundos). */
const isoZ = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** «12/11/2026 09:00» en hora de Chile, o «sin fecha». */
function fechaChile(iso: string | null): string {
  if (!iso) return 'sin fecha';
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(aLocal(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : iso;
}

/** Etapa que resultaría de unas fechas en el instante `ahora` (misma regla que el servidor, docs/api.md §3). */
function etapaDe(apertura: string | null, cierre: string | null, ahora: number): Etapa {
  if (apertura === null || ahora < Date.parse(apertura)) return 'preparacion';
  return cierre !== null && ahora >= Date.parse(cierre) ? 'edicion_final' : 'consulta';
}

const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

type Propuesta = ConsultaEntrada;

export function vistaConsulta(api: Api, opciones: OpcionesConsulta = {}): VistaConsulta {
  const reloj = opciones.ahora ?? (() => Date.now());
  let vigente = true;
  let listo: Promise<void> = Promise.resolve();
  let actual: Consulta | null = null;
  let ocupado = false;
  /** Desfase (ms) entre la hora del servidor (`ahora` de GET/PUT /consulta) y el reloj local. */
  let desfase = 0;

  const errores = cajaError();
  const exito = el('div', { class: 'exito', role: 'status', hidden: '' });

  // Estado actual: insignia de etapa y fechas.
  const insignia = el('span', { class: 'insignia-etapa' });
  const fechas = el('dl', { class: 'fechas-consulta' });
  const estado = el('section', { class: 'estado-consulta', 'aria-label': 'Estado de la consulta' }, insignia, fechas);

  // Acciones rápidas y su confirmación.
  const acciones = el('div', { class: 'acciones-rapidas' });
  const zonaConfirmacion = el('div', {});

  // Edición libre.
  const apertura = el('input', { type: 'datetime-local', name: 'apertura', id: 'con-apertura' });
  const cierre = el('input', { type: 'datetime-local', name: 'cierre', id: 'con-cierre' });
  const motivo = el('input', { type: 'checkbox', name: 'motivoObligatorio', id: 'con-motivo' });
  const errorCampo: Record<string, HTMLElement> = {};
  const avisoCampo: Record<string, HTMLElement> = {};
  for (const c of CAMPOS) {
    errorCampo[c] = el('div', { class: 'error-campo', 'data-campo': c, role: 'alert', hidden: '' });
  }
  for (const c of ['apertura', 'cierre']) avisoCampo[c] = el('div', { class: 'ayuda', 'data-aviso': c, hidden: '' });
  const btnGuardar = boton('Guardar', () => void guardar(), 'primario');

  // Zona de pruebas: se agrega a la página solo si el servidor la habilita.
  let principal: HTMLElement | null = null;
  const zonaPruebas = el('section', { class: 'zona-pruebas', 'aria-labelledby': 'titulo-zona-pruebas' });
  const entradaReinicio = el('input', {
    type: 'text',
    name: 'confirmacion-reinicio',
    id: 'confirmacion-reinicio',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const btnReiniciar = boton('Reiniciar datos de prueba', () => void reiniciar(), 'borrar-definitivo');
  const errorReinicio = cajaError();
  const estadoReinicio = el('div', { class: 'exito', role: 'status', hidden: '' });

  const ahora = (): number => Math.floor((reloj() + desfase) / 1000) * 1000;

  function avisar(campo: 'apertura' | 'cierre', entrada: HTMLInputElement): void {
    const caja = avisoCampo[campo];
    caja.hidden = true;
    if (!entrada.value) return;
    try {
      const { estado: e } = analizarLocal(entrada.value);
      if (e === 'ambigua') {
        caja.textContent = 'Esa hora ocurre dos veces por el cambio de hora; se usará la primera.';
        caja.hidden = false;
      } else if (e === 'inexistente') {
        caja.textContent = 'Esa hora no existe por el cambio de hora; se usará una hora después.';
        caja.hidden = false;
      }
    } catch {
      /* fecha incompleta: el navegador deja el valor vacío */
    }
  }

  function pintarEstado(c: Consulta): void {
    insignia.textContent = NOMBRE_ETAPA[c.etapa];
    insignia.dataset.etapa = c.etapa;
    fechas.replaceChildren(
      el('div', {}, el('dt', {}, 'Apertura'), el('dd', {}, fechaChile(c.apertura))),
      el('div', {}, el('dt', {}, 'Cierre'), el('dd', {}, fechaChile(c.cierre))),
      el('div', { class: 'ayuda' }, 'En hora de Chile (America/Santiago).'),
    );
  }

  function pintarAcciones(c: Consulta): void {
    const lista: HTMLButtonElement[] = [];
    const accion = (texto: string, f: () => void) => lista.push(boton(texto, f));
    if (c.etapa === 'preparacion') accion('Abrir ahora', abrirAhora);
    if (c.etapa === 'consulta') {
      accion('Cerrar ahora', cerrarAhora);
      accion('Extender cierre +1 día', () => extender(DIA, 'un día'));
      accion('+1 semana', () => extender(7 * DIA, 'una semana'));
    }
    if (c.etapa === 'edicion_final') accion('Volver a abrir', volverAAbrir);
    if (c.apertura !== null || c.cierre !== null) accion('Volver a preparación', volverAPreparacion);
    for (const b of lista) b.disabled = ocupado;
    acciones.replaceChildren(...lista);
  }

  function pintar(c: Consulta): void {
    actual = c;
    if (c.ahora && !Number.isNaN(Date.parse(c.ahora))) desfase = Date.parse(c.ahora) - reloj();
    apertura.value = c.apertura ? aLocal(c.apertura) : '';
    cierre.value = c.cierre ? aLocal(c.cierre) : '';
    motivo.checked = c.motivoObligatorio;
    pintarEstado(c);
    pintarAcciones(c);
    if (c.reinicioPermitido === true && principal && !zonaPruebas.isConnected) principal.append(zonaPruebas);
    if (c.reinicioPermitido !== true) zonaPruebas.remove();
    avisar('apertura', apertura);
    avisar('cierre', cierre);
  }

  // ---------------------------------------------------------------- confirmación

  /** Advertencias según el paso de la etapa actual a la que resultaría. */
  function advertencias(destino: Etapa): string[] {
    if (!actual) return [];
    const origen = actual.etapa;
    const res: string[] = [];
    if (destino === 'edicion_final' && origen !== 'edicion_final') res.push(AVISO_CIERRE);
    const decisiones = actual.decisionesTomadas ?? 0;
    if (destino === 'consulta' && origen === 'edicion_final' && decisiones > 0) {
      res.push(
        `Hay ${plural(decisiones, 'decisión tomada', 'decisiones tomadas')} por el revisor. Las propuestas que los laboratorios no cambien conservan su decisión. Si un laboratorio modifica una propuesta ya decidida, pasa a ser una propuesta nueva y llega pendiente: el revisor tendrá que decidirla de nuevo.`,
      );
    }
    const finales = actual.versionesFinal ?? 0;
    if (destino === 'consulta' && origen === 'edicion_final' && finales > 0) {
      res.push(
        `Hay ${plural(finales, 'versión final guardada', 'versiones finales guardadas')}. Si los laboratorios cambian sus propuestas, el revisor tendrá que revisarlas y volver a guardar la versión final.`,
      );
    }
    const aportes = actual.aportes ?? 0;
    if (destino === 'preparacion' && origen !== 'preparacion' && aportes > 0) {
      res.push(
        `El trabajo de los laboratorios (${plural(aportes, 'aporte', 'aportes')}) y las decisiones del revisor quedan guardados, pero los laboratorios no podrán editar hasta que la consulta se vuelva a abrir.`,
      );
    }
    return res;
  }

  function cerrarConfirmacion(): void {
    zonaConfirmacion.replaceChildren();
  }

  /** Muestra la confirmación de un cambio de fechas; al confirmar, lo envía. */
  function confirmarCambio(pregunta: string, p: Propuesta): void {
    limpiarMensajes();
    const destino = etapaDe(p.apertura, p.cierre, ahora());
    const resumen =
      p.apertura === null
        ? 'Quedará en preparación, sin fechas.'
        : `Quedará en «${NOMBRE_ETAPA[destino]}». Apertura: ${fechaChile(p.apertura)}. Cierre: ${fechaChile(p.cierre)} (hora de Chile).`;
    const cancelar = boton('Cancelar', cerrarConfirmacion, 'cancelar');
    zonaConfirmacion.replaceChildren(
      el(
        'div',
        { class: 'confirmar confirmar-consulta', role: 'group', 'aria-label': 'Confirmar el cambio' },
        el('p', { class: 'pregunta' }, pregunta),
        el('p', {}, resumen),
        ...advertencias(destino).map((a) => el('p', { class: 'advertencia' }, a)),
        el(
          'div',
          { class: 'acciones' },
          boton(
            'Confirmar',
            () => {
              cerrarConfirmacion();
              void enviar(p);
            },
            'primario',
          ),
          cancelar,
        ),
      ),
    );
    cancelar.focus();
  }

  // ---------------------------------------------------------------- acciones rápidas

  function abrirAhora(): void {
    if (!actual) return;
    const t = ahora();
    const cierreVigente = actual.cierre && Date.parse(actual.cierre) > t ? actual.cierre : isoZ(t + 7 * DIA);
    confirmarCambio('¿Abrir la consulta ahora? Los laboratorios podrán entrar a editar desde este momento.', {
      apertura: isoZ(t),
      cierre: cierreVigente,
      motivoObligatorio: actual.motivoObligatorio,
    });
  }

  function cerrarAhora(): void {
    if (!actual) return;
    confirmarCambio('¿Cerrar la consulta ahora?', {
      apertura: actual.apertura,
      cierre: isoZ(ahora()),
      motivoObligatorio: actual.motivoObligatorio,
    });
  }

  function extender(ms: number, texto: string): void {
    if (!actual) return;
    const desde = actual.cierre ? Date.parse(actual.cierre) : ahora();
    confirmarCambio(`¿Extender el cierre ${texto}?`, {
      apertura: actual.apertura,
      cierre: isoZ(desde + ms),
      motivoObligatorio: actual.motivoObligatorio,
    });
  }

  function volverAAbrir(): void {
    if (!actual) return;
    confirmarCambio('¿Volver a abrir la consulta por 7 días?', {
      apertura: actual.apertura,
      cierre: isoZ(ahora() + 7 * DIA),
      motivoObligatorio: actual.motivoObligatorio,
    });
  }

  function volverAPreparacion(): void {
    if (!actual) return;
    confirmarCambio('¿Volver a preparación? Se quitan las dos fechas.', {
      apertura: null,
      cierre: null,
      motivoObligatorio: actual.motivoObligatorio,
    });
  }

  // ---------------------------------------------------------------- envío

  function limpiarMensajes(): void {
    mostrar(errores, null);
    exito.hidden = true;
    for (const c of CAMPOS) mostrar(errorCampo[c], null);
  }

  function marcarOcupado(si: boolean): void {
    ocupado = si;
    btnGuardar.disabled = si;
    actualizarBotonReinicio();
    if (actual) pintarAcciones(actual);
  }

  async function hacerEnvio(p: Propuesta): Promise<void> {
    if (ocupado) return;
    limpiarMensajes();
    marcarOcupado(true);
    try {
      const nueva = await api.put<Consulta>('/admin/consulta', p);
      if (!vigente) return;
      pintar(nueva);
      exito.textContent = `Cambios guardados. Etapa: ${NOMBRE_ETAPA[nueva.etapa]}.`;
      exito.hidden = false;
    } catch (e) {
      if (!vigente) return;
      if (e instanceof ErrorApi && e.estado === 400 && e.campos) {
        let alguno = false;
        for (const [k, v] of Object.entries(e.campos)) {
          if (errorCampo[k]) {
            mostrar(errorCampo[k], v);
            alguno = true;
          }
        }
        if (!alguno) mostrar(errores, mensajeError(e));
      } else mostrar(errores, mensajeError(e));
    } finally {
      if (vigente) marcarOcupado(false);
    }
  }

  function enviar(p: Propuesta): Promise<void> {
    listo = hacerEnvio(p);
    return listo;
  }

  /** ISO a enviar: el original si el campo no cambió; si no, la hora local con su desfase. */
  function iso(entrada: HTMLInputElement, original: string | null): string | null {
    if (original && entrada.value === aLocal(original)) return original;
    if (!entrada.value) return null;
    return analizarLocal(entrada.value).iso;
  }

  async function hacerGuardado(): Promise<void> {
    if (!actual) return;
    limpiarMensajes();
    cerrarConfirmacion();
    const ap = iso(apertura, actual.apertura);
    const ci = iso(cierre, actual.cierre);
    if ((ap === null) !== (ci === null)) {
      const falta = ap === null ? 'apertura' : 'cierre';
      mostrar(errorCampo[falta], 'Indique ambas fechas, o deje ambas vacías para volver a preparación.');
      return;
    }
    if (ap && ci && Date.parse(ci) <= Date.parse(ap)) {
      mostrar(errorCampo.cierre, 'El cierre debe ser posterior a la apertura.');
      return;
    }
    const p: Propuesta = { apertura: ap, cierre: ci, motivoObligatorio: motivo.checked };
    // Si lo guardado cambia la etapa, se confirma igual que una acción rápida.
    if (etapaDe(ap, ci, ahora()) !== actual.etapa) {
      confirmarCambio('Estas fechas cambian la etapa de la consulta. ¿Guardar?', p);
      return;
    }
    await hacerEnvio(p);
  }

  function guardar(): Promise<void> {
    listo = hacerGuardado();
    return listo;
  }

  // ---------------------------------------------------------------- reinicio de pruebas

  function actualizarBotonReinicio(): void {
    btnReiniciar.disabled = ocupado || entradaReinicio.value !== CONFIRMACION_REINICIO;
  }

  function textoBorrados(b: ReinicioResultado['borrados']): string {
    return [
      plural(b.sugerencias, 'sugerencia', 'sugerencias'),
      plural(b.comentarios, 'comentario', 'comentarios'),
      plural(b.copias_laboratorio, 'copia de laboratorio', 'copias de laboratorio'),
      plural(b.revisiones_copia, 'instantánea', 'instantáneas'),
      plural(b.versiones_final, 'versión final', 'versiones finales'),
    ].join(', ');
  }

  async function hacerReinicio(): Promise<void> {
    if (ocupado || entradaReinicio.value !== CONFIRMACION_REINICIO) return;
    mostrar(errorReinicio, null);
    estadoReinicio.hidden = true;
    limpiarMensajes();
    cerrarConfirmacion();
    marcarOcupado(true);
    try {
      const r = await api.post<ReinicioResultado>('/admin/reiniciar', { confirmacion: CONFIRMACION_REINICIO });
      if (!vigente) return;
      entradaReinicio.value = '';
      mostrar(estadoReinicio, `Datos de prueba reiniciados. Respaldo previo: ${r.respaldo}. Borrado: ${textoBorrados(r.borrados)}.`);
      const c = await api.get<Consulta>('/consulta');
      if (vigente) pintar(c);
    } catch (e) {
      if (vigente) mostrar(errorReinicio, mensajeError(e));
    } finally {
      if (vigente) marcarOcupado(false);
    }
  }

  function reiniciar(): Promise<void> {
    listo = hacerReinicio();
    return listo;
  }

  function armarZonaPruebas(): void {
    entradaReinicio.addEventListener('input', actualizarBotonReinicio);
    actualizarBotonReinicio();
    zonaPruebas.append(
      el('h2', { id: 'titulo-zona-pruebas' }, 'Zona de pruebas'),
      el(
        'p',
        {},
        'Deja la plataforma lista para una nueva ronda de pruebas. Solo aparece mientras el servidor tenga REINICIO_PRUEBAS=1; antes de la consulta real se desactiva.',
      ),
      el(
        'ul',
        {},
        el(
          'li',
          {},
          el('strong', {}, 'Se borra: '),
          'las copias de los laboratorios y sus instantáneas, las sugerencias, los comentarios, las decisiones y versiones finales del revisor, y las fechas de la consulta (vuelve a preparación).',
        ),
        el(
          'li',
          {},
          el('strong', {}, 'Se conserva: '),
          'los capítulos con su texto base, los usuarios y sus claves, la auditoría y los registros de inicio de sesión.',
        ),
        el('li', {}, 'Antes de borrar se guarda un respaldo completo de la base en el servidor (var/respaldos).'),
      ),
      el('label', { for: 'confirmacion-reinicio' }, `Para confirmar, escriba ${CONFIRMACION_REINICIO}`),
      entradaReinicio,
      btnReiniciar,
      errorReinicio,
      estadoReinicio,
    );
  }

  const campoFila = (id: string, etiqueta: string, entrada: HTMLElement, ...extra: HTMLElement[]) =>
    el('div', { class: 'campo' }, el('label', { for: id }, etiqueta), entrada, ...extra);

  return {
    get listo() {
      return listo;
    },
    montar(raiz) {
      apertura.addEventListener('input', () => avisar('apertura', apertura));
      cierre.addEventListener('input', () => avisar('cierre', cierre));
      armarZonaPruebas();
      principal = el(
        'main',
        { class: 'app admin' },
        cabeceraAdmin('Consulta'),
        estado,
        errores,
        exito,
        el('h2', {}, 'Acciones rápidas'),
        acciones,
        zonaConfirmacion,
        el('h2', {}, 'Fechas'),
        el(
          'p',
          { class: 'ayuda' },
          'Puede fijar cualquier apertura y cierre, también en el pasado, con el cierre posterior a la apertura. Deje ambas vacías para volver a preparación. Las horas son de Chile (America/Santiago).',
        ),
        campoFila('con-apertura', 'Apertura (hora de Chile)', apertura, avisoCampo.apertura, errorCampo.apertura),
        campoFila('con-cierre', 'Cierre (hora de Chile)', cierre, avisoCampo.cierre, errorCampo.cierre),
        campoFila('con-motivo', 'Exigir motivo en cada cambio propuesto', motivo, errorCampo.motivoObligatorio),
        btnGuardar,
      );
      raiz.append(principal);
      listo = api.get<Consulta>('/consulta').then(
        (c) => {
          if (vigente) pintar(c);
        },
        (e: unknown) => {
          if (vigente) mostrar(errores, mensajeError(e));
        },
      );
    },
    desmontar() {
      vigente = false;
    },
  };
}
