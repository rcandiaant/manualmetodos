import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearApi } from '../../../src/app/api';
import { vistaInforme } from '../../../src/app/informe/vista';
import { armarZipFinales } from '../../../src/app/informe/zip';
import { nombreTex } from '../../../src/app/revisor/final';
import { nombreTex as desdeNombres } from '../../../src/app/revisor/nombres';
import { error, json } from '../ayudas';
import { BASE } from '../revisor/datos';

const utf8 = (u: Uint8Array) => new TextDecoder().decode(u);

/** `finales`: id -> tex (o código HTTP para fallar). */
function apiFinales(finales: Record<number, string | number>) {
  const fetchSim = (async (entrada: RequestInfo | URL) => {
    const url = String(entrada);
    const m = /^\/api\/capitulos\/(\d+)\/final$/.exec(url);
    if (!m) throw new Error(`ruta inesperada ${url}`);
    const r = finales[Number(m[1])];
    if (typeof r === 'number') return error(r, r === 404 ? 'no_encontrado' : 'error_interno');
    return json(200, { versionId: 1, docJson: BASE, tex: r });
  }) as unknown as typeof fetch;
  return crearApi({ fetch: fetchSim, alSinSesion: () => {} });
}

const caps = [
  { id: 1, slug: 'cap-1', titulo: 'Reactivos' },
  { id: 2, slug: 'cap-2', titulo: 'Preparación de medios' },
  { id: 3, slug: 'cap-3', titulo: 'Cálculos' },
];

describe('nombreTex compartido', () => {
  it('final.ts lo reexporta desde nombres.ts', () => {
    expect(nombreTex).toBe(desdeNombres);
  });
});

describe('armarZipFinales', () => {
  it('zip contiene un tex por capitulo con final', async () => {
    const api = apiFinales({ 1: 'uno\r\nñandú\r\n', 2: 'dos', 3: 'tres' });
    const r = await armarZipFinales(api, caps);
    expect(r.faltantes).toEqual([]);
    expect(r.incluidos).toEqual(['cap-1.tex', 'cap-2.tex', 'cap-3.tex']);
    const archivos = unzipSync(r.zip);
    expect(Object.keys(archivos).sort()).toEqual(['cap-1.tex', 'cap-2.tex', 'cap-3.tex']);
    expect(utf8(archivos['cap-1.tex'])).toBe('uno\nñandú\n'); // UTF-8 con LF
    expect(utf8(archivos['cap-3.tex'])).toBe('tres');
  });

  it('capitulo sin final va a FALTANTES y se avisa', async () => {
    const api = apiFinales({ 1: 'uno', 2: 404, 3: 404 });
    const r = await armarZipFinales(api, caps);
    expect(r.incluidos).toEqual(['cap-1.tex']);
    expect(r.faltantes).toEqual(['Preparación de medios', 'Cálculos']);
    const archivos = unzipSync(r.zip);
    expect(Object.keys(archivos).sort()).toEqual(['FALTANTES.txt', 'cap-1.tex']);
    expect(utf8(archivos['FALTANTES.txt'])).toBe('Preparación de medios\nCálculos\n');
  });

  it('error distinto de 404 se propaga', async () => {
    const api = apiFinales({ 1: 'uno', 2: 500, 3: 'tres' });
    await expect(armarZipFinales(api, caps)).rejects.toMatchObject({ estado: 500 });
  });

  it('nombres de archivo unicos aunque dos slugs choquen', async () => {
    const api = apiFinales({ 1: 'a', 2: 'b', 3: 'c' });
    const r = await armarZipFinales(api, [
      { id: 1, slug: 'cap-1', titulo: 'A' },
      { id: 2, slug: 'cap-1', titulo: 'B' },
      { id: 3, slug: 'cap-1', titulo: 'C' },
    ]);
    expect(r.incluidos).toEqual(['cap-1.tex', 'cap-1-2.tex', 'cap-1-3.tex']);
    const archivos = unzipSync(r.zip);
    expect(utf8(archivos['cap-1-2.tex'])).toBe('b');
  });
});

describe('descarga desde el registro de cambios', () => {
  const montadas: { desmontar(): void }[] = [];
  afterEach(() => {
    while (montadas.length > 0) montadas.pop()?.desmontar();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  async function montar(finales: Record<number, string | number>, capituloId?: number) {
    const fetchSim = (async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url === '/api/consulta') {
        return json(200, { apertura: '2026-11-02T12:00:00Z', cierre: '2026-11-12T12:00:00Z', etapa: 'edicion_final', motivoObligatorio: false });
      }
      if (url === '/api/capitulos') return json(200, caps.map((c, i) => ({ ...c, orden: i + 1, misCambios: 0, misComentarios: 0 })));
      if (/\/base$/.test(url)) return json(200, { versionId: 7, docJson: BASE });
      if (/\/aportes$/.test(url)) return json(200, { sugerencias: [], comentarios: [] });
      const m = /^\/api\/capitulos\/(\d+)\/final$/.exec(url)!;
      const r = finales[Number(m[1])];
      if (typeof r === 'number') return error(r, r === 404 ? 'no_encontrado' : 'error_interno');
      return json(200, { versionId: 1, docJson: BASE, tex: r });
    }) as unknown as typeof fetch;
    const api = crearApi({ fetch: fetchSim, alSinSesion: () => {} });
    const raiz = document.createElement('div');
    document.body.append(raiz);
    const vista = vistaInforme(api, capituloId, new URLSearchParams(), {
      cuadro: (cb) => void setTimeout(cb, 0),
      ahora: () => new Date('2026-11-13T02:30:00Z'),
    });
    montadas.push(vista);
    vista.montar(raiz);
    await vista.listo;
    let blob: Blob | null = null;
    let nombre = '';
    URL.createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return 'blob:zip';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      nombre = this.download;
    });
    const btn = (t: string) => [...raiz.querySelectorAll('button')].find((b) => b.textContent === t);
    return { raiz, btn, descarga: () => ({ blob, nombre }) };
  }

  const esperar = (cond: () => boolean) => vi.waitFor(() => expect(cond()).toBe(true));

  it('con todos los finales descarga el zip directamente', async () => {
    const { btn, descarga } = await montar({ 1: 'uno', 2: 'dos', 3: 'tres' });
    btn('Descargar todos los .tex finales (.zip)')!.click();
    await esperar(() => descarga().nombre !== '');
    expect(descarga().nombre).toBe('manual-final-20261112.zip'); // fecha de Chile
    expect(descarga().blob!.type).toBe('application/zip');
  });

  it('capitulo sin final: aviso en la pagina con la lista y descarga solo al confirmar', async () => {
    const confirmar = vi.spyOn(window, 'confirm');
    const { raiz, btn, descarga } = await montar({ 1: 'uno', 2: 404, 3: 'tres' });
    btn('Descargar todos los .tex finales (.zip)')!.click();
    await esperar(() => btn('Descargar de todos modos') !== undefined);
    const aviso = raiz.querySelector('.aviso-zip')!;
    expect(aviso.getAttribute('role')).toBe('alert');
    expect(aviso.textContent).toContain('Preparación de medios');
    expect(aviso.textContent).not.toContain('Reactivos');
    expect(descarga().nombre).toBe('');
    expect(confirmar).not.toHaveBeenCalled();
    btn('Descargar de todos modos')!.click();
    await esperar(() => descarga().nombre !== '');
    const archivos = unzipSync(new Uint8Array(await descarga().blob!.arrayBuffer()));
    expect(Object.keys(archivos).sort()).toEqual(['FALTANTES.txt', 'cap-1.tex', 'cap-3.tex']);
    expect(btn('Descargar de todos modos')).toBeUndefined();
  });

  it('capitulo fijo: el boton lo dice y el zip trae un solo archivo', async () => {
    const { btn, descarga } = await montar({ 1: 'uno', 2: 'dos', 3: 'tres' }, 2);
    expect(btn('Descargar todos los .tex finales (.zip)')).toBeUndefined();
    btn('Descargar el .tex final de este capítulo (.zip)')!.click();
    await esperar(() => descarga().nombre !== '');
    const archivos = unzipSync(new Uint8Array(await descarga().blob!.arrayBuffer()));
    expect(Object.keys(archivos)).toEqual(['cap-2.tex']);
  });

  it('el boton queda inhabilitado mientras el aviso espera y Cancelar lo cierra', async () => {
    const { raiz, btn, descarga } = await montar({ 1: 'uno', 2: 404, 3: 'tres' });
    const principal = btn('Descargar todos los .tex finales (.zip)')!;
    principal.click();
    await esperar(() => btn('Cancelar') !== undefined);
    expect(principal.disabled).toBe(true);
    btn('Cancelar')!.click();
    expect(raiz.querySelector<HTMLElement>('.aviso-zip')!.hidden).toBe(true);
    expect(principal.disabled).toBe(false);
    expect(descarga().nombre).toBe('');
  });

  it('error distinto de 404 se muestra y no descarga', async () => {
    const { raiz, btn, descarga } = await montar({ 1: 'uno', 2: 500, 3: 'tres' });
    btn('Descargar todos los .tex finales (.zip)')!.click();
    await esperar(() => raiz.querySelector<HTMLElement>('.aviso-zip')!.hidden === false);
    const aviso = raiz.querySelector('.aviso-zip')!;
    expect(aviso.getAttribute('role')).toBe('alert');
    expect(aviso.textContent).toContain('No se pudo preparar el .zip');
    expect(descarga().nombre).toBe('');
    expect(btn('Descargar de todos modos')).toBeUndefined();
  });
});
