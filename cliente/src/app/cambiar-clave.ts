/**
 * Cambio de clave (`#/clave`, docs/api.md §2).
 *
 * - Con clave provisoria (`debeCambiarClave`) es obligatoria: el resto de la plataforma redirige
 *   aquí y el servidor rechaza todo lo demás con 403 `cambio_clave_requerido`. Solo se puede
 *   cambiar la clave o salir.
 * - Con clave propia es opcional: se llega desde «Cambiar mi clave» y se puede volver al inicio.
 * - Las validaciones del cliente repiten las del servidor (mínimo 10 caracteres, distinta de la
 *   actual, sin espacios al borde) para avisar antes de enviar; el servidor manda igual.
 */
import { boton, el } from '../editor/ui';
import { ErrorApi, SIN_CONEXION, type Api } from './api';
import { RUTA_INICIO, type Vista } from './router';
import { cambiarClave, debeCambiarClave, tomarRutaPendiente, usuarioActual } from './sesion';

export const LARGO_MIN_CLAVE = 10;

/** Problema de la clave nueva antes de enviarla, o `null` si está bien. */
export function problemaClaveNueva(actual: string, nueva: string, repetida: string): string | null {
  if ([...nueva].length < LARGO_MIN_CLAVE) return `La clave nueva debe tener al menos ${LARGO_MIN_CLAVE} caracteres.`;
  if (nueva.trim() !== nueva) return 'La clave nueva no puede empezar ni terminar con espacios.';
  if (nueva === actual) return 'La clave nueva debe ser distinta de la actual.';
  if (nueva !== repetida) return 'Las dos claves nuevas no coinciden.';
  return null;
}

export function mensajeCambioClave(e: unknown): string {
  if (e instanceof ErrorApi) {
    if (e.codigo === SIN_CONEXION) return 'No hay conexión con el servidor. Revise su conexión a Internet e intente de nuevo.';
    if (e.codigo === 'clave_actual_incorrecta') return 'La clave actual no es correcta.';
    if (e.estado === 429) return 'Demasiados intentos. Espere unos minutos antes de volver a intentar.';
    if (e.estado === 400 && e.campos?.nueva) return `Clave nueva: ${e.campos.nueva}`;
  }
  return 'No se pudo cambiar la clave. Intente de nuevo en un momento.';
}

export interface DepsCambiarClave {
  navegar: (hash: string) => unknown;
  salir: () => Promise<void>;
}

export function vistaCambiarClave(api: Api, deps: DepsCambiarClave): Vista {
  let enviando = false;
  let vigente = true;
  return {
    montar(raiz) {
      const u = usuarioActual();
      if (!u) return; // main.ts solo monta esta vista con sesión
      const obligatoria = debeCambiarClave(u);

      const caja = el('div', { class: 'error', role: 'alert', hidden: '' });
      const actual = el('input', { type: 'password', name: 'actual', id: 'campo-clave-actual', autocomplete: 'current-password', required: '' });
      const nueva = el('input', { type: 'password', name: 'nueva', id: 'campo-clave-nueva', autocomplete: 'new-password', required: '', minlength: String(LARGO_MIN_CLAVE) });
      const repetida = el('input', { type: 'password', name: 'repetida', id: 'campo-clave-repetida', autocomplete: 'new-password', required: '', minlength: String(LARGO_MIN_CLAVE) });
      const enviar = el('button', { type: 'submit', class: 'primario' }, 'Guardar clave');
      const mostrarError = (texto: string) => {
        caja.textContent = texto;
        caja.hidden = false;
      };

      const form = el(
        'form',
        { class: 'login', novalidate: '' },
        el('label', { for: 'campo-clave-actual' }, obligatoria ? 'Clave provisoria' : 'Clave actual'),
        actual,
        el('label', { for: 'campo-clave-nueva' }, 'Clave nueva'),
        nueva,
        el('label', { for: 'campo-clave-repetida' }, 'Repita la clave nueva'),
        repetida,
        el('p', { class: 'ayuda' }, `Al menos ${LARGO_MIN_CLAVE} caracteres. Puede usar una frase, por ejemplo «suelo arcilloso 2026».`),
        caja,
        enviar,
      );
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (enviando) return;
        caja.hidden = true;
        const problema = problemaClaveNueva(actual.value, nueva.value, repetida.value);
        if (problema) return mostrarError(problema);
        enviando = true;
        enviar.disabled = true;
        void cambiarClave(api, actual.value, nueva.value)
          .then((n) => {
            if (vigente) void deps.navegar(tomarRutaPendiente(n.id) ?? RUTA_INICIO);
          })
          .catch((e: unknown) => {
            if (!vigente) return;
            actual.value = '';
            mostrarError(mensajeCambioClave(e));
          })
          .finally(() => {
            enviando = false;
            enviar.disabled = false;
          });
      });

      const pie = obligatoria
        ? boton('Salir', () => void deps.salir().catch((e: unknown) => mostrarError(mensajeCambioClave(e))), 'secundario')
        : el('a', { href: RUTA_INICIO, class: 'enlace-boton' }, 'Volver sin cambiar');

      raiz.append(
        el(
          'main',
          { class: 'app app-login' },
          el('h1', {}, obligatoria ? 'Defina su clave' : 'Cambiar mi clave'),
          el(
            'p',
            { class: 'subtitulo' },
            obligatoria
              ? `Hola, ${u.nombre}. Ingresó con una clave provisoria: para continuar, elija una clave propia. La provisoria dejará de funcionar.`
              : `${u.nombre} · ${u.laboratorio}`,
          ),
          form,
          el('p', {}, pie),
        ),
      );
      actual.focus();
    },
    desmontar() {
      vigente = false;
    },
  };
}
