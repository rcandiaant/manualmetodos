import { describe, expect, it, vi } from 'vitest';
import { vistaCapitulos } from '../../../src/app/admin/capitulos';
import { crearApi } from '../../../src/app/api';
import type { CapituloLista, Consulta } from '../../../src/app/tipos-api';
import { fetchSimulado, json } from '../ayudas';

const consulta = (etapa: Consulta['etapa']): Consulta => ({
  apertura: etapa === 'preparacion' ? null : '2026-11-02T12:00:00Z',
  cierre: etapa === 'preparacion' ? null : '2026-11-12T12:00:00Z',
  etapa,
  motivoObligatorio: false,
});

const cap = (id: number, orden: number, titulo: string): CapituloLista => ({
  id,
  orden,
  slug: `cap-${id}`,
  titulo,
  misCambios: 0,
  misComentarios: 0,
});

const LISTA = [cap(1, 1, 'Cloruro'), cap(2, 2, 'Nitrato'), cap(3, 3, 'Sulfato')];

async function montar(etapa: Consulta['etapa'], ...extra: Response[]) {
  const f = fetchSimulado(json(200, consulta(etapa)), json(200, LISTA.map((c) => ({ ...c }))), ...extra);
  const api = crearApi({ fetch: f.fetch, alSinSesion: () => {} });
  const raiz = document.createElement('div');
  const vista = vistaCapitulos(api);
  vista.montar(raiz);
  await vista.listo;
  return { raiz, vista, f };
}

const filas = (raiz: HTMLElement) => [...raiz.querySelectorAll<HTMLTableRowElement>('tr[data-id]')];
const fila = (raiz: HTMLElement, id: number) => raiz.querySelector(`tr[data-id="${id}"]`) as HTMLTableRowElement;
const entradaOrden = (raiz: HTMLElement, id: number) => fila(raiz, id).querySelector('input[type=number]') as HTMLInputElement;
const entradaTitulo = (raiz: HTMLElement, id: number) => fila(raiz, id).querySelector('input[type=text]') as HTMLInputElement;
const botonEn = (cont: HTMLElement, texto: string) =>
  [...cont.querySelectorAll('button')].find((b) => b.textContent === texto) as HTMLButtonElement;
const alerta = (raiz: HTMLElement) =>
  [...raiz.querySelectorAll<HTMLElement>('.lista-capitulos [role=alert]')].find((n) => !n.hidden);
const estado = (raiz: HTMLElement) => raiz.querySelector('.lista-capitulos [role=status]') as HTMLElement;

describe('admin: lista de capítulos', () => {
  it('muestra cada capítulo con orden y título editables', async () => {
    const { raiz } = await montar('preparacion');
    expect(filas(raiz).map((f) => f.dataset.id)).toEqual(['1', '2', '3']);
    expect(entradaOrden(raiz, 2).value).toBe('2');
    expect(entradaTitulo(raiz, 2).value).toBe('Nitrato');
    expect(fila(raiz, 2).textContent).toContain('cap-2');
    expect(botonEn(fila(raiz, 2), 'Guardar')).toBeTruthy();
  });

  it('editar solo el título manda un PATCH con ese campo', async () => {
    const { raiz, vista, f } = await montar('preparacion', json(200, { id: 2 }));
    entradaTitulo(raiz, 2).value = 'Nitrato total';
    botonEn(fila(raiz, 2), 'Guardar').click();
    await vista.listo;
    const ll = f.llamadas[2];
    expect(ll.url).toBe('/api/admin/capitulos/2');
    expect(ll.init.method).toBe('PATCH');
    expect(JSON.parse(String(ll.init.body))).toEqual({ titulo: 'Nitrato total' });
    expect(estado(raiz).hidden).toBe(false);
    expect(estado(raiz).textContent).toBe('Guardado.');
    expect(entradaTitulo(raiz, 2).value).toBe('Nitrato total');
  });

  it('editar orden y título con Enter manda ambos y reordena la lista por orden e id', async () => {
    const { raiz, vista, f } = await montar('preparacion', json(200, { id: 3 }));
    entradaOrden(raiz, 3).value = '1';
    entradaTitulo(raiz, 3).value = 'Sulfato soluble';
    entradaTitulo(raiz, 3).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vista.listo;
    expect(JSON.parse(String(f.llamadas[2].init.body))).toEqual({ orden: 1, titulo: 'Sulfato soluble' });
    // orden 1: id 1 y luego id 3 (desempate por id); después el 2.
    expect(filas(raiz).map((x) => x.dataset.id)).toEqual(['1', '3', '2']);
    expect(entradaOrden(raiz, 3).value).toBe('1');
    expect(estado(raiz).textContent).toBe('Guardado.');
  });

  it('un error del servidor se muestra y conserva lo escrito', async () => {
    const { raiz, vista } = await montar(
      'preparacion',
      json(400, { error: { codigo: 'entrada_invalida', mensaje: 'Campo «orden»: está fuera de rango', campos: { orden: 'está fuera de rango' } } }),
    );
    entradaOrden(raiz, 1).value = '99';
    entradaTitulo(raiz, 1).value = 'Otro título';
    botonEn(fila(raiz, 1), 'Guardar').click();
    await vista.listo;
    expect(alerta(raiz)?.textContent).toContain('fuera de rango');
    expect(entradaOrden(raiz, 1).value).toBe('99');
    expect(entradaTitulo(raiz, 1).value).toBe('Otro título');
    expect(estado(raiz).hidden).toBe(true);
    expect(filas(raiz).map((x) => x.dataset.id)).toEqual(['1', '2', '3']);
  });

  it('valida en el cliente sin llamar al servidor y conserva lo escrito', async () => {
    const { raiz, vista, f } = await montar('preparacion');
    entradaTitulo(raiz, 1).value = '   ';
    botonEn(fila(raiz, 1), 'Guardar').click();
    await vista.listo;
    expect(alerta(raiz)?.textContent).toContain('título');
    expect(entradaTitulo(raiz, 1).value).toBe('   ');
    entradaTitulo(raiz, 1).value = 'Cloruro';
    entradaOrden(raiz, 1).value = '1.5';
    botonEn(fila(raiz, 1), 'Guardar').click();
    await vista.listo;
    expect(alerta(raiz)?.textContent).toContain('orden');
    expect(f.llamadas).toHaveLength(2);
  });

  it('borrar pide confirmación en la página y luego manda DELETE', async () => {
    const confirmar = vi.spyOn(window, 'confirm');
    const { raiz, vista, f } = await montar('preparacion', new Response(null, { status: 204 }));
    botonEn(fila(raiz, 2), 'Borrar').click();
    expect(f.llamadas).toHaveLength(2);
    const caja = raiz.querySelector('.confirmar') as HTMLElement;
    expect(caja.textContent).toContain('¿Borrar el capítulo "Nitrato"? Esta acción no se puede deshacer.');
    botonEn(caja, 'Borrar definitivamente').click();
    await vista.listo;
    expect(f.llamadas[2].url).toBe('/api/admin/capitulos/2');
    expect(f.llamadas[2].init.method).toBe('DELETE');
    expect(filas(raiz).map((x) => x.dataset.id)).toEqual(['1', '3']);
    expect(raiz.querySelector('.confirmar')).toBeNull();
    expect(confirmar).not.toHaveBeenCalled();
    confirmar.mockRestore();
  });

  it('cancelar cierra la confirmación sin llamar al servidor', async () => {
    const { raiz, f } = await montar('preparacion');
    entradaTitulo(raiz, 1).value = 'A medio escribir';
    entradaTitulo(raiz, 1).dispatchEvent(new Event('input', { bubbles: true }));
    botonEn(fila(raiz, 2), 'Borrar').click();
    botonEn(raiz.querySelector('.confirmar') as HTMLElement, 'Cancelar').click();
    expect(raiz.querySelector('.confirmar')).toBeNull();
    expect(f.llamadas).toHaveLength(2);
    expect(filas(raiz)).toHaveLength(3);
    // Lo escrito en otra fila no se pierde al redibujar.
    expect(entradaTitulo(raiz, 1).value).toBe('A medio escribir');
  });

  it('en cualquier etapa el botón Borrar está habilitado y borra tras confirmar', async () => {
    for (const etapa of ['consulta', 'edicion_final'] as const) {
      const { raiz, vista, f } = await montar(etapa, new Response(null, { status: 204 }));
      const b = botonEn(fila(raiz, 1), 'Borrar');
      expect(b.disabled).toBe(false);
      expect(b.title).toBe('');
      expect(botonEn(fila(raiz, 1), 'Guardar').disabled).toBe(false);
      b.click();
      botonEn(raiz.querySelector('.confirmar') as HTMLElement, 'Borrar definitivamente').click();
      await vista.listo;
      expect(f.llamadas[2].url).toBe('/api/admin/capitulos/1');
      expect(f.llamadas[2].init.method).toBe('DELETE');
      expect(filas(raiz)).toHaveLength(2);
    }
  });

  it('un 409 por aportes muestra el mensaje del servidor', async () => {
    const msg = 'No se puede borrar el capítulo: ya tiene aportes (copias, sugerencias o comentarios de laboratorios, o una versión final).';
    const { raiz, vista } = await montar('consulta', json(409, { error: { codigo: 'operacion_no_permitida', mensaje: msg } }));
    botonEn(fila(raiz, 1), 'Borrar').click();
    botonEn(raiz.querySelector('.confirmar') as HTMLElement, 'Borrar definitivamente').click();
    await vista.listo;
    expect(alerta(raiz)?.textContent).toBe(msg);
    expect(filas(raiz)).toHaveLength(3);
  });
});

describe('admin: lista de capítulos (ronda de correcciones)', () => {
  it('un borrador sin cambios no tapa los valores nuevos tras volver a subir el capítulo', async () => {
    const { raiz, vista } = await montar(
      'preparacion',
      json(201, { id: 1, versionId: 9 }),
      json(200, [cap(1, 4, 'Cloruro nuevo'), cap(2, 2, 'Nitrato'), cap(3, 3, 'Sulfato')]),
    );
    // Abrir y cancelar la confirmación no debe dejar un borrador con los valores viejos.
    botonEn(fila(raiz, 1), 'Borrar').click();
    botonEn(raiz.querySelector('.confirmar') as HTMLElement, 'Cancelar').click();
    vista.cargar('cap-1.tex', 'Hola.\n');
    botonEn(raiz, 'Subir y reemplazar').click(); // el slug cap-1 ya existe
    await vista.listo;
    expect(entradaTitulo(raiz, 1).value).toBe('Cloruro nuevo');
    expect(entradaOrden(raiz, 1).value).toBe('4');
  });

  it('un borrador editado se descarta si el servidor cambió ese capítulo', async () => {
    const { raiz, vista } = await montar(
      'preparacion',
      json(201, { id: 1, versionId: 9 }),
      json(200, [cap(1, 1, 'Cloruro nuevo'), cap(2, 2, 'Nitrato'), cap(3, 3, 'Sulfato')]),
    );
    entradaOrden(raiz, 1).value = '7';
    entradaOrden(raiz, 1).dispatchEvent(new Event('input', { bubbles: true }));
    entradaTitulo(raiz, 2).value = 'Nitrato a medias';
    entradaTitulo(raiz, 2).dispatchEvent(new Event('input', { bubbles: true }));
    vista.cargar('cap-1.tex', 'Hola.\n');
    botonEn(raiz, 'Subir y reemplazar').click(); // el slug cap-1 ya existe
    await vista.listo;
    expect(entradaTitulo(raiz, 1).value).toBe('Cloruro nuevo');
    expect(entradaOrden(raiz, 1).value).toBe('1');
    // El capítulo que no cambió en el servidor conserva lo escrito.
    expect(entradaTitulo(raiz, 2).value).toBe('Nitrato a medias');
  });

  it('guardar sin cambios no llama al servidor y lo dice', async () => {
    const { raiz, vista, f } = await montar('preparacion');
    botonEn(fila(raiz, 1), 'Guardar').click();
    await vista.listo;
    expect(f.llamadas).toHaveLength(2);
    expect(estado(raiz).textContent).toBe('Sin cambios.');
  });

  it('la confirmación pone el foco en Cancelar y guardar con Enter conserva el foco', async () => {
    const { raiz, vista } = await montar('preparacion', json(200, { id: 2 }));
    document.body.append(raiz);
    try {
      botonEn(fila(raiz, 2), 'Borrar').click();
      expect(document.activeElement?.textContent).toBe('Cancelar');
      botonEn(raiz.querySelector('.confirmar') as HTMLElement, 'Cancelar').click();
      const t = entradaTitulo(raiz, 2);
      t.focus();
      t.value = 'Nitrato total';
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await vista.listo;
      expect(document.activeElement).toBe(entradaTitulo(raiz, 2));
    } finally {
      raiz.remove();
    }
  });

  it('un 409 etapa_no_permite al borrar muestra el mensaje del servidor', async () => {
    const msg = 'Solo se pueden borrar capítulos antes de la apertura de la consulta.';
    const { raiz, vista } = await montar('preparacion', json(409, { error: { codigo: 'etapa_no_permite', mensaje: msg } }));
    botonEn(fila(raiz, 1), 'Borrar').click();
    botonEn(raiz.querySelector('.confirmar') as HTMLElement, 'Borrar definitivamente').click();
    await vista.listo;
    expect(alerta(raiz)?.textContent).toBe(msg);
  });

  it('aunque no se sepa la etapa, Borrar sigue habilitado (la decide el servidor)', async () => {
    const f = fetchSimulado(json(500, { error: { codigo: 'error_interno', mensaje: 'x' } }), json(200, LISTA));
    const api = crearApi({ fetch: f.fetch, alSinSesion: () => {} });
    const raiz = document.createElement('div');
    const vista = vistaCapitulos(api);
    vista.montar(raiz);
    await vista.listo;
    const b = botonEn(fila(raiz, 1), 'Borrar');
    expect(b.disabled).toBe(false);
    expect(b.title).toBe('');
  });

  it('los botones de borrar usan clases propias, no la global «peligro»', async () => {
    const { raiz } = await montar('preparacion');
    const b = botonEn(fila(raiz, 1), 'Borrar');
    expect(b.classList.contains('borrar-capitulo')).toBe(true);
    expect(b.classList.contains('peligro')).toBe(false);
    b.click();
    const def = botonEn(raiz.querySelector('.confirmar') as HTMLElement, 'Borrar definitivamente');
    expect(def.classList.contains('borrar-definitivo')).toBe(true);
    expect(def.classList.contains('peligro')).toBe(false);
  });
});
