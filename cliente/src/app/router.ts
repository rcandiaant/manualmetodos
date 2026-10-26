/**
 * Router por hash (`#/capitulos`, `#/capitulos/:id`, …).
 *
 * Antes de cambiar de vista llama `desmontar` de la actual y espera a que termine
 * (p. ej. el último envío del autoguardado). Las navegaciones se encadenan: nunca
 * hay dos transiciones a la vez. Una ruta desconocida va a `#/capitulos`. Si la vista
 * falla al crearse o montarse, se muestra un aviso `role="alert"` y el router sigue vivo.
 */

export interface Vista {
  montar(raiz: HTMLElement): void;
  desmontar(): void | Promise<void>;
}

export type Parametros = Record<string, string>;
/**
 * `consulta`: parámetros tras `?` en el hash (`#/revisar/3?lab=12`), vacía si no hay.
 * Las fábricas que no la usan pueden ignorar el segundo argumento.
 */
export type FabricaVista = (params: Parametros, consulta: URLSearchParams) => Vista;

export interface Router {
  /** Va a `hash` (cambia `location.hash`); resuelve cuando la vista nueva quedó montada. */
  navegar(hash: string): Promise<void>;
  /** Promesa de la última transición encolada. */
  readonly listo: Promise<void>;
  /** Quita el listener de `hashchange` (pruebas). No desmonta la vista. */
  detener(): void;
}

export const RUTA_INICIO = '#/capitulos';

interface Patron {
  partes: string[];
  fabrica: FabricaVista;
}

const partesDe = (hash: string): string[] =>
  hash.replace(/^#?\/?/, '').split('?')[0].split('/').filter((p) => p !== '');

function casar(patrones: Patron[], hash: string): { fabrica: FabricaVista; params: Parametros } | null {
  const partes = partesDe(hash);
  for (const p of patrones) {
    if (p.partes.length !== partes.length) continue;
    const params: Parametros = {};
    let ok = true;
    for (let i = 0; i < partes.length && ok; i++) {
      const esperado = p.partes[i];
      if (esperado.startsWith(':')) {
        try {
          params[esperado.slice(1)] = decodeURIComponent(partes[i]);
        } catch {
          ok = false;
        }
      } else ok = esperado === partes[i];
    }
    if (ok) return { fabrica: p.fabrica, params };
  }
  return null;
}

/** Texto tras el primer `?` del hash ('' si no hay). */
const consultaDe = (hash: string): string => {
  const i = hash.indexOf('?');
  return i < 0 ? '' : hash.slice(i + 1);
};

/** Normaliza a `#/a/b`, conservando la consulta (`#/a/b?x=1`) si la hay. */
const normalizar = (hash: string): string => {
  const q = consultaDe(hash);
  return `#/${partesDe(hash).join('/')}${q ? `?${q}` : ''}`;
};

let routerActual: Router | null = null;

/** Caja de error visible (solo `textContent`, nunca HTML). */
function avisoError(e: unknown): HTMLElement {
  const caja = document.createElement('div');
  caja.className = 'error';
  caja.setAttribute('role', 'alert');
  const detalle = e instanceof Error ? e.message : String(e);
  caja.textContent = `No se pudo abrir esta página: ${detalle}`;
  return caja;
}

export function definirRutas(
  tabla: Record<string, FabricaVista>,
  raiz: HTMLElement = document.getElementById('app') ?? document.body,
): Router {
  routerActual?.detener();
  const patrones: Patron[] = Object.entries(tabla).map(([ruta, fabrica]) => ({ partes: partesDe(ruta), fabrica }));
  let actual: Vista | null = null;
  let hashActual: string | null = null;
  let cadena: Promise<void> = Promise.resolve();

  async function transicion(hashPedido: string): Promise<void> {
    let hash = normalizar(hashPedido);
    let destino = casar(patrones, hash);
    if (!destino) {
      hash = RUTA_INICIO;
      destino = casar(patrones, hash);
      if (location.hash !== hash) history.replaceState(null, '', hash);
      if (!destino) return;
    }
    if (actual && hash === hashActual) return;
    if (actual) {
      const saliente = actual;
      actual = null;
      hashActual = null;
      try {
        await saliente.desmontar();
      } catch (e) {
        console.error('Error al desmontar la vista', e);
      }
    }
    raiz.replaceChildren();
    let vista: Vista | null = null;
    try {
      vista = destino.fabrica(destino.params, new URLSearchParams(consultaDe(hash)));
      vista.montar(raiz);
      actual = vista;
      hashActual = hash;
    } catch (e) {
      console.error('Error al montar la vista', e);
      // Sin vista vigente: navegar de nuevo (incluso al mismo hash) vuelve a intentarlo.
      actual = null;
      hashActual = null;
      if (vista) {
        try {
          await vista.desmontar();
        } catch (e2) {
          console.error('Error al desmontar la vista fallida', e2);
        }
      }
      raiz.replaceChildren(avisoError(e));
    }
  }

  function encolar(hash: string): Promise<void> {
    cadena = cadena.then(() => transicion(hash)).catch((e) => console.error('Error al cambiar de vista', e));
    return cadena;
  }

  const alCambiarHash = () => void encolar(location.hash);
  window.addEventListener('hashchange', alCambiarHash);

  const router: Router = {
    navegar(hash) {
      const destino = normalizar(hash);
      if (location.hash !== destino) location.hash = destino;
      return encolar(destino);
    },
    get listo() {
      return cadena;
    },
    detener() {
      window.removeEventListener('hashchange', alCambiarHash);
      if (routerActual === router) routerActual = null;
    },
  };
  routerActual = router;
  encolar(location.hash);
  return router;
}

/** Navega con el router definido por `definirRutas`. */
export function navegar(hash: string): Promise<void> {
  if (!routerActual) throw new Error('No hay rutas definidas.');
  return routerActual.navegar(hash);
}
