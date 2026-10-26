import { describe, expect, it } from 'vitest';
import { vistaCapitulos, proponerSlug } from '../../../src/app/admin/capitulos';
import { crearApi } from '../../../src/app/api';
import type { Consulta } from '../../../src/app/tipos-api';
import { error, fetchSimulado, json } from '../ayudas';

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
  const f = fetchSimulado(json(200, consulta(etapa)), ...extra);
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
    const { raiz, vista, f } = await montar('preparacion', json(201, { id: 3, versionId: 7 }));
    vista.cargar('cap-1.tex', TEX);
    (raiz.querySelector('input[name=orden]') as HTMLInputElement).value = '4';
    boton(raiz, 'Subir').click();
    await vista.listo;
    const llamada = f.llamadas[1];
    expect(llamada.url).toBe('/api/admin/capitulos');
    expect(llamada.init.method).toBe('POST');
    const cuerpo = JSON.parse(String(llamada.init.body));
    expect(cuerpo).toMatchObject({ slug: 'cap-1', orden: 4, texOriginal: TEX });
    expect(cuerpo.docJson.type).toBe('doc');
    expect(raiz.textContent).toContain('Capítulo subido');
  });

  it('subir fuera de preparacion explica el bloqueo', async () => {
    const { raiz, vista, f } = await montar('consulta');
    vista.cargar('cap-1.tex', TEX);
    expect(boton(raiz, 'Subir').disabled).toBe(true);
    expect(raiz.querySelector('.bloqueo')?.textContent).toContain('solo se pueden subir capítulos en la etapa de preparación');
    boton(raiz, 'Subir').click();
    await vista.listo;
    expect(f.llamadas).toHaveLength(1); // solo el GET /consulta
  });

  it('un 409 del servidor y los errores 400 por campo se muestran', async () => {
    const { raiz, vista } = await montar(
      'preparacion',
      error(409, 'etapa_no_permite'),
      json(400, { error: { codigo: 'entrada_invalida', mensaje: 'x', campos: { slug: 'Formato inválido.' } } }),
    );
    vista.cargar('cap-1.tex', TEX);
    boton(raiz, 'Subir').click();
    await vista.listo;
    expect(raiz.querySelector('.error')?.textContent).toContain('etapa');
    boton(raiz, 'Subir').click();
    await vista.listo;
    expect(raiz.querySelector('[data-campo=slug]')?.textContent).toContain('Formato inválido.');
  });
});
