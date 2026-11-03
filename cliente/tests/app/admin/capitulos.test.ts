import { describe, expect, it } from 'vitest';
import { vistaCapitulos, proponerSlug } from '../../../src/app/admin/capitulos';
import { crearApi } from '../../../src/app/api';
import type { Consulta } from '../../../src/app/tipos-api';
import { fetchSimulado, json } from '../ayudas';

const consulta = (etapa: Consulta['etapa']): Consulta => ({
  apertura: etapa === 'preparacion' ? null : '2026-11-02T12:00:00Z',
  cierre: etapa === 'preparacion' ? null : '2026-11-12T12:00:00Z',
  etapa,
  motivoObligatorio: false,
});

const TEX = String.raw`\analito{Cloruro <b>total</b>}
\metodo{Titulación}
Primer párrafo con \textbf{negrita}.

\subsection{Algo raro}

\begin{center}centrado\end{center}
`;

async function montar(etapa: Consulta['etapa'], ...extra: Response[]) {
  // GET /consulta y GET /capitulos (lista vacía) al montar.
  const f = fetchSimulado(json(200, consulta(etapa)), json(200, []), ...extra);
  const api = crearApi({ fetch: f.fetch, alSinSesion: () => {} });
  const raiz = document.createElement('div');
  const vista = vistaCapitulos(api);
  vista.montar(raiz);
  await vista.listo;
  return { raiz, vista, f };
}
const boton = (raiz: HTMLElement, texto: string) =>
  [...raiz.querySelectorAll('button')].find((b) => b.textContent === texto) as HTMLButtonElement;

describe('admin: capítulos', () => {
  it('slug propuesto desde el nombre del archivo', () => {
    expect(proponerSlug('Capítulo 1 - Cloruro Total.tex')).toBe('capitulo-1-cloruro-total');
    expect(proponerSlug('ÁÉÍ_ñandú  (final).TEX')).toBe('aei-nandu-final');
    expect(proponerSlug('---.tex')).toBe('capitulo');
    expect(proponerSlug('a'.repeat(120) + '.tex').length).toBe(80);
  });

  it('vista previa reporta especiales y avisos', async () => {
    const { raiz, vista } = await montar('preparacion');
    vista.cargar('cloruro-total.tex', TEX);
    const previa = raiz.querySelector('.vista-previa') as HTMLElement;
    expect(previa).toBeTruthy();
    expect(previa.textContent).toContain('Bloques especiales: 2');
    expect(previa.textContent).toContain('\\subsection{Algo raro}');
    expect(previa.textContent).toMatch(/Avisos: \d+/);
    expect((raiz.querySelector('input[name=slug]') as HTMLInputElement).value).toBe('cloruro-total');
    expect((raiz.querySelector('input[name=titulo]') as HTMLInputElement).value).toBe('Cloruro <b>total</b>');
    expect(previa.querySelector('b')).toBeNull();
  });

  it('sube con texOriginal y docJson en preparacion', async () => {
    const { raiz, vista, f } = await montar('preparacion', json(201, { id: 3, versionId: 7 }), json(200, []));
    vista.cargar('cap-1.tex', TEX);
    (raiz.querySelector('input[name=orden]') as HTMLInputElement).value = '4';
    boton(raiz, 'Subir').click();
    await vista.listo;
    const llamada = f.llamadas[2];
    expect(llamada.url).toBe('/api/admin/capitulos');
    expect(llamada.init.method).toBe('POST');
    const cuerpo = JSON.parse(String(llamada.init.body));
    expect(cuerpo).toMatchObject({ slug: 'cap-1', orden: 4, texOriginal: TEX });
    expect(cuerpo.docJson.type).toBe('doc');
    expect(raiz.textContent).toContain('Capítulo subido');
    // Tras subir, se recarga la lista de capítulos.
    expect(f.llamadas[3].url).toBe('/api/capitulos');
  });

  it('sube un capítulo nuevo en cualquier etapa, sin bloqueo', async () => {
    for (const etapa of ['consulta', 'edicion_final'] as const) {
      const { raiz, vista, f } = await montar(etapa, json(201, { id: 3, versionId: 7 }), json(200, []));
      vista.cargar('cap-1.tex', TEX);
      expect(boton(raiz, 'Subir').disabled).toBe(false);
      expect(boton(raiz, 'Subir').title).toBe('');
      expect(raiz.querySelector('.bloqueo')).toBeNull();
      boton(raiz, 'Subir').click();
      await vista.listo;
      expect(f.llamadas[2].url).toBe('/api/admin/capitulos');
      expect(raiz.textContent).toContain('Capítulo subido');
    }
  });

  it('si el slug ya existe avisa que reemplazará el texto de ese capítulo', async () => {
    const existente = { id: 4, orden: 2, slug: 'cap-1', titulo: 'Cloruro total', misCambios: 0, misComentarios: 0 };
    const f = fetchSimulado(json(200, consulta('consulta')), json(200, [existente]));
    const api = crearApi({ fetch: f.fetch, alSinSesion: () => {} });
    const raiz = document.createElement('div');
    const vista = vistaCapitulos(api);
    vista.montar(raiz);
    await vista.listo;
    vista.cargar('cap-1.tex', TEX);
    const aviso = raiz.querySelector('.aviso-reemplazo') as HTMLElement;
    expect(aviso.hidden).toBe(false);
    expect(aviso.textContent).toContain('reemplazará el texto de "Cloruro total"');
    expect(boton(raiz, 'Subir y reemplazar')).toBeTruthy();
    // Con otro slug es un capítulo nuevo: el aviso desaparece.
    const slug = raiz.querySelector('input[name=slug]') as HTMLInputElement;
    slug.value = 'otro';
    slug.dispatchEvent(new Event('input'));
    expect(aviso.hidden).toBe(true);
    expect(boton(raiz, 'Subir')).toBeTruthy();
    slug.value = 'cap-1';
    slug.dispatchEvent(new Event('input'));
    expect(aviso.hidden).toBe(false);
  });

  it('un 409 del servidor muestra su mensaje en role=alert y los errores 400 van por campo', async () => {
    const msg = '2 laboratorios ya trabajaron en este capítulo; no se puede reemplazar el texto.';
    const { raiz, vista } = await montar(
      'consulta',
      json(409, { error: { codigo: 'operacion_no_permitida', mensaje: msg } }),
      json(400, { error: { codigo: 'entrada_invalida', mensaje: 'x', campos: { slug: 'Formato inválido.' } } }),
    );
    vista.cargar('cap-1.tex', TEX);
    boton(raiz, 'Subir').click();
    await vista.listo;
    const alerta = raiz.querySelector('.error[role=alert]:not([hidden])');
    expect(alerta?.textContent).toBe(msg);
    boton(raiz, 'Subir').click();
    await vista.listo;
    expect(raiz.querySelector('[data-campo=slug]')?.textContent).toContain('Formato inválido.');
  });
});
