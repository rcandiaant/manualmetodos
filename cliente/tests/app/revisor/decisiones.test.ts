import { afterEach, describe, expect, it, vi } from 'vitest';
import { cuerpoResolucion } from '../../../src/app/revisor/decisiones';
import type { SugerenciaServidor } from '../../../src/app/tipos-api';
import { error } from '../ayudas';
import { aportes } from './datos';
import { aportesMovido, BASE_MOVIDO, botonCon, desmontarTodas, escrituras, esperar, montarVista } from './servidor';

afterEach(() => {
  desmontarTodas();
  vi.restoreAllMocks();
});

/** Fila del panel por bloque que contiene el texto dado. */
const fila = (raiz: HTMLElement, bid: string, texto: string) =>
  [...raiz.querySelectorAll<HTMLElement>(`.panel-bloques [data-bloque="${bid}"] .fila-propuesta`)].find((f) =>
    f.textContent!.includes(texto),
  )!;

const columna = (raiz: HTMLElement, bid: string, texto: string) =>
  [...raiz.querySelectorAll<HTMLElement>(`.cola-conflictos > li[data-bloque="${bid}"] .propuesta-lab`)].find((f) =>
    f.textContent!.includes(texto),
  )!;

const idFila = (datos: { sugerencias: SugerenciaServidor[] }, usuarioId: number, bid: string) =>
  datos.sugerencias.find((s) => s.usuarioId === usuarioId && s.bloqueId === bid)!.sugerenciaId;

describe('decisiones del revisor', () => {
  it('decision reenvia estado nota y derivadaReunion', async () => {
    const datos = aportes();
    const p2 = datos.sugerencias.find((s) => s.bloqueId === 'p2')!;
    p2.notaResolucion = 'Nota previa';
    p2.derivadaReunion = true;
    const { raiz, peticiones } = await montarVista({ datos });

    // El cuerpo lleva siempre los tres campos, aunque el cambio toque uno solo.
    expect(cuerpoResolucion(p2, { estado: 'rechazada' })).toEqual({ estado: 'rechazada', notaResolucion: 'Nota previa', derivadaReunion: true });
    expect(Object.keys(cuerpoResolucion({ ...p2, notaResolucion: undefined, derivadaReunion: undefined }, {}))).toEqual([
      'estado',
      'notaResolucion',
      'derivadaReunion',
    ]);

    const f = () => fila(raiz, 'p2', '10');
    const derivar = botonCon(f(), 'Derivar a reunión')!;
    expect(derivar.getAttribute('aria-pressed')).toBe('true');
    derivar.click();
    await esperar();
    expect(escrituras(peticiones)).toEqual([
      { metodo: 'PATCH', url: `/api/sugerencias/${p2.sugerenciaId}`, cuerpo: { estado: 'aceptada', notaResolucion: 'Nota previa', derivadaReunion: false } },
    ]);
    expect(botonCon(f(), 'Derivar a reunión')!.getAttribute('aria-pressed')).toBe('false');

    botonCon(f(), 'Nota de resolución')!.click();
    const nota = f().querySelector<HTMLTextAreaElement>('textarea[name="nota"]')!;
    expect(nota.value).toBe('Nota previa');
    nota.value = 'Se acepta con <b>reparos</b>';
    botonCon(f(), 'Guardar nota')!.click();
    await esperar();
    botonCon(f(), 'Rechazar')!.click();
    await esperar();
    expect(escrituras(peticiones).slice(1).map((p) => p.cuerpo)).toEqual([
      { estado: 'aceptada', notaResolucion: 'Se acepta con <b>reparos</b>', derivadaReunion: false },
      { estado: 'rechazada', notaResolucion: 'Se acepta con <b>reparos</b>', derivadaReunion: false },
    ]);
    expect(f().querySelector('.estado')!.textContent).toBe('Rechazada');
    // La nota se muestra como texto, nunca como HTML.
    expect(f().querySelector('.nota-resolucion')!.textContent).toContain('Se acepta con <b>reparos</b>');
    expect(f().querySelector('.nota-resolucion b')).toBeNull();
  });

  it('fila colapsada decide todas las identicas', async () => {
    const datos = aportes();
    datos.sugerencias = datos.sugerencias.filter((s) => s.usuarioId !== 20); // Norte = Sur en p1
    const { raiz, peticiones } = await montarVista({ datos });
    const colapsada = fila(raiz, 'p1', '43,0');
    expect(colapsada.querySelectorAll('.chip-lab')).toHaveLength(2);
    botonCon(colapsada, 'Aceptar')!.click();
    await esperar();
    const ps = escrituras(peticiones);
    expect(ps.map((p) => p.url).sort()).toEqual([`/api/sugerencias/${idFila(datos, 12, 'p1')}`, `/api/sugerencias/${idFila(datos, 15, 'p1')}`].sort());
    expect(ps.every((p) => (p.cuerpo as { estado: string }).estado === 'aceptada')).toBe(true);
    expect(raiz.querySelector('.confirmacion-conflicto:not([hidden])')).toBeNull();
    expect(fila(raiz, 'p1', '43,0').querySelector('.estado')!.textContent).toBe('Aceptada');
    // El documento dibuja la propuesta repetida una sola vez, con los dos laboratorios.
    const marcas = [...raiz.querySelectorAll<HTMLElement>('.editor .rev-insertado')].filter((n) => n.textContent === '43,0');
    expect(marcas).toHaveLength(1);
    expect(marcas[0].title).toBe('Laboratorio Norte, Laboratorio Sur');
  });

  it('decision de grupo envía todos los miembros y avisa fallos parciales', async () => {
    const datos = aportesMovido();
    const [primero, segundo] = datos.sugerencias;
    expect(datos.sugerencias).toHaveLength(2);
    let fallar = true;
    const { raiz, peticiones } = await montarVista({
      base: BASE_MOVIDO,
      datos,
      responder: (p) => {
        if (p.metodo === 'PATCH' && p.url === `/api/sugerencias/${segundo.sugerenciaId}` && fallar) {
          fallar = false;
          return error(500, 'error_interno');
        }
        return undefined;
      },
    });
    const tarjeta = () => raiz.querySelector<HTMLElement>('.panel-bloques .fila-propuesta')!;
    botonCon(tarjeta(), 'Aceptar')!.click();
    await esperar();
    expect(escrituras(peticiones).map((p) => p.url).sort()).toEqual(
      [`/api/sugerencias/${primero.sugerenciaId}`, `/api/sugerencias/${segundo.sugerenciaId}`].sort(),
    );
    // Uno falló: la tarjeta lo dice, ofrece reintentar y no muestra el grupo como decidido.
    const fallo = tarjeta().querySelector<HTMLElement>('.fallo-decision')!;
    expect(fallo.getAttribute('role')).toBe('alert');
    expect(fallo.textContent).toMatch(/no se guard/i);
    expect(tarjeta().querySelector('.estado')!.textContent).toMatch(/a medias/i);
    expect(tarjeta().querySelector('.estado')!.textContent).not.toBe('Aceptada');

    botonCon(tarjeta(), 'Reintentar')!.click();
    await esperar();
    const reintento = escrituras(peticiones).slice(2);
    expect(reintento).toEqual([
      { metodo: 'PATCH', url: `/api/sugerencias/${segundo.sugerenciaId}`, cuerpo: { estado: 'aceptada', notaResolucion: null, derivadaReunion: false } },
    ]);
    expect(tarjeta().querySelector('.fallo-decision')).toBeNull();
    expect(tarjeta().querySelector('.estado')!.textContent).toBe('Aceptada');
  });

  it('conflicto no permite aceptar dos laboratorios', async () => {
    const confirmar = vi.spyOn(window, 'confirm');
    const datos = aportes();
    datos.sugerencias.find((s) => s.usuarioId === 12 && s.bloqueId === 'p3')!.estado = 'aceptada';
    const { raiz, peticiones } = await montarVista({ datos });

    // p1: aceptar la de Centro pide confirmación en la página y deja Norte y Sur «por rechazar».
    botonCon(columna(raiz, 'p1', '44,0'), 'Aceptar')!.click();
    await esperar();
    expect(escrituras(peticiones)).toEqual([]);
    const caja = raiz.querySelector<HTMLElement>('.confirmacion-conflicto')!;
    expect(caja.hidden).toBe(false);
    expect(caja.textContent).toContain('Laboratorio Norte');
    expect(caja.textContent).toContain('Laboratorio Sur');
    expect(columna(raiz, 'p1', '43,0').classList.contains('por-rechazar')).toBe(true);
    expect(columna(raiz, 'p1', '43,0').textContent).toContain('Por rechazar');
    botonCon(caja, 'Confirmar')!.click();
    await esperar();
    const cuerpos = new Map(escrituras(peticiones).map((p) => [p.url, (p.cuerpo as { estado: string }).estado]));
    expect(cuerpos).toEqual(
      new Map([
        [`/api/sugerencias/${idFila(datos, 20, 'p1')}`, 'aceptada'],
        [`/api/sugerencias/${idFila(datos, 12, 'p1')}`, 'rechazada'],
        [`/api/sugerencias/${idFila(datos, 15, 'p1')}`, 'rechazada'],
      ]),
    );
    expect(raiz.querySelector('.confirmacion-conflicto:not([hidden])')).toBeNull();

    // p3: la de Norte ya estaba aceptada; aceptar la de Centro también pide rechazarla. Cancelar no envía nada.
    const antes = escrituras(peticiones).length;
    botonCon(fila(raiz, 'p3', 'último'), 'Aceptar')!.click();
    await esperar();
    expect(raiz.querySelector<HTMLElement>('.confirmacion-conflicto')!.textContent).toContain('Laboratorio Norte');
    expect(fila(raiz, 'p3', 'inicial').textContent).toContain('Por rechazar');
    botonCon(raiz.querySelector<HTMLElement>('.confirmacion-conflicto')!, 'Cancelar')!.click();
    await esperar();
    expect(escrituras(peticiones)).toHaveLength(antes);
    expect(fila(raiz, 'p3', 'inicial').textContent).not.toContain('Por rechazar');
    expect(fila(raiz, 'p3', 'inicial').querySelector('.estado')!.textContent).toBe('Aceptada');
    expect(confirmar).not.toHaveBeenCalled();
  });

  it('marcar como modificada vale en cualquier fila y decide todas las identicas', async () => {
    const datos = aportes();
    datos.sugerencias = datos.sugerencias.filter((s) => s.usuarioId !== 20); // Norte = Sur en p1, sin conflicto
    const { raiz, peticiones } = await montarVista({ datos });
    const MODIFICADA = 'Marcar como modificada (redacción propia)';
    // Fila de un solo laboratorio (p3, Norte): también tiene la acción.
    expect(botonCon(fila(raiz, 'p3', 'inicial'), MODIFICADA)).toBeDefined();

    botonCon(fila(raiz, 'p1', '43,0'), MODIFICADA)!.click();
    await esperar();
    const ps = escrituras(peticiones);
    expect(ps.map((p) => p.url).sort()).toEqual([`/api/sugerencias/${idFila(datos, 12, 'p1')}`, `/api/sugerencias/${idFila(datos, 15, 'p1')}`].sort());
    expect(ps.map((p) => p.cuerpo)).toEqual([
      { estado: 'modificada', notaResolucion: null, derivadaReunion: false },
      { estado: 'modificada', notaResolucion: null, derivadaReunion: false },
    ]);
    const f = fila(raiz, 'p1', '43,0');
    expect(f.querySelector('.estado')!.textContent).toBe('Modificada');
    expect(botonCon(f, MODIFICADA)!.getAttribute('aria-pressed')).toBe('true');
  });

  it('tarjeta de grupo movido muestra una sola accion', async () => {
    const datos = aportesMovido();
    const { raiz, peticiones } = await montarVista({ base: BASE_MOVIDO, datos });
    const tarjetas = [...raiz.querySelectorAll<HTMLElement>('.panel-bloques .fila-propuesta')];
    expect(tarjetas).toHaveLength(1);
    const [t] = tarjetas;
    expect(t.querySelector('.etiqueta-tipo')!.textContent).toBe('Bloque movido');
    expect(t.textContent).toContain('42,00');
    expect([...t.querySelectorAll('button')].filter((b) => b.textContent === 'Aceptar')).toHaveLength(1);
    expect([...t.querySelectorAll('button')].filter((b) => b.textContent === 'Rechazar')).toHaveLength(1);
    botonCon(t, 'Rechazar')!.click();
    await esperar();
    expect(escrituras(peticiones).map((p) => [p.url, (p.cuerpo as { estado: string }).estado]).sort()).toEqual(
      datos.sugerencias.map((s) => [`/api/sugerencias/${s.sugerenciaId}`, 'rechazada']).sort(),
    );
  });

  it('comentario se marca resuelto con nota y se reabre', async () => {
    const { raiz, peticiones } = await montarVista();
    const com = () => raiz.querySelector<HTMLElement>('.panel-bloques [data-bloque="p2"] .comentario')!;
    com().querySelector<HTMLTextAreaElement>('textarea[name="nota-comentario"]')!.value = 'Se confirma: 5 minutos.';
    botonCon(com(), 'Marcar como resuelto')!.click();
    await esperar();
    expect(escrituras(peticiones)).toEqual([
      { metodo: 'PATCH', url: '/api/comentarios/5/resolucion', cuerpo: { estado: 'resuelto', notaResolucion: 'Se confirma: 5 minutos.' } },
    ]);
    expect(com().querySelector('.estado')!.textContent).toBe('Resuelto');
    botonCon(com(), 'Reabrir')!.click();
    await esperar();
    expect(escrituras(peticiones)[1].cuerpo).toEqual({ estado: 'abierto', notaResolucion: 'Se confirma: 5 minutos.' });
    expect(com().querySelector('.estado')!.textContent).toBe('Abierto');
  });
});
