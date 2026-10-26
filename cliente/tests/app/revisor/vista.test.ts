import { afterEach, describe, expect, it } from 'vitest';
import { crearApi } from '../../../src/app/api';
import { abreviaturaLab, claseLab } from '../../../src/app/revisor/panel';
import { vistaRevisor } from '../../../src/app/revisor/vista';
import type { Aportes, CapituloLista, Consulta, Etapa } from '../../../src/app/tipos-api';
import { error, json } from '../ayudas';
import { aportes, BASE } from './datos';

const consulta = (etapa: Etapa): Consulta => ({
  apertura: '2026-11-02T12:00:00Z',
  cierre: '2026-11-12T12:00:00Z',
  etapa,
  motivoObligatorio: false,
});

const CAPS: CapituloLista[] = [{ id: 3, orden: 1, slug: 'cap-1', titulo: 'Capítulo 1', misCambios: 0, misComentarios: 0 }];

const montadas: { desmontar(): unknown }[] = [];
afterEach(() => {
  while (montadas.length > 0) montadas.pop()?.desmontar();
  history.replaceState(null, '', '#');
});

async function montar(opciones: { etapa?: Etapa; query?: string; datos?: Aportes; aportesError?: string } = {}) {
  const datos = opciones.datos ?? aportes();
  const fetchRuta = (async (entrada: RequestInfo | URL) => {
    const url = String(entrada);
    if (url === '/api/consulta') return json(200, consulta(opciones.etapa ?? 'consulta'));
    if (url === '/api/capitulos') return json(200, CAPS);
    if (url === '/api/capitulos/3/base') return json(200, { versionId: 7, docJson: BASE }, { ETag: '"v7"' });
    if (url === '/api/capitulos/3/aportes') {
      return opciones.aportesError ? error(403, opciones.aportesError) : json(200, datos);
    }
    if (url === '/api/capitulos/3/final') return error(404, 'no_encontrado'); // sin versión final guardada (Task 7)
    throw new Error(`ruta inesperada ${url}`);
  }) as unknown as typeof fetch;
  const api = crearApi({ fetch: fetchRuta, alSinSesion: () => {} });
  const raiz = document.createElement('div');
  document.body.append(raiz);
  const vista = vistaRevisor(api, 3, new URLSearchParams(opciones.query ?? ''));
  montadas.push(vista);
  vista.montar(raiz);
  await vista.listo;
  return raiz;
}

const bloque = (raiz: HTMLElement, bid: string) => raiz.querySelector<HTMLElement>(`.panel-bloques [data-bloque="${bid}"]`);
const labsVisibles = (r: HTMLElement) => [...r.querySelectorAll('.panel-bloques .fila-propuesta .chip-lab')].map((c) => c.textContent);

describe('vista del revisor', () => {
  it('muestra la base con las sugerencias por color y el panel por bloque', async () => {
    const raiz = await montar();
    expect(raiz.textContent).toContain('Capítulo 1');
    const informe = raiz.querySelector<HTMLAnchorElement>('a[href="#/informe/3"]');
    expect(informe?.textContent).toBe('Registro de cambios de este capítulo');
    // Documento base con las propuestas superpuestas, con la clase del laboratorio.
    const insertados = [...raiz.querySelectorAll<HTMLElement>('.editor .rev-insertado')];
    expect(insertados.map((n) => n.textContent)).toEqual(expect.arrayContaining(['43,0', '44,0', 'inicial', 'último', '10']));
    expect(insertados.find((n) => n.textContent === '44,0')!.classList.contains(claseLab(20))).toBe(true);
    // p1: tres laboratorios, Norte y Sur colapsados en una fila.
    const p1 = bloque(raiz, 'p1')!;
    expect(p1.querySelector('.contador-labs')!.textContent).toBe('3 laboratorios');
    const filas = p1.querySelectorAll('.fila-propuesta');
    expect(filas).toHaveLength(2);
    const colapsada = [...filas].find((f) => f.querySelectorAll('.chip-lab').length > 1)!;
    expect(colapsada.textContent).toContain('43,0');
    expect([...colapsada.querySelectorAll('.chip-lab')].map((c) => c.textContent)).toEqual([
      abreviaturaLab('Laboratorio Norte'),
      abreviaturaLab('Laboratorio Sur'),
    ]);
    // Comentarios anclados a su bloque, como texto (no HTML).
    const p2 = bloque(raiz, 'p2')!;
    expect(p2.querySelector('.comentario')!.textContent).toContain('Confirmar el <b>tiempo</b>.');
    expect(p2.querySelector('.comentario b')).toBeNull();
    expect(bloque(raiz, 'p3')!.querySelector('.comentario')!.textContent).toContain('Ya está claro.');
  });

  it('cola de conflictos en orden de documento con propuestas lado a lado', async () => {
    const raiz = await montar();
    const cola = [...raiz.querySelectorAll<HTMLElement>('.cola-conflictos > li')];
    expect(cola.map((c) => c.dataset.bloque)).toEqual(['p1', 'p3']);
    const lados = cola[0].querySelectorAll('.propuesta-lab');
    // Norte y Sur proponen lo mismo: una columna con los dos chips.
    expect(lados).toHaveLength(2);
    expect(lados[0].textContent).toContain('44,0');
    expect(lados[1].querySelectorAll('.chip-lab')).toHaveLength(2);
    expect(lados[1].textContent).toContain('2 laboratorios');
  });

  it('propuestas coincidentes salen de la cola y se muestran con su contador', async () => {
    const datos = aportes();
    datos.sugerencias = datos.sugerencias.filter((s) => s.usuarioId !== 20); // queda Norte = Sur en p1
    const raiz = await montar({ datos });
    expect([...raiz.querySelectorAll<HTMLElement>('.cola-conflictos > li')].map((c) => c.dataset.bloque)).toEqual([]);
    const coincidencia = raiz.querySelector<HTMLElement>('.coincidencias > li[data-bloque="p1"]')!;
    expect(coincidencia.textContent).toContain('2 laboratorios');
    expect(coincidencia.textContent).toContain('43,0');
    // Tampoco se recuadra como conflicto en el documento.
    expect(raiz.querySelector('.editor .rev-conflicto')).toBeNull();
  });

  it('las marcas del documento llevan el laboratorio (title y abreviatura)', async () => {
    const raiz = await montar();
    const centro = [...raiz.querySelectorAll<HTMLElement>('.editor .rev-insertado')].find((n) => n.textContent === '44,0')!;
    expect(centro.dataset.lab).toBe(abreviaturaLab('Laboratorio Centro'));
    expect(centro.title).toBe('Laboratorio Centro');
    const tachado = raiz.querySelector<HTMLElement>('.editor .rev-eliminado')!;
    expect(tachado.title).not.toBe('');
  });

  it('capitulo sin aportes lo dice, sin hablar de filtros', async () => {
    const raiz = await montar({ datos: { sugerencias: [], comentarios: [] } });
    expect(raiz.querySelector('.panel-bloques')!.textContent).toMatch(/aún no tiene aportes/i);
    const filtrada = await montar({ query: 'lab=99' });
    expect(filtrada.querySelector('.panel-bloques')!.textContent).toMatch(/filtros/i);
  });

  it('filtro por laboratorio y solo pendientes', async () => {
    const raiz = await montar();
    const lab = raiz.querySelector<HTMLSelectElement>('select[name="lab"]')!;
    lab.value = '15';
    lab.dispatchEvent(new Event('change'));
    expect(new Set(labsVisibles(raiz))).toEqual(new Set([abreviaturaLab('Laboratorio Sur')]));
    expect(bloque(raiz, 'p3')).toBeNull();

    lab.value = '';
    lab.dispatchEvent(new Event('change'));
    const pendientes = raiz.querySelector<HTMLInputElement>('input[name="pendientes"]')!;
    pendientes.checked = true;
    pendientes.dispatchEvent(new Event('change'));
    // La de p2 (aceptada) se oculta; queda el comentario abierto de p2.
    expect(bloque(raiz, 'p2')!.querySelector('.fila-propuesta')).toBeNull();
    expect(bloque(raiz, 'p2')!.querySelector('.comentario')).not.toBeNull();
    expect(bloque(raiz, 'p3')!.querySelector('.comentario')).toBeNull();
  });

  it('filtro en la url se restaura al recargar', async () => {
    history.replaceState(null, '', '#/revisar/3?lab=12&solo=conflictos');
    const raiz = await montar({ query: 'lab=12&solo=conflictos' });
    expect(raiz.querySelector<HTMLSelectElement>('select[name="lab"]')!.value).toBe('12');
    expect(raiz.querySelector<HTMLInputElement>('input[name="conflictos"]')!.checked).toBe(true);
    expect(new Set(labsVisibles(raiz))).toEqual(new Set([abreviaturaLab('Laboratorio Norte')]));
    expect(bloque(raiz, 'p2')).toBeNull();

    // Cambiar el filtro lo deja en la url (sin recargar la vista)…
    const lab = raiz.querySelector<HTMLSelectElement>('select[name="lab"]')!;
    lab.value = '20';
    lab.dispatchEvent(new Event('change'));
    expect(location.hash).toBe('#/revisar/3?lab=20&solo=conflictos');

    // …y al recargar con esa url vuelve igual.
    const otra = await montar({ query: location.hash.split('?')[1] });
    expect(otra.querySelector<HTMLSelectElement>('select[name="lab"]')!.value).toBe('20');
    expect(new Set(labsVisibles(otra))).toEqual(new Set([abreviaturaLab('Laboratorio Centro')]));
  });

  it('en consulta las decisiones estan deshabilitadas', async () => {
    const raiz = await montar({ etapa: 'consulta' });
    const botones = [...raiz.querySelectorAll<HTMLButtonElement>('button.decision')];
    expect(botones.length).toBeGreaterThan(0);
    expect(botones.every((b) => b.disabled)).toBe(true);
    expect(raiz.querySelector('.aviso-etapa')!.textContent).toMatch(/edición final/i);

    const fin = await montar({ etapa: 'edicion_final' });
    const habilitados = [...fin.querySelectorAll<HTMLButtonElement>('button.decision')];
    expect(habilitados.length).toBeGreaterThan(0);
    expect(habilitados.every((b) => !b.disabled)).toBe(true);
    expect(fin.querySelector('.aviso-etapa')).toBeNull();
  });

  it('sugerencias de una version base anterior se listan sin superponerse', async () => {
    const datos = aportes();
    datos.sugerencias.push({ ...datos.sugerencias[0], id: 'u12:viejo', sugerenciaId: 999, versionId: 5, bloqueId: 'p-borrado' });
    const raiz = await montar({ datos });
    expect(raiz.querySelector('.panel-bloques [data-bloque="p-borrado"] .version-anterior')).not.toBeNull();
    expect(raiz.querySelector('[role="alert"]:not([hidden])')).toBeNull();
  });

  it('un error al cargar se muestra con role=alert', async () => {
    const raiz = await montar({ aportesError: 'sin_permiso' });
    const alerta = raiz.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alerta.hidden).toBe(false);
    expect(alerta.textContent).toMatch(/permiso/i);
  });
});
