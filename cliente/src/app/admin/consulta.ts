/**
 * Administración de la consulta (`#/admin/consulta`): apertura y cierre en hora de Chile
 * (`datetime-local`) y `motivoObligatorio`. Fuera de preparación solo se puede extender el
 * cierre (durante la consulta) o cambiar el motivo (docs/api.md §4.6).
 */
import { boton, el } from '../../editor/ui';
import { ErrorApi, type Api } from '../api';
import { analizarLocal, aLocal } from '../fechas';
import type { Vista } from '../router';
import type { Consulta, ConsultaEntrada } from '../tipos-api';
import { cabeceraAdmin, cajaError, mensajeError, mostrar } from './comun';

export interface VistaConsulta extends Vista {
  readonly listo: Promise<void>;
}

const CAMPOS = ['apertura', 'cierre', 'motivoObligatorio'] as const;

export function vistaConsulta(api: Api): VistaConsulta {
  let vigente = true;
  let listo: Promise<void> = Promise.resolve();
  let actual: Consulta | null = null;

  const errores = cajaError();
  const exito = el('div', { class: 'exito', role: 'status', hidden: '' });
  const nota = el('p', { class: 'nota-etapa' });
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

  function avisar(campo: 'apertura' | 'cierre', entrada: HTMLInputElement): void {
    const caja = avisoCampo[campo];
    caja.hidden = true;
    if (!entrada.value) return;
    try {
      const { estado } = analizarLocal(entrada.value);
      if (estado === 'ambigua') {
        caja.textContent = 'Esa hora ocurre dos veces por el cambio de hora; se usará la primera.';
        caja.hidden = false;
      } else if (estado === 'inexistente') {
        caja.textContent = 'Esa hora no existe por el cambio de hora; se usará una hora después.';
        caja.hidden = false;
      }
    } catch {
      /* fecha incompleta: el navegador deja el valor vacío */
    }
  }

  function pintar(c: Consulta): void {
    actual = c;
    apertura.value = c.apertura ? aLocal(c.apertura) : '';
    cierre.value = c.cierre ? aLocal(c.cierre) : '';
    motivo.checked = c.motivoObligatorio;
    apertura.disabled = c.etapa !== 'preparacion';
    cierre.disabled = c.etapa === 'edicion_final';
    nota.textContent =
      c.etapa === 'preparacion'
        ? 'La consulta está en preparación: puede fijar apertura y cierre. Las horas son de Chile (America/Santiago).'
        : c.etapa === 'consulta'
          ? 'La consulta está abierta: solo se puede extender el cierre (y cambiar si el motivo es obligatorio).'
          : 'La consulta ya cerró: solo se puede cambiar si el motivo es obligatorio.';
    avisar('apertura', apertura);
    avisar('cierre', cierre);
  }

  /** ISO a enviar: el original si el campo no cambió; si no, la hora local con su desfase. */
  function iso(entrada: HTMLInputElement, original: string | null): string | null {
    if (original && entrada.value === aLocal(original)) return original;
    if (!entrada.value) return null;
    return analizarLocal(entrada.value).iso;
  }

  async function hacerGuardado(): Promise<void> {
    if (!actual) return;
    mostrar(errores, null);
    exito.hidden = true;
    for (const c of CAMPOS) mostrar(errorCampo[c], null);
    const ap = iso(apertura, actual.apertura);
    const ci = iso(cierre, actual.cierre);
    let ok = true;
    if (!ap) {
      mostrar(errorCampo.apertura, 'Indique la apertura.');
      ok = false;
    }
    if (!ci) {
      mostrar(errorCampo.cierre, 'Indique el cierre.');
      ok = false;
    }
    if (ap && ci) {
      if (Date.parse(ci) <= Date.parse(ap)) {
        mostrar(errorCampo.cierre, 'El cierre debe ser posterior a la apertura.');
        ok = false;
      } else if (
        actual.etapa === 'consulta' &&
        actual.cierre &&
        ci !== actual.cierre &&
        Date.parse(ci) <= Date.parse(actual.cierre)
      ) {
        mostrar(errorCampo.cierre, 'Durante la consulta el cierre solo puede extenderse: debe ser posterior al cierre actual.');
        ok = false;
      }
    }
    if (!ok || !ap || !ci) return;
    const cuerpo: ConsultaEntrada = { apertura: ap, cierre: ci, motivoObligatorio: motivo.checked };
    btnGuardar.disabled = true;
    try {
      const nueva = await api.put<Consulta>('/admin/consulta', cuerpo);
      if (!vigente) return;
      pintar(nueva);
      exito.textContent = 'Cambios guardados.';
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
      } else if (e instanceof ErrorApi && e.codigo === 'etapa_no_permite') {
        mostrar(errores, 'La etapa actual no permite ese cambio: solo se puede extender el cierre durante la consulta.');
      } else mostrar(errores, mensajeError(e));
    } finally {
      btnGuardar.disabled = false;
    }
  }

  function guardar(): Promise<void> {
    listo = hacerGuardado();
    return listo;
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
      raiz.append(
        el(
          'main',
          { class: 'app admin' },
          cabeceraAdmin('Consulta'),
          nota,
          errores,
          exito,
          campoFila('con-apertura', 'Apertura (hora de Chile)', apertura, avisoCampo.apertura, errorCampo.apertura),
          campoFila('con-cierre', 'Cierre (hora de Chile)', cierre, avisoCampo.cierre, errorCampo.cierre),
          campoFila('con-motivo', 'Exigir motivo en cada cambio propuesto', motivo, errorCampo.motivoObligatorio),
          btnGuardar,
        ),
      );
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
