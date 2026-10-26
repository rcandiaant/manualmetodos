import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calcularSugerencias } from '../../../src/cambios/sugerencias';
import type { SugerenciaServidor } from '../../../src/app/tipos-api';
import type { DocJSON } from '../../../src/tipos';
import { doc, parrafo } from '../../ayudantes-doc';
import { error } from '../ayudas';
import { botonTexto, escribirCampo, montarVista, posDe, relojFalso, salirCampo, type Escenario } from './escenario';

const BASE = doc(parrafo('p1', 'Uno.'), parrafo('p2', 'Dos.'), parrafo('p3', 'Tres.'));
const vistas: { desmontar(): void | Promise<void> }[] = [];

function montar(esc: Escenario) {
  const r = montarVista(esc);
  vistas.push(r.vista);
  return r;
}

/** Copia guardada en el servidor, con sus sugerencias (y motivos opcionales por índice). */
function copiaGuardada(copia: DocJSON, motivos: Record<number, string> = {}) {
  const sugerencias: SugerenciaServidor[] = calcularSugerencias(BASE, copia, 'u12').map((s, i) =>
    motivos[i] !== undefined ? { ...s, motivo: motivos[i], estado: 'pendiente' } : { ...s, estado: 'pendiente' },
  );
  return { docJson: copia, actualizado: '2026-11-03T15:59:50Z', versionId: 7, sugerencias };
}

const unidadesPanel = (raiz: HTMLElement) => [...raiz.querySelectorAll<HTMLElement>('.cambio-unidad')];
const campoMotivo = (u: HTMLElement) => u.querySelector('textarea.motivo-cambio') as HTMLTextAreaElement;

beforeEach(() => {
  relojFalso();
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => {
  for (const v of vistas.splice(0)) await v.desmontar();
  vi.useRealTimers();
  localStorage.clear();
  document.body.replaceChildren();
});

describe('panel del laboratorio: mis cambios', () => {
  it('panel agrupa bloque movido como una unidad', async () => {
    const copia = doc(parrafo('p2', 'Dos.'), parrafo('p3', 'Tres.'), parrafo('p1', 'Uno.'));
    const sugs = calcularSugerencias(BASE, copia, 'u12');
    expect(sugs.length).toBeGreaterThan(1);
    expect(sugs.every((s) => s.grupo === sugs[0].grupo && s.grupo)).toBe(true);
    const { vista, raiz } = montar({ base: BASE, copia: copiaGuardada(copia) });
    await vista.listo;
    const us = unidadesPanel(raiz);
    expect(us).toHaveLength(1);
    expect(us[0].dataset.miembros).toBe(String(sugs.length));
    expect(raiz.querySelector('.mis-cambios')?.textContent).toContain('1 cambio');
    // Clic en el cambio: resalta y desplaza el editor.
    (us[0].querySelector('.ir-cambio') as HTMLButtonElement).click();
    const marcado = raiz.querySelector('.ProseMirror .destello') as HTMLElement;
    expect(marcado).not.toBeNull();
    expect(marcado.scrollIntoView).toHaveBeenCalled();
  });

  it('motivo se guarda con PATCH al salir del campo', async () => {
    const copia = doc(parrafo('p1', 'Uno más.'), parrafo('p2', 'Dos.'), parrafo('p3', 'Tres.'));
    const [s] = calcularSugerencias(BASE, copia, 'u12');
    const { vista, raiz, llamadas } = montar({ base: BASE, copia: copiaGuardada(copia) });
    await vista.listo;
    const campo = campoMotivo(unidadesPanel(raiz)[0]);
    escribirCampo(campo, 'Aclara la unidad.');
    await vi.advanceTimersByTimeAsync(0);
    expect(llamadas.filter((l) => l.metodo === 'PATCH')).toHaveLength(0); // aún no sale del campo
    expect(raiz.querySelector('.estado-motivo')?.textContent).toContain('Sin guardar');
    salirCampo(campo);
    await vi.advanceTimersByTimeAsync(0);
    const patches = llamadas.filter((l) => l.metodo === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].url).toBe(`/api/capitulos/3/sugerencias/${encodeURIComponent(s.id)}`);
    expect(patches[0].cuerpo).toEqual({ motivo: 'Aclara la unidad.' });
    expect(raiz.querySelector('.estado-motivo')?.textContent).toContain('Motivo guardado');
    // Salir otra vez sin cambiarlo no reenvía.
    salirCampo(campo);
    await vi.advanceTimersByTimeAsync(0);
    expect(llamadas.filter((l) => l.metodo === 'PATCH')).toHaveLength(1);
  });

  it('motivo escrito antes del autoguardado viaja con la copia', async () => {
    const { vista, raiz, llamadas } = montar({ base: BASE });
    await vista.listo;
    const ed = vista.editor()!;
    ed.chain().setTextSelection(posDe(ed, 'Uno', 3)).insertContent(' más').run();
    await vi.advanceTimersByTimeAsync(400); // recalcula: el cambio aparece en el panel
    const campo = campoMotivo(unidadesPanel(raiz)[0]);
    escribirCampo(campo, 'Más claro.');
    salirCampo(campo);
    await vi.advanceTimersByTimeAsync(0);
    // La sugerencia aún no existe en el servidor: no hay PATCH; se pide guardar la copia.
    await vi.advanceTimersByTimeAsync(3000);
    const puts = llamadas.filter((l) => l.metodo === 'PUT');
    expect(puts).toHaveLength(1);
    const enviadas = (puts[0].cuerpo as { sugerencias: { motivo?: string }[] }).sugerencias;
    expect(enviadas[0].motivo).toBe('Más claro.');
    expect(llamadas.filter((l) => l.metodo === 'PATCH')).toHaveLength(0);
    expect(raiz.querySelector('.estado-motivo')?.textContent).toContain('Motivo guardado');
  });

  it('motivo que no se pudo guardar queda visible y se puede reintentar', async () => {
    const copia = doc(parrafo('p1', 'Uno más.'), parrafo('p2', 'Dos.'), parrafo('p3', 'Tres.'));
    let fallar = true;
    const { vista, raiz, llamadas } = montar({
      base: BASE,
      copia: copiaGuardada(copia),
      manejar: (l) => (l.metodo === 'PATCH' && fallar ? error(500, 'error_interno') : undefined),
    });
    await vista.listo;
    const campo = campoMotivo(unidadesPanel(raiz)[0]);
    escribirCampo(campo, 'Importante.');
    salirCampo(campo);
    await vi.advanceTimersByTimeAsync(0);
    const alerta = raiz.querySelector('.error-motivo[role="alert"]') as HTMLElement;
    expect(alerta.hidden).toBe(false);
    expect(alerta.textContent).toContain('No se pudo guardar el motivo');
    expect(campo.value).toBe('Importante.');
    // El texto queda también en el borrador local.
    expect(localStorage.getItem('mm:motivos:12:3:7')).toContain('Importante.');
    fallar = false;
    botonTexto(alerta, 'Reintentar')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(llamadas.filter((l) => l.metodo === 'PATCH')).toHaveLength(2);
    expect(alerta.hidden).toBe(true);
    expect(localStorage.getItem('mm:motivos:12:3:7')).toBeNull();
  });

  it('motivo de un cambio cuyo uid cambia se traslada al cambio nuevo', async () => {
    const copia = doc(parrafo('p1', 'Uno más.'), parrafo('p2', 'Dos.'), parrafo('p3', 'Tres.'));
    const { vista, raiz, llamadas } = montar({ base: BASE, copia: copiaGuardada(copia, { 0: 'Motivo viejo.' }) });
    await vista.listo;
    expect(campoMotivo(unidadesPanel(raiz)[0]).value).toBe('Motivo viejo.');
    const ed = vista.editor()!;
    ed.chain().setTextSelection(posDe(ed, 'más', 3)).insertContent(' aún').run();
    await vi.advanceTimersByTimeAsync(400);
    expect(campoMotivo(unidadesPanel(raiz)[0]).value).toBe('Motivo viejo.');
    await vi.advanceTimersByTimeAsync(3000);
    const put = llamadas.find((l) => l.metodo === 'PUT')!;
    expect((put.cuerpo as { sugerencias: { motivo?: string }[] }).sugerencias[0].motivo).toBe('Motivo viejo.');
  });

  it('motivo de un cambio que desaparece queda visible como motivo sin cambio', async () => {
    const copia = doc(parrafo('p1', 'Uno más.'), parrafo('p2', 'Dos.'), parrafo('p3', 'Tres.'));
    const { vista, raiz } = montar({ base: BASE, copia: copiaGuardada(copia, { 0: 'Se perdería.' }) });
    await vista.listo;
    const ed = vista.editor()!;
    const p = posDe(ed, ' más');
    ed.chain().deleteRange({ from: p, to: p + 4 }).run();
    await vi.advanceTimersByTimeAsync(400);
    expect(unidadesPanel(raiz)).toHaveLength(0);
    const huerfanos = raiz.querySelector('.motivos-huerfanos') as HTMLElement;
    expect(huerfanos.hidden).toBe(false);
    expect((huerfanos.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Se perdería.');
    botonTexto(huerfanos, 'Descartar')!.click();
    expect(huerfanos.hidden).toBe(true);
  });

  it('motivo obligatorio marca cambios sin motivo sin bloquear el guardado', async () => {
    const { vista, raiz, llamadas } = montar({ base: BASE, motivoObligatorio: true });
    await vista.listo;
    const ed = vista.editor()!;
    ed.chain().setTextSelection(posDe(ed, 'Uno', 3)).insertContent(' A').run();
    ed.chain().setTextSelection(posDe(ed, 'Tres', 4)).insertContent(' B').run();
    await vi.advanceTimersByTimeAsync(400);
    const us = unidadesPanel(raiz);
    expect(us).toHaveLength(2);
    expect(us.every((u) => u.classList.contains('sin-motivo'))).toBe(true);
    expect(raiz.querySelector('.contador-sin-motivo')?.textContent).toBe('2 cambios sin motivo');
    // El guardado no se bloquea.
    await vi.advanceTimersByTimeAsync(3000);
    expect(llamadas.filter((l) => l.metodo === 'PUT')).toHaveLength(1);
    // Con motivo, deja de estar marcado.
    const campo = campoMotivo(us[0]);
    escribirCampo(campo, 'Porque sí.');
    salirCampo(campo);
    await vi.advanceTimersByTimeAsync(0);
    expect(us[0].classList.contains('sin-motivo')).toBe(false);
    expect(raiz.querySelector('.contador-sin-motivo')?.textContent).toBe('1 cambio sin motivo');
  });

  it('en solo lectura los motivos no se editan pero la lista sigue visible', async () => {
    const copia = doc(parrafo('p1', 'Uno más.'), parrafo('p2', 'Dos.'), parrafo('p3', 'Tres.'));
    const { vista, raiz } = montar({
      base: BASE,
      copia: copiaGuardada(copia),
      manejar: (l) => (l.metodo === 'PUT' ? error(409, 'etapa_no_permite') : undefined),
    });
    await vista.listo;
    const ed = vista.editor()!;
    ed.chain().setTextSelection(posDe(ed, 'Dos', 3)).insertContent('!').run();
    await vi.advanceTimersByTimeAsync(3000);
    expect(ed.isEditable).toBe(false);
    const us = unidadesPanel(raiz);
    expect(us.length).toBeGreaterThan(0);
    expect(us.every((u) => campoMotivo(u).readOnly)).toBe(true);
  });
});

describe('panel del laboratorio: edicion final', () => {
  it('edicion final muestra estados y notas de mis aportes', async () => {
    const copia = doc(parrafo('p1', 'Uno más.'), parrafo('p2', 'Dos!'), parrafo('p3', 'Tres.'));
    const sugs = calcularSugerencias(BASE, copia, 'u12');
    expect(sugs).toHaveLength(2);
    const { vista, raiz, llamadas } = montar({
      base: BASE,
      etapa: 'edicion_final',
      copia: copiaGuardada(copia),
      aportes: {
        sugerencias: [
          { ...sugs[0], motivo: 'Más claro.', estado: 'aceptada', notaResolucion: 'Se incorpora.', derivadaReunion: false },
          { ...sugs[1], estado: 'pendiente', notaResolucion: null, derivadaReunion: true },
        ],
        comentarios: [
          {
            id: 5,
            bloqueId: 'p3',
            rango: { desde: 0, hasta: 1 },
            texto: 'Revisar la cita.',
            estado: 'resuelto',
            creado: '2026-11-04T10:00:00Z',
            notaResolucion: 'Cita corregida.',
          },
        ],
      },
    });
    await vista.listo;
    await vi.advanceTimersByTimeAsync(0);
    expect(llamadas.some((l) => l.metodo === 'GET' && l.url === '/api/capitulos/3/mis-aportes')).toBe(true);
    const caja = raiz.querySelector('.mis-aportes') as HTMLElement;
    const aportes = [...caja.querySelectorAll<HTMLElement>('.aporte')];
    expect(aportes).toHaveLength(3);
    expect(aportes[0].querySelector('.estado-aporte')?.textContent).toBe('Aceptado');
    expect(aportes[0].textContent).toContain('Se incorpora.');
    expect(aportes[0].textContent).toContain('Más claro.');
    expect(aportes[1].querySelector('.estado-aporte')?.textContent).toBe('Derivado a reunión');
    expect(aportes[2].querySelector('.estado-aporte')?.textContent).toBe('Resuelto');
    expect(aportes[2].textContent).toContain('Revisar la cita.');
    expect(aportes[2].textContent).toContain('Cita corregida.');
    // En edicion_final no se editan motivos.
    expect(raiz.querySelector('textarea.motivo-cambio:not([readonly])')).toBeNull();
  });

  it('error al cargar mis aportes es visible y se puede reintentar', async () => {
    let fallar = true;
    const { vista, raiz } = montar({
      base: BASE,
      etapa: 'edicion_final',
      manejar: (l) => (l.url.endsWith('/mis-aportes') && fallar ? error(500, 'error_interno') : undefined),
    });
    await vista.listo;
    await vi.advanceTimersByTimeAsync(0);
    const alerta = raiz.querySelector('.mis-aportes [role="alert"]') as HTMLElement;
    expect(alerta.hidden).toBe(false);
    fallar = false;
    botonTexto(alerta, 'Reintentar')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(alerta.hidden).toBe(true);
    expect(raiz.querySelector('.mis-aportes')?.textContent).toContain('no tiene aportes');
  });
});


describe('panel del laboratorio: borradores tras el cierre', () => {
  const MOTIVOS = 'mm:motivos:12:3:7';
  const COMENTARIOS = 'mm:comentarios:12:3';
  function sembrarBorradores() {
    localStorage.setItem(MOTIVOS, JSON.stringify({ 'u12:p1:x': { texto: 'Motivo perdido.', bloqueId: 'p1' } }));
    localStorage.setItem(
      COMENTARIOS,
      JSON.stringify({
        nuevo: { bloqueId: 'p1', rango: { desde: 0, hasta: 1 }, cita: 'Uno', texto: 'Comentario perdido.' },
        ediciones: { '5': 'Edición perdida.' },
      }),
    );
  }

  it('tras el cierre los motivos y comentarios sin enviar se ofrecen para copiar', async () => {
    sembrarBorradores();
    const { vista, raiz } = montar({ base: BASE, etapa: 'edicion_final' });
    await vista.listo;
    await vi.advanceTimersByTimeAsync(0);
    const caja = raiz.querySelector('.borradores-sin-enviar') as HTMLElement;
    expect(caja).not.toBeNull();
    expect(caja.hidden).toBe(false);
    const area = caja.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.readOnly).toBe(true);
    expect(area.value).toContain('Motivo perdido.');
    expect(area.value).toContain('Comentario perdido.');
    expect(area.value).toContain('Edición perdida.');
    expect(botonTexto(caja, 'Copiar texto')).toBeDefined();
    // Nada quedó escondido en una sección oculta.
    expect(raiz.querySelector('.comentarios-lab:not([hidden]) .comentario-nuevo')).toBeNull();
    botonTexto(caja, 'Descartar')!.click();
    expect(caja.hidden).toBe(true);
    expect(localStorage.getItem(MOTIVOS)).toBeNull();
    expect(localStorage.getItem(COMENTARIOS)).toBeNull();
  });

  it('fuera de la consulta los borradores no se borran solos', async () => {
    sembrarBorradores();
    const copia = doc(parrafo('p1', 'Uno más.'), parrafo('p2', 'Dos.'), parrafo('p3', 'Tres.'));
    const { vista, raiz } = montar({ base: BASE, etapa: 'preparacion', copia: copiaGuardada(copia) });
    await vista.listo;
    await vi.advanceTimersByTimeAsync(400);
    expect((raiz.querySelector('.borradores-sin-enviar textarea') as HTMLTextAreaElement).value).toContain('Motivo perdido.');
    expect(localStorage.getItem(MOTIVOS)).toContain('Motivo perdido.');
    expect(localStorage.getItem(COMENTARIOS)).toContain('Comentario perdido.');
  });
});
