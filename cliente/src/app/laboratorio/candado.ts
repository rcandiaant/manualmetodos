/**
 * Candado de escritura por usuario y capítulo (revisión final I1, regla R5): una sola
 * pestaña o ventana del navegador edita un capítulo; las demás lo muestran en solo lectura.
 *
 * - Con `navigator.locks`: se pide con `ifAvailable`. Si otra pestaña lo tiene, esta queda
 *   sin control y en espera: lo recibe sola cuando la otra lo suelta (se cierra o sale del
 *   capítulo). `tomar()` lo roba (`steal`) y la otra pestaña pasa a solo lectura.
 * - Sin `navigator.locks`: una entrada en localStorage con latido (`{pestana, latido}`).
 *   Un latido de más de 3 periodos se da por abandonado. Robarlo es escribir la entrada;
 *   la otra pestaña lo nota en su siguiente latido o por el evento `storage`.
 * - Sin ninguno de los dos: siempre hay control (queda la defensa del autoguardado, que
 *   compara `actualizado` antes de enviar).
 */

export interface Candado {
  /** ¿Esta pestaña es la que escribe? */
  propio(): boolean;
  /** Avisa cada vez que se gana o se pierde el control. */
  alCambiar(fn: (propio: boolean) => void): void;
  /** Toma el control aunque lo tenga otra pestaña (que queda en solo lectura). */
  tomar(): void;
  /** Suelta el control y deja de esperar. */
  liberar(): void;
}

export interface DepsCandado {
  /** `navigator.locks` por defecto; `null` fuerza el respaldo con localStorage. */
  locks?: LockManager | null;
  almacen?: Storage;
  /** Periodo del latido del respaldo con localStorage (2 s). */
  latidoMs?: number;
}

export const claveCandado = (usuarioId: number | string, capituloId: number | string) =>
  `mm:candado:${usuarioId}:${capituloId}`;

function avisador() {
  const oyentes: ((p: boolean) => void)[] = [];
  return {
    agregar: (fn: (p: boolean) => void) => void oyentes.push(fn),
    avisar(p: boolean) {
      for (const fn of oyentes) {
        try {
          fn(p);
        } catch (e) {
          console.error('Error en un oyente del candado', e);
        }
      }
    },
  };
}

function conLocks(locks: LockManager, nombre: string): Promise<Candado> {
  let propio = false;
  let cerrado = false;
  let soltar: (() => void) | null = null;
  let espera: AbortController | null = null;
  const oyentes = avisador();
  const fijar = (p: boolean) => {
    if (p === propio) return;
    propio = p;
    oyentes.avisar(p);
  };

  /** Pide el candado; resuelve true si quedó concedido. */
  function pedir(opciones: LockOptions): Promise<boolean> {
    return new Promise<boolean>((resolver) => {
      let concedido = false;
      locks
        .request(nombre, opciones, (lock) => {
          if (!lock || cerrado) {
            resolver(false);
            return undefined; // sin candado, o ya no se quiere: se suelta en el acto
          }
          concedido = true;
          return new Promise<void>((soltarlo) => {
            soltar = soltarlo;
            fijar(true);
            resolver(true);
          });
        })
        .catch(() => {
          // AbortError: se canceló la espera (sin conceder) u otra pestaña lo robó.
          if (!concedido) {
            resolver(false);
            return;
          }
          soltar = null;
          if (cerrado) return;
          fijar(false);
          esperar();
        });
    });
  }

  /** Espera en la cola: el candado llega solo cuando la otra pestaña lo suelta. */
  function esperar(): void {
    if (cerrado) return;
    espera?.abort();
    const ctrl = new AbortController();
    espera = ctrl;
    void pedir({ signal: ctrl.signal }).then(() => {
      if (espera === ctrl) espera = null;
    });
  }

  const candado: Candado = {
    propio: () => propio,
    alCambiar: oyentes.agregar,
    tomar() {
      if (cerrado || propio) return;
      espera?.abort();
      espera = null;
      void pedir({ steal: true });
    },
    liberar() {
      cerrado = true;
      espera?.abort();
      espera = null;
      const s = soltar;
      soltar = null;
      propio = false;
      s?.();
    },
  };
  return pedir({ ifAvailable: true }).then((ok) => {
    if (!ok) esperar();
    return candado;
  });
}

interface Entrada {
  pestana: string;
  latido: number;
}

function conAlmacen(almacen: Storage, nombre: string, latidoMs: number): Candado {
  const yo = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const caducaMs = latidoMs * 3;
  let propio = false;
  let cerrado = false;
  const oyentes = avisador();
  const fijar = (p: boolean) => {
    if (p === propio) return;
    propio = p;
    oyentes.avisar(p);
  };

  const leer = (): Entrada | null => {
    try {
      const v = JSON.parse(almacen.getItem(nombre) ?? 'null') as Partial<Entrada> | null;
      return v && typeof v.pestana === 'string' && typeof v.latido === 'number' ? (v as Entrada) : null;
    } catch {
      return null;
    }
  };
  const escribir = () => {
    try {
      almacen.setItem(nombre, JSON.stringify({ pestana: yo, latido: Date.now() } satisfies Entrada));
    } catch {
      // sin almacenamiento: no se puede coordinar
    }
  };
  const libre = () => {
    const v = leer();
    return !v || v.pestana === yo || Date.now() - v.latido > caducaMs;
  };

  function revisar(): void {
    if (cerrado) return;
    if (propio) {
      const v = leer();
      if (v && v.pestana !== yo) fijar(false); // otra pestaña lo tomó
      else escribir();
    } else if (libre()) {
      escribir();
      fijar(true);
    }
  }

  if (libre()) {
    escribir();
    propio = true;
  }
  const intervalo = setInterval(revisar, latidoMs);
  const alAlmacen = (ev: StorageEvent) => {
    if (ev.key === nombre || ev.key === null) revisar();
  };
  const alOcultar = () => soltarEntrada();
  window.addEventListener('storage', alAlmacen);
  window.addEventListener('pagehide', alOcultar);

  function soltarEntrada(): void {
    if (leer()?.pestana !== yo) return;
    try {
      almacen.removeItem(nombre);
    } catch {
      // sin almacenamiento
    }
  }

  return {
    propio: () => propio,
    alCambiar: oyentes.agregar,
    tomar() {
      if (cerrado || propio) return;
      escribir();
      fijar(true);
    },
    liberar() {
      if (cerrado) return;
      cerrado = true;
      clearInterval(intervalo);
      window.removeEventListener('storage', alAlmacen);
      window.removeEventListener('pagehide', alOcultar);
      soltarEntrada();
      propio = false;
    },
  };
}

function siempreLibre(): Candado {
  return { propio: () => true, alCambiar() {}, tomar() {}, liberar() {} };
}

export function abrirCandado(nombre: string, deps: DepsCandado = {}): Promise<Candado> {
  const locks =
    deps.locks !== undefined ? deps.locks : typeof navigator !== 'undefined' ? (navigator.locks ?? null) : null;
  if (locks) return conLocks(locks, nombre);
  if (deps.almacen) return Promise.resolve(conAlmacen(deps.almacen, nombre, deps.latidoMs ?? 2000));
  return Promise.resolve(siempreLibre());
}
