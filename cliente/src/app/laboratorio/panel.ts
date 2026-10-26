/**
 * Panel lateral del laboratorio (spec §5.1; docs/api.md §4.3 y §4.5).
 *
 * "Mis cambios":
 * - Una entrada por unidad (`unidades()`): un bloque movido cuenta como una sola.
 * - Clic en un cambio: lo resalta y lleva el editor hasta él.
 * - Campo "Motivo" por unidad. Se guarda al salir del campo con
 *   `PATCH /capitulos/{id}/sugerencias/{uid}` (un PATCH por miembro de la unidad).
 * - Si la sugerencia aún no está en el servidor (la copia no se ha guardado), el motivo
 *   espera: se pide guardar la copia y el motivo viaja en el cuerpo del `PUT …/copia`
 *   (el servidor lo toma para las sugerencias nuevas, §4.3). Al confirmar la copia, lo que
 *   no haya viajado así se envía con PATCH.
 * - El uid de una sugerencia depende de su contenido: si el cambio se sigue editando, el
 *   uid cambia. El motivo se traslada al cambio nuevo cuando hay un único candidato
 *   (mismo bloque y grupo) y queda sin guardar hasta que viaje con la copia. Si no hay
 *   candidato claro (p. ej. el cambio se deshizo), queda en "Motivos sin cambio asociado",
 *   visible y copiable, hasta que el laboratorio lo descarte.
 * - Todo motivo no confirmado por el servidor queda además en un borrador local
 *   (`mm:motivos:<usuarioId>:<capituloId>:<versionId>`). Un fallo se muestra con
 *   `role="alert"` y un botón "Reintentar".
 * - `motivoObligatorio`: las unidades sin motivo se marcan y la cabecera dice
 *   "N cambios sin motivo". Nunca bloquea el guardado (principio rector).
 *
 * "Mis aportes" (edicion_final): `GET …/mis-aportes` con el estado y la nota de resolución.
 *
 * Fuera de `consulta` el panel no lee ni escribe el borrador de motivos (`usarBorrador:
 * false`): la vista muestra los borradores de motivos y comentarios que no alcanzaron a
 * enviarse en una caja de solo lectura para copiar (`cajaBorradoresSinEnviar`).
 */
import { NOMBRE_TIPO, boton, el, mensajeDe, resumenUnidad, unidades, type Unidad } from '../../editor/ui';
import type { Sugerencia } from '../../tipos';
import { ErrorApi, type Api } from '../api';
import type { Aportes, Comentario, SugerenciaServidor } from '../tipos-api';
import { claveComentarios } from './comentarios';

const MAX_MOTIVO = 2000;

type EstadoMotivo = 'guardado' | 'pendiente' | 'esperando' | 'guardando' | 'error';

interface Entrada {
  /** Lo que hay en el campo. */
  texto: string;
  /** Lo último confirmado por el servidor ('' = sin motivo). */
  guardado: string;
  estado: EstadoMotivo;
  error?: string;
  /** Hubo otra salida del campo mientras se guardaba. */
  repetir?: boolean;
  bloqueId: string;
  grupo?: string;
}

interface Huerfano {
  texto: string;
  bloqueId: string;
  grupo?: string;
}

interface VistaUnidad {
  li: HTMLLIElement;
  campo: HTMLTextAreaElement;
  estado: HTMLElement;
  falta: HTMLElement;
  error: HTMLElement;
  mensajeError: HTMLElement;
  reintentar: HTMLButtonElement;
}

export interface OpcionesPanel {
  api: Api;
  capituloId: number;
  versionId: number;
  usuarioId: number;
  almacen?: Storage;
  motivoObligatorio: boolean;
  /** Sugerencias guardadas en el servidor (de `GET …/copia`, misma versión base). */
  sugerenciasServidor: SugerenciaServidor[];
  /** Resalta y lleva el editor a la sugerencia. */
  resaltar(id: string): void;
  /** La sugerencia aún no está en el servidor: hay que guardar la copia. */
  pedirGuardado(): void;
  /** Una escritura respondió 409 `etapa_no_permite`. */
  alEtapaCerrada(): void;
  /** false fuera de `consulta`: no se lee ni se escribe el borrador local. */
  usarBorrador?: boolean;
}

export interface PanelCambios {
  elemento: HTMLElement;
  actualizar(sugerencias: Sugerencia[]): void;
  habilitar(si: boolean): void;
  /** Motivo que se envía con la sugerencia en el `PUT …/copia`. */
  motivoDe(s: Sugerencia): string | undefined;
  alConfirmarCopia(enviadas: Sugerencia[]): void;
  /** ¿Hay motivos aún no guardados en el servidor (incluidos los sin cambio asociado)? */
  sinGuardar(): boolean;
}

export const claveMotivos = (usuarioId: number, capituloId: number, versionId: number) =>
  `mm:motivos:${usuarioId}:${capituloId}:${versionId}`;

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function leerJson<T>(almacen: Storage | undefined, clave: string): T | null {
  try {
    const crudo = almacen?.getItem(clave);
    return crudo ? (JSON.parse(crudo) as T) : null;
  } catch {
    return null;
  }
}

function escribirJson(almacen: Storage | undefined, clave: string, valor: unknown | null): boolean {
  try {
    if (!almacen) return false;
    if (valor === null) almacen.removeItem(clave);
    else almacen.setItem(clave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}

export function crearPanelCambios(op: OpcionesPanel): PanelCambios {
  const claveBorrador = claveMotivos(op.usuarioId, op.capituloId, op.versionId);
  const entradas = new Map<string, Entrada>();
  const huerfanos = new Map<string, Huerfano>();
  const vistas = new Map<string, VistaUnidad>();
  let actuales: Unidad[] = [];
  let claveDeUid = new Map<string, string>();
  let uidsServidor = new Set(op.sugerenciasServidor.map((s) => s.id));
  const motivosServidor = new Map<string, string>();
  for (const s of op.sugerenciasServidor) if (s.motivo) motivosServidor.set(s.id, s.motivo);
  let iniciado = false;
  let habilitado = false;
  let sincronizadoInicial = false;

  const cabecera = el('h2', {}, 'Mis cambios');
  const total = el('span', { class: 'total-cambios' });
  const contador = el('span', { class: 'contador-sin-motivo' });
  contador.hidden = true;
  const avisoBorrador = el('p', { class: 'aviso-borrador-motivos', role: 'alert' });
  avisoBorrador.hidden = true;
  const vacio = el('p', { class: 'vacio' }, 'Aún no hay cambios. Edite el texto y aparecerán aquí.');
  const lista = el('ol', { class: 'lista-cambios' });
  const listaHuerfanos = el('ul', { class: 'lista-huerfanos' });
  const cajaHuerfanos = el(
    'div',
    { class: 'motivos-huerfanos aviso' },
    el('strong', {}, 'Motivos sin cambio asociado'),
    el(
      'p',
      {},
      'Estos motivos eran de cambios que ya no existen en su copia (p. ej. los deshizo). No se envían; ' +
        'cópielos si los necesita o descártelos.',
    ),
    listaHuerfanos,
  );
  cajaHuerfanos.hidden = true;
  const elemento = el(
    'section',
    { class: 'mis-cambios', 'aria-label': 'Mis cambios' },
    el('div', { class: 'mis-cambios-cabecera' }, cabecera, total, contador),
    avisoBorrador,
    vacio,
    lista,
    cajaHuerfanos,
  );

  /* ---------- Borrador local ---------- */

  function guardarBorrador(): void {
    if (op.usarBorrador === false) return;
    const datos: Record<string, Huerfano> = {};
    for (const [k, e] of entradas) {
      if (e.estado !== 'guardado' || e.texto !== e.guardado) datos[k] = { texto: e.texto, bloqueId: e.bloqueId, grupo: e.grupo };
    }
    for (const [k, h] of huerfanos) datos[k] = h;
    const ok = escribirJson(op.almacen, claveBorrador, Object.keys(datos).length > 0 ? datos : null);
    avisoBorrador.hidden = ok || Object.keys(datos).length === 0;
    avisoBorrador.textContent = 'No se pudieron guardar los motivos en este navegador: no cierre la página hasta que se guarden.';
  }

  /* ---------- Estado visible ---------- */

  const unidadDe = (clave: string) => actuales.find((u) => u.principal.id === clave);

  function pintar(clave: string): void {
    const v = vistas.get(clave);
    const e = entradas.get(clave);
    if (!v) return;
    const texto = e?.texto ?? '';
    const estado = e?.estado ?? 'guardado';
    const falta = op.motivoObligatorio && texto.trim() === '';
    v.li.classList.toggle('sin-motivo', falta);
    v.falta.hidden = !falta;
    v.li.classList.toggle('motivo-sin-guardar', estado !== 'guardado');
    v.estado.className = `estado-motivo estado-motivo-${estado}`;
    v.estado.textContent =
      estado === 'guardado'
        ? texto.trim() !== ''
          ? 'Motivo guardado'
          : ''
        : estado === 'pendiente' || estado === 'error'
          ? 'Sin guardar'
          : estado === 'esperando'
            ? 'Sin guardar: se guardará junto con la copia…'
            : 'Guardando motivo…';
    v.error.hidden = estado !== 'error';
    v.mensajeError.textContent = e?.error ?? '';
    v.reintentar.disabled = !habilitado;
  }

  function pintarCabecera(): void {
    total.textContent = plural(actuales.length, 'cambio', 'cambios');
    const sin = op.motivoObligatorio
      ? actuales.filter((u) => (entradas.get(u.principal.id)?.texto ?? '').trim() === '').length
      : 0;
    contador.hidden = sin === 0;
    contador.textContent = plural(sin, 'cambio sin motivo', 'cambios sin motivo');
    vacio.hidden = actuales.length > 0;
  }

  function pintarHuerfanos(): void {
    listaHuerfanos.replaceChildren(
      ...[...huerfanos].map(([k, h]) => {
        const area = el('textarea', { readonly: '', rows: '2', 'aria-label': 'Motivo sin cambio asociado' });
        area.value = h.texto;
        return el(
          'li',
          {},
          area,
          boton('Descartar', () => {
            huerfanos.delete(k);
            guardarBorrador();
            pintarHuerfanos();
          }, 'secundario'),
        );
      }),
    );
    cajaHuerfanos.hidden = huerfanos.size === 0;
  }

  /* ---------- Guardado del motivo ---------- */

  async function sincronizar(clave: string): Promise<void> {
    const e = entradas.get(clave);
    const u = unidadDe(clave);
    if (!e || !u || !habilitado) return;
    if (e.estado === 'guardando') {
      e.repetir = true;
      return;
    }
    const ids = u.sugs.map((s) => s.id);
    if (!ids.every((id) => uidsServidor.has(id))) {
      e.estado = 'esperando';
      guardarBorrador();
      pintar(clave);
      op.pedirGuardado();
      return;
    }
    const texto = e.texto;
    e.estado = 'guardando';
    delete e.error;
    pintar(clave);
    try {
      for (const id of ids) {
        await op.api.patch(`/capitulos/${op.capituloId}/sugerencias/${encodeURIComponent(id)}`, { motivo: texto });
      }
      e.guardado = texto;
      e.estado = e.texto === texto ? 'guardado' : 'pendiente';
    } catch (err) {
      if (err instanceof ErrorApi && err.codigo === 'no_encontrado') {
        // La copia cambió entre medio: el motivo viaja con el próximo guardado.
        for (const id of ids) uidsServidor.delete(id);
        e.estado = 'esperando';
        op.pedirGuardado();
      } else if (err instanceof ErrorApi && err.codigo === 'etapa_no_permite') {
        e.estado = 'error';
        e.error = 'La consulta se cerró: el motivo no se guardó. Queda en este navegador; puede copiarlo del campo.';
        op.alEtapaCerrada();
      } else {
        e.estado = 'error';
        e.error = `No se pudo guardar el motivo: ${mensajeDe(err)} Queda en este navegador.`;
      }
    }
    guardarBorrador();
    pintar(clave);
    if (e.repetir) {
      e.repetir = false;
      if (entradas.get(clave) === e && e.texto !== e.guardado) await sincronizar(clave);
    }
  }

  function alSalir(clave: string): void {
    const e = entradas.get(clave);
    if (!e || !habilitado) return;
    if (e.texto === e.guardado && e.estado !== 'esperando') {
      if (e.estado !== 'guardando') e.estado = 'guardado';
      guardarBorrador();
      pintar(clave);
      return;
    }
    void sincronizar(clave);
  }

  /* ---------- Unidades ---------- */

  function crearVista(u: Unidad): VistaUnidad {
    const clave = u.principal.id;
    const tipo = u.sugs.length > 1 ? 'Bloque movido' : NOMBRE_TIPO[u.principal.tipo];
    const ir = el('button', { type: 'button', class: 'ir-cambio', title: 'Ver el cambio en el texto' }, el('span', { class: 'tipo-cambio' }, tipo), resumenUnidad(u));
    ir.addEventListener('click', () => op.resaltar(clave));
    const campo = el('textarea', {
      class: 'motivo-cambio',
      rows: '2',
      maxlength: String(MAX_MOTIVO),
      'aria-label': 'Motivo del cambio',
      placeholder: 'Motivo del cambio (opcional)',
    });
    campo.readOnly = !habilitado;
    campo.addEventListener('input', () => {
      const e = entradas.get(clave) ?? {
        texto: '',
        guardado: '',
        estado: 'guardado' as EstadoMotivo,
        bloqueId: u.principal.bloqueId,
        ...(u.principal.grupo ? { grupo: u.principal.grupo } : {}),
      };
      entradas.set(clave, e);
      e.texto = campo.value;
      if (e.estado === 'guardado' || e.estado === 'error') e.estado = e.texto === e.guardado ? 'guardado' : 'pendiente';
      guardarBorrador();
      pintar(clave);
      pintarCabecera();
    });
    campo.addEventListener('blur', () => alSalir(clave));
    const estado = el('span', { class: 'estado-motivo', 'aria-live': 'polite' });
    const falta = el('span', { class: 'falta-motivo' }, 'Falta el motivo');
    const mensajeError = el('span', {});
    const reintentar = boton('Reintentar', () => void sincronizar(clave), 'secundario');
    const error = el('div', { class: 'error error-motivo', role: 'alert' }, mensajeError, ' ', reintentar);
    error.hidden = true;
    const li = el(
      'li',
      { class: 'cambio-unidad', 'data-miembros': String(u.sugs.length) },
      ir,
      el('label', { class: 'etiqueta-motivo' }, campo),
      el('div', { class: 'linea-estado-motivo' }, falta, estado),
      error,
    );
    return { li, campo, estado, falta, error, mensajeError, reintentar };
  }

  function entradaDeServidor(u: Unidad): Entrada {
    const motivo = u.sugs.map((s) => motivosServidor.get(s.id)).find((m) => m !== undefined) ?? '';
    return {
      texto: motivo,
      guardado: motivo,
      estado: 'guardado',
      bloqueId: u.principal.bloqueId,
      ...(u.principal.grupo ? { grupo: u.principal.grupo } : {}),
    };
  }

  function iniciar(nuevas: Unidad[]): void {
    for (const u of nuevas) {
      const e = entradaDeServidor(u);
      if (e.texto !== '' || u.sugs.some((s) => motivosServidor.has(s.id))) entradas.set(u.principal.id, e);
    }
    const borrador =
      op.usarBorrador === false ? {} : (leerJson<Record<string, Huerfano>>(op.almacen, claveBorrador) ?? {});
    for (const [k, h] of Object.entries(borrador)) {
      if (!h || typeof h.texto !== 'string') continue;
      const u = nuevas.find((x) => x.principal.id === k);
      if (!u) {
        if (h.texto.trim() !== '') huerfanos.set(k, { texto: h.texto, bloqueId: String(h.bloqueId ?? ''), ...(h.grupo ? { grupo: h.grupo } : {}) });
        continue;
      }
      const e = entradas.get(k) ?? entradaDeServidor(u);
      e.texto = h.texto;
      e.estado = e.texto === e.guardado ? 'guardado' : 'pendiente';
      entradas.set(k, e);
    }
  }

  /** Motivos de unidades que desaparecieron: se trasladan a un único candidato o quedan huérfanos. */
  function reubicar(nuevas: Unidad[], previas: Set<string>): void {
    const claves = new Set(nuevas.map((u) => u.principal.id));
    // Una unidad que vuelve (p. ej. tras deshacer) recupera su motivo.
    for (const u of nuevas) {
      const h = huerfanos.get(u.principal.id);
      if (h && !entradas.has(u.principal.id)) {
        // Viaja con el próximo PUT (el cambio que vuelve es una edición: siempre hay uno).
        entradas.set(u.principal.id, { texto: h.texto, guardado: '', estado: 'esperando', bloqueId: h.bloqueId, ...(h.grupo ? { grupo: h.grupo } : {}) });
        huerfanos.delete(u.principal.id);
      }
    }
    const perdidas = [...entradas].filter(([k]) => !claves.has(k));
    if (perdidas.length === 0) return;
    const recientes = nuevas.filter((u) => !previas.has(u.principal.id) && !entradas.has(u.principal.id));
    const mismoSitio = (bloqueId: string, grupo: string | undefined) => (x: { bloqueId: string; grupo?: string }) =>
      x.bloqueId === bloqueId && x.grupo === grupo;
    for (const [k, e] of perdidas) {
      entradas.delete(k);
      if (e.texto.trim() === '') continue;
      const rivales = perdidas.filter(([, o]) => o.texto.trim() !== '' && mismoSitio(e.bloqueId, e.grupo)(o));
      const candidatos = recientes.filter(
        (u) => !entradas.has(u.principal.id) && mismoSitio(e.bloqueId, e.grupo)({ bloqueId: u.principal.bloqueId, grupo: u.principal.grupo }),
      );
      if (rivales.length === 1 && candidatos.length === 1) {
        // El cambio nuevo aún no está en el servidor: el motivo viajará con la copia.
        entradas.set(candidatos[0].principal.id, { ...e, guardado: '', estado: 'esperando' });
      } else {
        huerfanos.set(k, { texto: e.texto, bloqueId: e.bloqueId, ...(e.grupo ? { grupo: e.grupo } : {}) });
      }
    }
  }

  function actualizar(sugerencias: Sugerencia[]): void {
    const nuevas = unidades(sugerencias);
    const previas = new Set(actuales.map((u) => u.principal.id));
    if (!iniciado) {
      iniciar(nuevas);
      iniciado = true;
    } else {
      reubicar(nuevas, previas);
    }
    actuales = nuevas;
    claveDeUid = new Map(nuevas.flatMap((u) => u.sugs.map((s) => [s.id, u.principal.id] as [string, string])));
    const deseadas: HTMLLIElement[] = [];
    for (const u of nuevas) {
      const k = u.principal.id;
      let v = vistas.get(k);
      if (!v) {
        v = crearVista(u);
        vistas.set(k, v);
      }
      const e = entradas.get(k);
      if (v.campo.value !== (e?.texto ?? '') && document.activeElement !== v.campo) v.campo.value = e?.texto ?? '';
      deseadas.push(v.li);
      pintar(k);
    }
    for (const k of [...vistas.keys()]) if (!nuevas.some((u) => u.principal.id === k)) vistas.delete(k);
    const hijos = [...lista.children];
    if (hijos.length !== deseadas.length || hijos.some((h, i) => h !== deseadas[i])) lista.replaceChildren(...deseadas);
    pintarCabecera();
    pintarHuerfanos();
    guardarBorrador();
  }

  return {
    elemento,
    actualizar,
    habilitar(si) {
      habilitado = si;
      for (const [k, v] of vistas) {
        v.campo.readOnly = !si;
        pintar(k);
      }
      if (si && !sincronizadoInicial) {
        // Motivos recuperados del borrador local: se intentan guardar una vez.
        sincronizadoInicial = true;
        for (const [k, e] of entradas) if (e.estado === 'pendiente') void sincronizar(k);
      }
    },
    motivoDe(s) {
      const k = claveDeUid.get(s.id);
      const texto = k ? entradas.get(k)?.texto : undefined;
      return texto && texto.trim() !== '' ? texto : undefined;
    },
    alConfirmarCopia(enviadas) {
      const previos = uidsServidor;
      uidsServidor = new Set(enviadas.map((s) => s.id));
      const porId = new Map(enviadas.map((s) => [s.id, s]));
      for (const [k, e] of entradas) {
        const u = unidadDe(k);
        if (!u) continue;
        const ids = u.sugs.map((s) => s.id);
        if (!ids.every((id) => porId.has(id))) continue;
        const nuevos = ids.every((id) => !previos.has(id));
        const llevados = new Set(ids.map((id) => porId.get(id)!.motivo ?? ''));
        if (nuevos && llevados.size === 1) {
          // Sugerencias nuevas: el servidor tomó el motivo del cuerpo del PUT.
          e.guardado = [...llevados][0];
          if ((e.estado === 'esperando' || e.estado === 'pendiente') && e.texto === e.guardado) e.estado = 'guardado';
        }
        if (e.estado === 'esperando') void sincronizar(k);
        pintar(k);
      }
      guardarBorrador();
    },
    sinGuardar: () => huerfanos.size > 0 || [...entradas.values()].some((e) => e.estado !== 'guardado' || e.texto !== e.guardado),
  };
}

/* ---------- Borradores sin enviar tras el cierre ---------- */

/**
 * Caja de solo lectura con los motivos y comentarios del borrador local que no alcanzaron
 * a enviarse (fuera de `consulta` ya no se pueden enviar), con "Copiar texto" y "Descartar".
 * null si no hay nada.
 */
export function cajaBorradoresSinEnviar(
  almacen: Storage | undefined,
  usuarioId: number,
  capituloId: number,
  versionId: number,
): HTMLElement | null {
  const claveM = claveMotivos(usuarioId, capituloId, versionId);
  const claveC = claveComentarios(usuarioId, capituloId);
  const motivos = leerJson<Record<string, Partial<Huerfano>>>(almacen, claveM) ?? {};
  const coment = leerJson<{ nuevo?: { cita?: unknown; texto?: unknown }; ediciones?: Record<string, unknown> }>(almacen, claveC) ?? {};
  const partes: string[] = [];
  for (const m of Object.values(motivos)) {
    if (m && typeof m.texto === 'string' && m.texto.trim() !== '') {
      partes.push(`Motivo de un cambio${typeof m.bloqueId === 'string' && m.bloqueId ? ` (bloque ${m.bloqueId})` : ''}: ${m.texto}`);
    }
  }
  if (coment.nuevo && typeof coment.nuevo.texto === 'string' && coment.nuevo.texto.trim() !== '') {
    const cita = typeof coment.nuevo.cita === 'string' && coment.nuevo.cita ? ` sobre «${coment.nuevo.cita}»` : '';
    partes.push(`Comentario nuevo${cita}: ${coment.nuevo.texto}`);
  }
  for (const [id, texto] of Object.entries(coment.ediciones ?? {})) {
    if (typeof texto === 'string' && texto.trim() !== '') partes.push(`Edición del comentario n.º ${id}: ${texto}`);
  }
  if (partes.length === 0) return null;
  const area = el('textarea', { class: 'borrador-texto', readonly: '', rows: '6', 'aria-label': 'Motivos y comentarios sin enviar' });
  area.value = partes.join('\n\n');
  const caja = el(
    'div',
    { class: 'aviso borradores-sin-enviar' },
    el(
      'p',
      {},
      'Estos motivos y comentarios quedaron en este navegador sin alcanzar a enviarse, y fuera de la etapa de consulta ya no se pueden enviar. Puede copiarlos aquí:',
    ),
    el(
      'div',
      { class: 'copiar-borrador' },
      area,
      el(
        'div',
        { class: 'botones' },
        boton('Copiar texto', () => {
          area.select();
          void navigator.clipboard?.writeText(area.value).catch(() => {});
        }),
        boton('Descartar', () => {
          escribirJson(almacen, claveM, null);
          escribirJson(almacen, claveC, null);
          caja.hidden = true;
        }, 'secundario'),
      ),
    ),
  );
  return caja;
}

/* ---------- Mis aportes (edicion_final) ---------- */

const NOMBRE_ESTADO: Record<string, string> = {
  pendiente: 'Pendiente',
  aceptada: 'Aceptado',
  rechazada: 'Rechazado',
  modificada: 'Modificado',
};

export function estadoAporte(s: SugerenciaServidor): string {
  const estado = NOMBRE_ESTADO[s.estado ?? 'pendiente'] ?? 'Pendiente';
  if (!s.derivadaReunion) return estado;
  return s.estado && s.estado !== 'pendiente' ? `${estado} · derivado a reunión` : 'Derivado a reunión';
}

const estadoComentario = (c: Comentario) => (c.estado === 'resuelto' ? 'Resuelto' : 'Pendiente');

export interface MisAportes {
  elemento: HTMLElement;
  cargar(): Promise<void>;
}

export function crearMisAportes(api: Api, capituloId: number): MisAportes {
  const contenido = el('div', { class: 'contenido-aportes' }, el('p', { class: 'vacio' }, 'Cargando sus aportes…'));
  const mensajeError = el('span', {});
  const error = el('div', { class: 'error', role: 'alert' }, mensajeError, ' ', boton('Reintentar', () => void cargar(), 'secundario'));
  error.hidden = true;
  const elemento = el(
    'section',
    { class: 'mis-aportes', 'aria-label': 'Mis aportes' },
    el('h2', {}, 'Mis aportes'),
    el('p', { class: 'nota' }, 'La consulta cerró. Este es el estado de cada cambio y comentario que envió.'),
    error,
    contenido,
  );

  const nota = (n: string | null | undefined) =>
    n ? el('p', { class: 'nota-resolucion' }, el('strong', {}, 'Nota de la revisión: '), n) : null;

  function pintar(a: Aportes): void {
    const items: HTMLElement[] = [];
    for (const u of unidades(a.sugerencias)) {
      const s = u.principal as SugerenciaServidor;
      const motivo = u.sugs.map((x) => (x as SugerenciaServidor).motivo).find(Boolean);
      items.push(
        el(
          'li',
          { class: 'aporte aporte-cambio' },
          el('span', { class: `estado-aporte estado-${s.estado ?? 'pendiente'}` }, estadoAporte(s)),
          resumenUnidad(u),
          motivo ? el('p', { class: 'motivo-leido' }, `Motivo: ${motivo}`) : null,
          nota(s.notaResolucion),
        ),
      );
    }
    for (const c of a.comentarios) {
      items.push(
        el(
          'li',
          { class: 'aporte aporte-comentario' },
          el('span', { class: `estado-aporte estado-${c.estado}` }, estadoComentario(c)),
          el('p', { class: 'texto-comentario' }, `Comentario: ${c.texto}`),
          nota(c.notaResolucion),
        ),
      );
    }
    contenido.replaceChildren(
      items.length > 0 ? el('ul', { class: 'lista-aportes' }, ...items) : el('p', { class: 'vacio' }, 'Este capítulo no tiene aportes suyos.'),
    );
  }

  async function cargar(): Promise<void> {
    try {
      const a = await api.get<Aportes>(`/capitulos/${capituloId}/mis-aportes`);
      error.hidden = true;
      pintar({ sugerencias: a?.sugerencias ?? [], comentarios: a?.comentarios ?? [] });
    } catch (e) {
      mensajeError.textContent = `No se pudieron cargar sus aportes: ${mensajeDe(e)}`;
      error.hidden = false;
    }
  }

  return { elemento, cargar };
}
