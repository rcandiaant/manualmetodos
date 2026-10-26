import { afterEach, describe, expect, it, vi } from 'vitest';
import { definirRutas, type Router, type Vista } from '../../src/app/router';

/** Router por hash: monta la vista de la ruta y espera `desmontar` antes de cambiar. */

let router: Router | null = null;
afterEach(() => {
  router?.detener();
  router = null;
  history.replaceState(null, '', '#');
});

function diferido() {
  let resolver!: () => void;
  const promesa = new Promise<void>((r) => (resolver = r));
  return { promesa, resolver };
}

describe('router', () => {
  it('router monta la vista de la ruta y espera desmontar antes de cambiar', async () => {
    const eventos: string[] = [];
    const fin = diferido();
    const raiz = document.createElement('div');

    const vistaCapitulos = (): Vista => ({
      montar(r) {
        eventos.push('montar capitulos');
        r.textContent = 'capitulos';
      },
      desmontar() {
        eventos.push('desmontar capitulos');
        return fin.promesa;
      },
    });
    const vistaCapitulo = (params: Record<string, string>): Vista => ({
      montar(r) {
        eventos.push(`montar capitulo ${params.id}`);
        r.textContent = `capitulo ${params.id}`;
      },
      desmontar() {},
    });

    router = definirRutas({ '#/capitulos': vistaCapitulos, '#/capitulos/:id': vistaCapitulo }, raiz);
    await router.navegar('#/capitulos');
    expect(raiz.textContent).toBe('capitulos');
    expect(eventos).toEqual(['montar capitulos']);

    const cambio = router.navegar('#/capitulos/3');
    await Promise.resolve();
    await Promise.resolve();
    // desmontar sigue pendiente: la vista nueva aún no se monta.
    expect(eventos).toEqual(['montar capitulos', 'desmontar capitulos']);
    expect(raiz.textContent).toBe('capitulos');

    fin.resolver();
    await cambio;
    expect(eventos).toEqual(['montar capitulos', 'desmontar capitulos', 'montar capitulo 3']);
    expect(raiz.textContent).toBe('capitulo 3');
    expect(location.hash).toBe('#/capitulos/3');
  });

  it('ruta desconocida va a #/capitulos', async () => {
    const raiz = document.createElement('div');
    const montadas: string[] = [];
    const vista = (nombre: string) => (): Vista => ({
      montar: () => void montadas.push(nombre),
      desmontar() {},
    });

    router = definirRutas({ '#/capitulos': vista('capitulos'), '#/admin/usuarios': vista('usuarios') }, raiz);
    await router.navegar('#/no-existe/7');
    expect(location.hash).toBe('#/capitulos');
    expect(montadas).toEqual(['capitulos']);

    await router.navegar('#/admin/usuarios');
    expect(montadas).toEqual(['capitulos', 'usuarios']);
  });

  it('arranca con el hash actual y sigue los hashchange', async () => {
    history.replaceState(null, '', '#/admin/usuarios');
    const raiz = document.createElement('div');
    const montadas: string[] = [];
    const vista = (nombre: string) => (p: Record<string, string>): Vista => ({
      montar: () => void montadas.push(p.id ? `${nombre} ${p.id}` : nombre),
      desmontar() {},
    });

    router = definirRutas(
      { '#/capitulos': vista('capitulos'), '#/capitulos/:id': vista('capitulo'), '#/admin/usuarios': vista('usuarios') },
      raiz,
    );
    await router.listo;
    expect(montadas).toEqual(['usuarios']);

    location.hash = '#/capitulos/12';
    await vi.waitFor(() => expect(montadas).toEqual(['usuarios', 'capitulo 12']));
  });

  it('si montar lanza, muestra un aviso role=alert y la navegacion sigue funcionando', async () => {
    const raiz = document.createElement('div');
    let falla = true;
    const desmontadas: string[] = [];
    const vistaRota = (): Vista => ({
      montar(r) {
        r.append(document.createElement('span'));
        if (falla) throw new Error('<b>roto</b>');
        r.textContent = 'capitulo';
      },
      desmontar: () => void desmontadas.push('rota'),
    });
    const vistaOk = (): Vista => ({
      montar(r) {
        r.textContent = 'capitulos';
      },
      desmontar() {},
    });
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {});

    router = definirRutas({ '#/capitulos': vistaOk, '#/capitulos/:id': vistaRota }, raiz);
    await router.navegar('#/capitulos/3');
    const aviso = raiz.querySelector('[role="alert"]');
    expect(aviso).not.toBeNull();
    expect(aviso!.textContent).toContain('<b>roto</b>');
    expect(raiz.querySelector('b')).toBeNull();
    expect(desmontadas).toEqual(['rota']);

    // Reintentar el mismo hash vuelve a montar (no queda fijada la vista rota).
    falla = false;
    await router.navegar('#/capitulos/3');
    expect(raiz.textContent).toBe('capitulo');

    await router.navegar('#/capitulos');
    expect(raiz.textContent).toBe('capitulos');
    consola.mockRestore();
  });

  it('si la fabrica lanza, tambien muestra el aviso', async () => {
    const raiz = document.createElement('div');
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {});
    router = definirRutas(
      {
        '#/capitulos': () => ({ montar: (r) => void (r.textContent = 'capitulos'), desmontar() {} }),
        '#/admin/usuarios': () => {
          throw new Error('fabrica rota');
        },
      },
      raiz,
    );
    await router.navegar('#/admin/usuarios');
    expect(raiz.querySelector('[role="alert"]')?.textContent).toContain('fabrica rota');
    await router.navegar('#/capitulos');
    expect(raiz.textContent).toBe('capitulos');
    consola.mockRestore();
  });
  it('la consulta del hash llega a la vista y se conserva en la url', async () => {
    const raiz = document.createElement('div');
    const vistos: string[] = [];
    const vista = (p: Record<string, string>, q?: URLSearchParams): Vista => ({
      montar: () => void vistos.push(`${p.id} ${q?.toString() ?? '-'}`),
      desmontar() {},
    });
    router = definirRutas({ '#/capitulos': vista, '#/revisar/:id': vista }, raiz);
    await router.listo; // el arranque con '#' redirige a #/capitulos antes de navegar
    await router.navegar('#/revisar/3?lab=12&solo=conflictos');
    expect(location.hash).toBe('#/revisar/3?lab=12&solo=conflictos');
    expect(vistos.at(-1)).toBe('3 lab=12&solo=conflictos');
    // Sin consulta, la vista recibe una vacía.
    await router.navegar('#/revisar/4');
    expect(vistos.at(-1)).toBe('4 ');
  });
});
