import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearApi } from '../../src/app/api';
import { formatearFecha, vistaInicio } from '../../src/app/inicio';
import type { CapituloLista, Consulta, Usuario } from '../../src/app/tipos-api';
import { json } from './ayudas';

const consulta = (c: Partial<Consulta> = {}): Consulta => ({
  apertura: '2026-11-02T12:00:00Z',
  cierre: '2026-11-12T12:00:00Z',
  etapa: 'consulta',
  motivoObligatorio: false,
  ...c,
});

const CAPS: CapituloLista[] = [
  { id: 3, orden: 1, slug: 'cap-1', titulo: 'Capítulo <b>1</b>', misCambios: 2, misComentarios: 1 },
  { id: 4, orden: 2, slug: 'cap-2', titulo: 'Capítulo 2', misCambios: 0, misComentarios: 0 },
];

const usuario = (roles: Usuario['roles']): Usuario => ({
  id: 12,
  nombre: 'Ana Pérez',
  laboratorio: 'Lab Norte',
  roles,
});

async function montar(u: Usuario, c: Consulta, caps: CapituloLista[], salir: () => Promise<void> = async () => {}) {
  // GET /consulta y GET /capitulos se piden en paralelo: se responde por ruta.
  const fetchRuta = (async (entrada: RequestInfo | URL) => {
    const url = String(entrada);
    if (url === '/api/consulta') return json(200, c);
    if (url === '/api/capitulos') return json(200, caps);
    throw new Error(`ruta inesperada ${url}`);
  }) as unknown as typeof fetch;
  const api = crearApi({ fetch: fetchRuta, alSinSesion: () => {} });
  const raiz = document.createElement('div');
  const vista = vistaInicio(api, u, { salir, almacen: localStorage });
  vista.montar(raiz);
  await vista.listo;
  return raiz;
}

const enlaces = (raiz: HTMLElement) => [...raiz.querySelectorAll('a')].map((a) => a.getAttribute('href'));

describe('inicio', () => {
  it('inicio muestra etapa y fechas en America/Santiago', async () => {
    const raiz = await montar(usuario(['laboratorio']), consulta(), CAPS);
    const banner = raiz.querySelector('.banner-etapa')!;
    expect(banner.textContent).toContain('Consulta abierta');
    // 12:00 UTC en noviembre = 09:00 en Chile (UTC-3, horario de verano).
    expect(banner.textContent).toContain('09:00');
    expect(banner.textContent).toContain('02-11-2026');
    expect(banner.textContent).toContain('12-11-2026');
    expect(banner.textContent).not.toContain('12:00');
  });

  it('formatearFecha respeta el horario de invierno y de verano', () => {
    expect(formatearFecha('2026-07-01T12:00:00Z')).toContain('08:00'); // UTC-4
    expect(formatearFecha('2026-12-01T12:00:00Z')).toContain('09:00'); // UTC-3
  });

  it('preparacion y edicion final tienen su propio texto', async () => {
    const prep = await montar(
      usuario(['laboratorio']),
      consulta({ etapa: 'preparacion', apertura: null, cierre: null }),
      CAPS,
    );
    expect(prep.querySelector('.banner-etapa')!.textContent).toMatch(/aún no/i);
    const fin = await montar(usuario(['revisor']), consulta({ etapa: 'edicion_final' }), CAPS);
    expect(fin.querySelector('.banner-etapa')!.textContent).toMatch(/edición final/i);
  });

  it('inicio muestra enlaces segun roles', async () => {
    const lab = await montar(usuario(['laboratorio']), consulta(), CAPS);
    expect(enlaces(lab)).toEqual(expect.arrayContaining(['#/capitulo/3', '#/capitulo/4']));
    expect(enlaces(lab).some((h) => h?.startsWith('#/revisar'))).toBe(false);
    expect(enlaces(lab)).not.toContain('#/admin');
    expect(lab.textContent).toContain('2 cambios');
    expect(lab.textContent).toContain('1 comentario');

    const rev = await montar(usuario(['revisor']), consulta({ etapa: 'edicion_final' }), [
      { ...CAPS[0], totalSugerencias: 7, totalComentarios: 3, pendientes: 5 },
    ]);
    expect(enlaces(rev)).toContain('#/revisar/3');
    expect(enlaces(rev)).not.toContain('#/capitulo/3');
    expect(rev.textContent).toContain('7 sugerencias');
    expect(rev.textContent).toContain('5 pendientes');

    const adm = await montar(usuario(['admin', 'laboratorio']), consulta(), CAPS);
    expect(enlaces(adm)).toContain('#/admin');
    expect(enlaces(adm)).toContain('#/capitulo/3');
  });

  it('el titulo del capitulo se muestra como texto, no como HTML', async () => {
    const raiz = await montar(usuario(['laboratorio']), consulta(), CAPS);
    expect(raiz.querySelector('a b')).toBeNull();
    expect(raiz.textContent).toContain('Capítulo <b>1</b>');
  });

  it('un fallo de red se muestra con role=alert', async () => {
    const api = crearApi({
      fetch: (async () => {
        throw new TypeError('x');
      }) as unknown as typeof fetch,
      alSinSesion: () => {},
    });
    const raiz = document.createElement('div');
    const vista = vistaInicio(api, usuario(['laboratorio']), { salir: async () => {} });
    vista.montar(raiz);
    await vista.listo;
    expect(raiz.querySelector('[role="alert"]')?.textContent).toContain('conexión');
  });

  it('fecha invalida o etapa desconocida muestran un aviso visible sin romper la lista', async () => {
    const malaFecha = await montar(usuario(['laboratorio']), consulta({ apertura: 'no-es-fecha' }), CAPS);
    expect(malaFecha.querySelector('.banner-etapa')!.textContent).toMatch(/No se pudieron mostrar las fechas/);
    expect(malaFecha.querySelectorAll('li.capitulo')).toHaveLength(2);

    const rara = await montar(usuario(['laboratorio']), consulta({ etapa: 'otra' as never }), CAPS);
    expect(rara.querySelector('.banner-etapa')!.textContent).toMatch(/No se pudo determinar la etapa/);
    expect(rara.querySelectorAll('li.capitulo')).toHaveLength(2);
  });

  it('fuera de la consulta el enlace del laboratorio dice «Ver capítulo»', async () => {
    const abierta = await montar(usuario(['laboratorio']), consulta(), CAPS);
    expect(abierta.querySelector('a[href="#/capitulo/3"]')?.textContent).toBe('Abrir en el editor');
    for (const etapa of ['preparacion', 'edicion_final'] as const) {
      const raiz = await montar(usuario(['laboratorio']), consulta({ etapa }), CAPS);
      expect(raiz.querySelector('a[href="#/capitulo/3"]')?.textContent).toBe('Ver capítulo');
    }
  });
});

describe('salir con borradores sin enviar', () => {
  afterEach(() => localStorage.clear());
  const botonTexto = (raiz: HTMLElement, t: string) =>
    [...raiz.querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement | undefined;

  it('avisa en la pagina si quedan borradores propios en este navegador y sale solo si se confirma', async () => {
    localStorage.setItem('mm:borrador:12:3:7', JSON.stringify({ docJson: { type: 'doc' } }));
    const salir = vi.fn(async () => {});
    const raiz = await montar(usuario(['laboratorio']), consulta(), CAPS, salir);
    botonTexto(raiz, 'Salir')!.click();
    expect(salir).not.toHaveBeenCalled();
    const aviso = raiz.querySelector('.aviso-salir') as HTMLElement;
    expect(aviso.hidden).toBe(false);
    expect(aviso.textContent).toContain('cambios sin guardar en este navegador');
    botonTexto(aviso, 'Cancelar')!.click();
    expect(aviso.hidden).toBe(true);
    expect(salir).not.toHaveBeenCalled();
    botonTexto(raiz, 'Salir')!.click();
    botonTexto(aviso, 'Salir de todos modos')!.click();
    expect(salir).toHaveBeenCalledTimes(1);
  });

  it('los borradores de otra persona o vacios no detienen la salida', async () => {
    localStorage.setItem('mm:borrador:13:3:7', JSON.stringify({ docJson: { type: 'doc' } }));
    localStorage.setItem('mm:motivos:12:3:7', '{}');
    const salir = vi.fn(async () => {});
    const raiz = await montar(usuario(['laboratorio']), consulta(), CAPS, salir);
    botonTexto(raiz, 'Salir')!.click();
    expect(salir).toHaveBeenCalledTimes(1);
  });
});
