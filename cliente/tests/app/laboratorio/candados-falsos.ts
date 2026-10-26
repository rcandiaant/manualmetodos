/**
 * `LockManager` en memoria para simular varias pestañas en una sola prueba
 * (`ifAvailable`, `steal` y `signal`, como `navigator.locks`).
 */
type Cb = (lock: Lock | null) => unknown;

interface Pedido {
  nombre: string;
  cb: Cb;
  resolver: (v: unknown) => void;
  rechazar: (e: unknown) => void;
}

export function crearLocksFalsos(): LockManager {
  const dueños = new Map<string, Pedido>();
  const colas = new Map<string, Pedido[]>();
  const abortar = () => new DOMException('Se abortó el candado.', 'AbortError');

  function conceder(p: Pedido): void {
    dueños.set(p.nombre, p);
    let res: unknown;
    try {
      res = p.cb({ name: p.nombre, mode: 'exclusive' } as Lock);
    } catch (e) {
      soltar(p);
      p.rechazar(e);
      return;
    }
    Promise.resolve(res).then(
      (v) => {
        if (dueños.get(p.nombre) !== p) return; // se lo robaron: ya se rechazó
        soltar(p);
        p.resolver(v);
      },
      (e) => {
        if (dueños.get(p.nombre) !== p) return;
        soltar(p);
        p.rechazar(e);
      },
    );
  }

  function soltar(p: Pedido): void {
    if (dueños.get(p.nombre) === p) dueños.delete(p.nombre);
    const cola = colas.get(p.nombre) ?? [];
    const siguiente = cola.shift();
    if (siguiente && !dueños.has(p.nombre)) conceder(siguiente);
  }

  return {
    request(nombre: string, a: LockOptions | Cb, b?: Cb) {
      const opciones: LockOptions = typeof a === 'function' ? {} : a;
      const cb = (typeof a === 'function' ? a : b) as Cb;
      return new Promise<unknown>((resolver, rechazar) => {
        const p: Pedido = { nombre, cb, resolver, rechazar };
        const dueño = dueños.get(nombre);
        if (opciones.steal) {
          if (dueño) {
            dueños.delete(nombre);
            dueño.rechazar(abortar());
          }
          conceder(p);
          return;
        }
        if (opciones.ifAvailable && (dueño || (colas.get(nombre)?.length ?? 0) > 0)) {
          Promise.resolve(cb(null)).then(resolver, rechazar);
          return;
        }
        if (!dueño) {
          conceder(p);
          return;
        }
        const cola = colas.get(nombre) ?? [];
        cola.push(p);
        colas.set(nombre, cola);
        opciones.signal?.addEventListener('abort', () => {
          const i = cola.indexOf(p);
          if (i >= 0) {
            cola.splice(i, 1);
            rechazar(abortar());
          }
        });
      });
    },
    query: async () => ({ held: [], pending: [] }),
  } as unknown as LockManager;
}
