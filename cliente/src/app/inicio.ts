/**
 * Inicio (`#/capitulos`): banner de etapa con las fechas de la consulta en hora de Chile,
 * lista de capítulos con contadores y enlaces según los roles (docs/api.md §4.1–4.2).
 * «Salir» avisa en la página si quedan borradores propios sin enviar en este navegador
 * (no se borran: el principio rector pide no perder trabajo).
 */
import { boton, el, mensajeDe } from '../editor/ui';
import { ErrorApi, SIN_CONEXION, type Api } from './api';
import type { Vista } from './router';
import { tieneRol } from './sesion';
import type { CapituloLista, Consulta, Etapa, Usuario } from './tipos-api';

const ZONA = 'America/Santiago';

const formato = new Intl.DateTimeFormat('es-CL', {
  timeZone: ZONA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Fecha del servidor (UTC) en hora de Chile, p. ej. `02-11-2026 09:00`. */
export function formatearFecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Fecha inválida: ${iso}`);
  return formato.format(d).replace(',', '');
}

const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

export function textoBanner(c: Consulta): string {
  const hora = (iso: string | null) => (iso ? `${formatearFecha(iso)} (hora de Chile)` : null);
  switch (c.etapa as Etapa | string) {
    case 'preparacion': {
      const ap = hora(c.apertura);
      return ap
        ? `La consulta aún no comienza. Se abre el ${ap}.`
        : 'La consulta aún no comienza: está en preparación y todavía no tiene fecha de apertura.';
    }
    default:
      return 'No se pudo determinar la etapa de la consulta.';
    case 'consulta': {
      const ap = hora(c.apertura);
      const ci = hora(c.cierre);
      const rango = [ap && `desde el ${ap}`, ci && `hasta el ${ci}`].filter(Boolean).join(' ');
      return `Consulta abierta${rango ? ` ${rango}` : ''}. Puede proponer cambios y comentarios.`;
    }
    case 'edicion_final': {
      const ci = hora(c.cierre);
      return `La consulta cerró${ci ? ` el ${ci}` : ''}. Estamos en la etapa de edición final.`;
    }
  }
}

function mensajeError(e: unknown): string {
  if (e instanceof ErrorApi && e.codigo === SIN_CONEXION) {
    return 'No hay conexión con el servidor. Revise su conexión a Internet e intente de nuevo.';
  }
  return mensajeDe(e);
}

export interface DepsInicio {
  salir: () => Promise<void>;
  /** localStorage por defecto. */
  almacen?: Storage;
}

/** Prefijos de los borradores locales de una persona (laboratorio y revisor). */
const prefijosBorrador = (usuarioId: number) =>
  ['borrador', 'motivos', 'comentarios', 'revisor:final'].map((t) => `mm:${t}:${usuarioId}:`);

/** ¿Quedan borradores propios con contenido en este navegador? */
export function hayBorradoresPropios(almacen: Storage | undefined, usuarioId: number): boolean {
  try {
    if (!almacen) return false;
    const prefijos = prefijosBorrador(usuarioId);
    for (let i = 0; i < almacen.length; i++) {
      const clave = almacen.key(i);
      if (!clave || !prefijos.some((p) => clave.startsWith(p))) continue;
      const valor = almacen.getItem(clave);
      if (valor && valor !== '{}' && valor !== 'null') return true;
    }
  } catch {
    // sin almacenamiento local
  }
  return false;
}

function almacenLocal(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function vistaInicio(api: Api, u: Usuario, deps: DepsInicio): Vista & { listo: Promise<void> } {
  let vigente = true;
  let listo: Promise<void> = Promise.resolve();

  const esLab = tieneRol(u, 'laboratorio');
  const esRevisor = tieneRol(u, 'revisor');
  const esAdmin = tieneRol(u, 'admin');

  function fila(c: CapituloLista, etapa: Etapa): HTMLElement {
    const datos: string[] = [];
    if (esLab) datos.push(plural(c.misCambios, 'cambio', 'cambios'), plural(c.misComentarios, 'comentario', 'comentarios'));
    if (esRevisor) {
      datos.push(
        plural(c.totalSugerencias ?? 0, 'sugerencia', 'sugerencias'),
        plural(c.totalComentarios ?? 0, 'comentario', 'comentarios'),
        plural(c.pendientes ?? 0, 'pendiente', 'pendientes'),
      );
    }
    const acciones: HTMLElement[] = [];
    if (esLab) {
      // Fuera de la consulta la vista del capítulo es de solo lectura.
      const texto = etapa === 'consulta' ? 'Abrir en el editor' : 'Ver capítulo';
      acciones.push(el('a', { href: `#/capitulo/${c.id}`, class: 'enlace-boton' }, texto));
    }
    if (esRevisor) acciones.push(el('a', { href: `#/revisar/${c.id}`, class: 'enlace-boton' }, 'Revisar'));
    return el(
      'li',
      { class: 'capitulo' },
      el('div', { class: 'capitulo-titulo' }, el('span', { class: 'orden' }, `${c.orden}.`), ' ', c.titulo),
      el('div', { class: 'capitulo-datos' }, datos.join(' · ')),
      el('div', { class: 'capitulo-acciones' }, ...acciones),
    );
  }

  return {
    montar(raiz) {
      const banner = el('div', { class: 'banner-etapa' }, 'Cargando…');
      const lista = el('ul', { class: 'capitulos' });
      const errores = el('div', { class: 'error', role: 'alert', hidden: '' });
      const avisoSalir = el('div', { class: 'aviso aviso-salir', role: 'alert', hidden: '' });

      const salirYa = () =>
        void deps.salir().catch((e: unknown) => {
          errores.textContent = mensajeError(e);
          errores.hidden = false;
        });
      const pedirSalir = () => {
        if (!hayBorradoresPropios(deps.almacen ?? almacenLocal(), u.id)) {
          salirYa();
          return;
        }
        avisoSalir.replaceChildren(
          el(
            'p',
            {},
            'Hay cambios sin guardar en este navegador. Vuelva a abrir esos capítulos para que se guarden (o cópielos) antes de salir; si sale igual, quedan solo en este navegador.',
          ),
          el(
            'div',
            { class: 'botones' },
            boton('Cancelar', () => (avisoSalir.hidden = true), 'primario'),
            boton(
              'Salir de todos modos',
              () => {
                avisoSalir.hidden = true;
                salirYa();
              },
              'secundario',
            ),
          ),
        );
        avisoSalir.hidden = false;
      };

      const menuAdmin = esAdmin ? el('a', { href: '#/admin', class: 'enlace-boton' }, 'Administración') : null;
      const cabecera = el(
        'header',
        { class: 'cabecera-app' },
        el('div', {}, el('h1', {}, 'Manual de métodos'), el('div', { class: 'subtitulo' }, `${u.nombre} · ${u.laboratorio}`)),
        el(
          'div',
          { class: 'cabecera-acciones' },
          menuAdmin,
          boton('Salir', pedirSalir),
        ),
      );
      raiz.append(el('main', { class: 'app' }, cabecera, banner, errores, avisoSalir, el('h2', {}, 'Capítulos'), lista));

      listo = Promise.all([api.get<Consulta>('/consulta'), api.get<CapituloLista[]>('/capitulos')]).then(
        ([consulta, capitulos]) => {
          if (!vigente) return;
          banner.className = `banner-etapa etapa-${consulta.etapa}`;
          try {
            banner.textContent = textoBanner(consulta);
          } catch {
            banner.textContent = 'No se pudieron mostrar las fechas de la consulta.';
          }
          lista.replaceChildren(...capitulos.map((c) => fila(c, consulta.etapa)));
          if (capitulos.length === 0) lista.append(el('li', { class: 'vacio' }, 'Todavía no hay capítulos publicados.'));
        },
        (e: unknown) => {
          if (!vigente) return;
          banner.textContent = '';
          errores.textContent = mensajeError(e);
          errores.hidden = false;
        },
      );
    },
    desmontar() {
      vigente = false;
    },
    get listo() {
      return listo;
    },
  };
}
