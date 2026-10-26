import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Comentario } from '../../../src/app/tipos-api';
import type { DocJSON } from '../../../src/tipos';
import { doc, parrafo } from '../../ayudantes-doc';
import { error, json } from '../ayudas';
import { botonTexto, escribirCampo, montarVista, posDe, relojFalso, type Escenario } from './escenario';

const BASE = doc(parrafo('p1', 'Uno dos tres.'), parrafo('p2', 'Cuatro.'));
const ESPECIAL: DocJSON = { type: 'especial', attrs: { bid: 'e1', latex: '\\begin{raro}x\\end{raro}' } };
const vistas: { desmontar(): void | Promise<void> }[] = [];

function montar(esc: Escenario) {
  const r = montarVista(esc);
  vistas.push(r.vista);
  return r;
}

const PROPIO: Comentario = {
  id: 5,
  bloqueId: 'p1',
  rango: { desde: 2, hasta: 3 },
  texto: 'Revisar este término.',
  estado: 'abierto',
  creado: '2026-11-03T15:00:00Z',
};

const seccion = (raiz: HTMLElement) => raiz.querySelector('.comentarios-lab') as HTMLElement;
const itemsComentario = (raiz: HTMLElement) => [...raiz.querySelectorAll<HTMLElement>('.comentario-item')];

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

describe('comentarios del laboratorio', () => {
  it('comentar seleccion envia bloqueId y rango', async () => {
    const { vista, raiz, llamadas } = montar({ base: BASE });
    await vista.listo;
    const ed = vista.editor()!;
    const p = posDe(ed, 'dos');
    ed.commands.setTextSelection({ from: p, to: p + 3 });
    botonTexto(raiz, 'Comentar')!.click();
    const form = raiz.querySelector('.comentario-nuevo') as HTMLElement;
    expect(form.hidden).toBe(false);
    expect(form.textContent).toContain('dos');
    escribirCampo(form.querySelector('textarea') as HTMLTextAreaElement, 'Debería decir «dos y medio».');
    botonTexto(form, 'Guardar comentario')!.click();
    await vi.advanceTimersByTimeAsync(0);
    const posts = llamadas.filter((l) => l.metodo === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('/api/capitulos/3/comentarios');
    expect(posts[0].cuerpo).toEqual({ bloqueId: 'p1', rango: { desde: 2, hasta: 3 }, texto: 'Debería decir «dos y medio».' });
    expect(form.hidden).toBe(true);
    const items = itemsComentario(raiz);
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('dos y medio');
    // Anclado visualmente a su bloque en el editor.
    const ancla = raiz.querySelector('.ProseMirror .comentario-ancla') as HTMLElement;
    expect(ancla?.textContent).toBe('dos');
  });

  it('comentar sin seleccion avisa y no envia nada', async () => {
    const { vista, raiz, llamadas } = montar({ base: BASE });
    await vista.listo;
    const ed = vista.editor()!;
    ed.commands.setTextSelection(posDe(ed, 'dos'));
    botonTexto(raiz, 'Comentar')!.click();
    const aviso = seccion(raiz).querySelector('.aviso-comentar[role="alert"]') as HTMLElement;
    expect(aviso.hidden).toBe(false);
    expect(aviso.textContent).toContain('Seleccione');
    expect(llamadas.filter((l) => l.metodo === 'POST')).toHaveLength(0);
  });

  it('comentario que no se pudo enviar conserva el texto y se reintenta', async () => {
    let fallar = true;
    const { vista, raiz, llamadas } = montar({
      base: BASE,
      manejar: (l) => (l.metodo === 'POST' && fallar ? error(500, 'error_interno') : undefined),
    });
    await vista.listo;
    const ed = vista.editor()!;
    const p = posDe(ed, 'tres');
    ed.commands.setTextSelection({ from: p, to: p + 4 });
    botonTexto(raiz, 'Comentar')!.click();
    const form = raiz.querySelector('.comentario-nuevo') as HTMLElement;
    const area = form.querySelector('textarea') as HTMLTextAreaElement;
    escribirCampo(area, 'No se pierde.');
    botonTexto(form, 'Guardar comentario')!.click();
    await vi.advanceTimersByTimeAsync(0);
    const alerta = form.querySelector('[role="alert"]') as HTMLElement;
    expect(alerta.hidden).toBe(false);
    expect(alerta.textContent).toContain('No se pudo guardar el comentario');
    expect(area.value).toBe('No se pierde.');
    expect(localStorage.getItem('mm:comentarios:12:3:7')).toContain('No se pierde.');
    fallar = false;
    botonTexto(form, 'Guardar comentario')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(llamadas.filter((l) => l.metodo === 'POST')).toHaveLength(2);
    expect(form.hidden).toBe(true);
    expect(localStorage.getItem('mm:comentarios:12:3:7')).toBeNull();
  });

  it('editar y borrar comentario propio', async () => {
    const confirmar = vi.spyOn(window, 'confirm');
    const { vista, raiz, llamadas } = montar({ base: BASE, comentarios: [PROPIO] });
    await vista.listo;
    await vi.advanceTimersByTimeAsync(0);
    let [item] = itemsComentario(raiz);
    expect(item.textContent).toContain('Revisar este término.');
    expect(item.textContent).toContain('dos'); // el texto al que se ancla
    // Editar
    botonTexto(item, 'Editar')!.click();
    const area = item.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.value).toBe('Revisar este término.');
    escribirCampo(area, 'Revisar este término, por favor.');
    botonTexto(item, 'Guardar')!.click();
    await vi.advanceTimersByTimeAsync(0);
    const patch = llamadas.find((l) => l.metodo === 'PATCH')!;
    expect(patch.url).toBe('/api/comentarios/5');
    expect(patch.cuerpo).toEqual({ texto: 'Revisar este término, por favor.' });
    [item] = itemsComentario(raiz);
    expect(item.querySelector('textarea')).toBeNull();
    expect(item.textContent).toContain('por favor.');
    // Borrar: pide confirmación en la página (no confirm()).
    botonTexto(item, 'Borrar')!.click();
    expect(llamadas.filter((l) => l.metodo === 'DELETE')).toHaveLength(0);
    expect(item.textContent).toContain('¿Borrar este comentario?');
    botonTexto(item, 'No')!.click();
    expect(itemsComentario(raiz)).toHaveLength(1);
    botonTexto(itemsComentario(raiz)[0], 'Borrar')!.click();
    botonTexto(itemsComentario(raiz)[0], 'Sí, borrar')!.click();
    await vi.advanceTimersByTimeAsync(0);
    const del = llamadas.filter((l) => l.metodo === 'DELETE');
    expect(del).toHaveLength(1);
    expect(del[0].url).toBe('/api/comentarios/5');
    expect(itemsComentario(raiz)).toHaveLength(0);
    expect(confirmar).not.toHaveBeenCalled();
  });

  it('error al borrar un comentario es visible y lo conserva', async () => {
    const { vista, raiz } = montar({
      base: BASE,
      comentarios: [PROPIO],
      manejar: (l) => (l.metodo === 'DELETE' ? error(500, 'error_interno') : undefined),
    });
    await vista.listo;
    await vi.advanceTimersByTimeAsync(0);
    botonTexto(itemsComentario(raiz)[0], 'Borrar')!.click();
    botonTexto(itemsComentario(raiz)[0], 'Sí, borrar')!.click();
    await vi.advanceTimersByTimeAsync(0);
    const items = itemsComentario(raiz);
    expect(items).toHaveLength(1);
    const alerta = items[0].querySelector('[role="alert"]') as HTMLElement;
    expect(alerta.hidden).toBe(false);
    expect(alerta.textContent).toContain('No se pudo borrar');
  });

  it('comentario en bloque especial', async () => {
    const { vista, raiz, llamadas } = montar({ base: doc(parrafo('p1', 'Uno.'), ESPECIAL, parrafo('p2', 'Dos.')) });
    await vista.listo;
    const ed = vista.editor()!;
    let pos = -1;
    ed.state.doc.descendants((n, p) => {
      if (n.type.name === 'especial') pos = p;
    });
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)));
    botonTexto(raiz, 'Comentar')!.click();
    const form = raiz.querySelector('.comentario-nuevo') as HTMLElement;
    expect(form.hidden).toBe(false);
    escribirCampo(form.querySelector('textarea') as HTMLTextAreaElement, 'Este entorno no se entiende.');
    botonTexto(form, 'Guardar comentario')!.click();
    await vi.advanceTimersByTimeAsync(0);
    const post = llamadas.find((l) => l.metodo === 'POST')!;
    expect(post.cuerpo).toEqual({ bloqueId: 'e1', rango: { desde: 0, hasta: 1 }, texto: 'Este entorno no se entiende.' });
    // El bloque especial sigue intacto y queda marcado como comentado.
    expect(JSON.stringify(ed.getJSON())).toContain('\\\\begin{raro}');
    expect(raiz.querySelector('.ProseMirror [data-tipo="especial"].comentario-ancla-bloque')).not.toBeNull();
  });

  it('en solo lectura no se comenta ni se editan comentarios, pero se ven', async () => {
    const { vista, raiz } = montar({ base: BASE, etapa: 'preparacion', comentarios: [PROPIO] });
    await vista.listo;
    await vi.advanceTimersByTimeAsync(0);
    expect(botonTexto(raiz, 'Comentar')!.disabled).toBe(true);
    const [item] = itemsComentario(raiz);
    expect(item.textContent).toContain('Revisar este término.');
    expect(botonTexto(item, 'Editar')!.disabled).toBe(true);
    expect(botonTexto(item, 'Borrar')!.disabled).toBe(true);
  });

  it('edicion recuperada de un comentario que ya no existe se conserva y se ofrece para copiar', async () => {
    localStorage.setItem('mm:comentarios:12:3:7', JSON.stringify({ ediciones: { '9': 'Texto editado.' } }));
    const { vista, raiz } = montar({ base: BASE, comentarios: [PROPIO] });
    await vista.listo;
    await vi.advanceTimersByTimeAsync(0);
    const caja = raiz.querySelector('.ediciones-huerfanas') as HTMLElement;
    expect(caja.hidden).toBe(false);
    expect((caja.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Texto editado.');
    // Otra escritura del borrador no la borra.
    const ed = vista.editor()!;
    const p = posDe(ed, 'dos');
    ed.commands.setTextSelection({ from: p, to: p + 3 });
    botonTexto(raiz, 'Comentar')!.click();
    escribirCampo(raiz.querySelector('.comentario-nuevo textarea') as HTMLTextAreaElement, 'Otro.');
    botonTexto(raiz.querySelector('.comentario-nuevo') as HTMLElement, 'Cancelar')!.click();
    expect(localStorage.getItem('mm:comentarios:12:3:7')).toContain('Texto editado.');
    botonTexto(caja, 'Descartar')!.click();
    expect(caja.hidden).toBe(true);
    expect(localStorage.getItem('mm:comentarios:12:3:7')).toBeNull();
  });

  it('edicion recuperada se conserva si fallo la carga de comentarios', async () => {
    localStorage.setItem('mm:comentarios:12:3:7', JSON.stringify({ ediciones: { '5': 'Editado sin enviar.' } }));
    let fallar = true;
    const { vista, raiz } = montar({
      base: BASE,
      comentarios: [PROPIO],
      manejar: (l) => (l.metodo === 'GET' && l.url.endsWith('/comentarios') && fallar ? error(500, 'error_interno') : undefined),
    });
    await vista.listo;
    await vi.advanceTimersByTimeAsync(0);
    const ed = vista.editor()!;
    const p = posDe(ed, 'dos');
    ed.commands.setTextSelection({ from: p, to: p + 3 });
    botonTexto(raiz, 'Comentar')!.click();
    escribirCampo(raiz.querySelector('.comentario-nuevo textarea') as HTMLTextAreaElement, 'Otro.');
    expect(localStorage.getItem('mm:comentarios:12:3:7')).toContain('Editado sin enviar.');
    expect((raiz.querySelector('.ediciones-huerfanas') as HTMLElement).hidden).toBe(true);
    fallar = false;
    botonTexto(seccion(raiz), 'Reintentar')!.click();
    await vi.advanceTimersByTimeAsync(0);
    const [item] = itemsComentario(raiz);
    expect((item.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Editado sin enviar.');
  });

  it('comentario creado antes de que cargue la lista no se pierde', async () => {
    let soltar!: () => void;
    const espera = new Promise<void>((r) => (soltar = r));
    const { vista, raiz } = montar({
      base: BASE,
      comentarios: [PROPIO],
      manejar: async (l) => {
        if (l.metodo === 'GET' && l.url.endsWith('/comentarios')) {
          await espera;
          return json(200, [PROPIO]);
        }
        return undefined;
      },
    });
    await vista.listo;
    expect(vista.editor()!.isEditable).toBe(true); // el editor no espera a los comentarios
    const ed = vista.editor()!;
    const p = posDe(ed, 'tres');
    ed.commands.setTextSelection({ from: p, to: p + 4 });
    botonTexto(raiz, 'Comentar')!.click();
    escribirCampo(raiz.querySelector('.comentario-nuevo textarea') as HTMLTextAreaElement, 'Temprano.');
    botonTexto(raiz.querySelector('.comentario-nuevo') as HTMLElement, 'Guardar comentario')!.click();
    await vi.advanceTimersByTimeAsync(0);
    soltar();
    await vi.advanceTimersByTimeAsync(0);
    const textos = itemsComentario(raiz).map((i) => i.textContent);
    expect(textos).toHaveLength(2);
    expect(textos.join('|')).toContain('Temprano.');
    expect(textos.join('|')).toContain('Revisar este término.');
  });

  it('borrador de comentarios anterior sobrevive si se comenta antes de que cargue la lista', async () => {
    const CLAVE_C = 'mm:comentarios:12:3:7';
    localStorage.setItem(
      CLAVE_C,
      JSON.stringify({
        nuevo: { bloqueId: 'p2', rango: { desde: 0, hasta: 1 }, cita: 'Cuatro', texto: 'Viejo sin enviar.' },
        ediciones: { '5': 'Edición vieja.' },
      }),
    );
    let soltar!: () => void;
    const espera = new Promise<void>((r) => (soltar = r));
    const { vista, raiz, llamadas } = montar({
      base: BASE,
      comentarios: [PROPIO],
      manejar: async (l) => {
        if (l.metodo === 'GET' && l.url.endsWith('/comentarios')) {
          await espera;
          return json(200, [PROPIO]);
        }
        return undefined;
      },
    });
    await vista.listo;
    // El comentario sin enviar se muestra ya, sin esperar a la lista.
    const form = raiz.querySelector('.comentario-nuevo') as HTMLElement;
    expect(form.hidden).toBe(false);
    expect((form.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Viejo sin enviar.');
    // Intentar otro comentario no lo pisa.
    const ed = vista.editor()!;
    const p = posDe(ed, 'dos');
    ed.commands.setTextSelection({ from: p, to: p + 3 });
    botonTexto(raiz, 'Comentar')!.click();
    expect((form.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Viejo sin enviar.');
    expect(localStorage.getItem(CLAVE_C)).toContain('Viejo sin enviar.');
    // Se envía el viejo y se empieza uno nuevo, todo antes de que llegue la lista.
    botonTexto(form, 'Guardar comentario')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect((llamadas.find((l) => l.metodo === 'POST')!.cuerpo as { texto: string }).texto).toBe('Viejo sin enviar.');
    ed.commands.setTextSelection({ from: p, to: p + 3 });
    botonTexto(raiz, 'Comentar')!.click();
    escribirCampo(form.querySelector('textarea') as HTMLTextAreaElement, 'Nuevo.');
    const borrador = localStorage.getItem(CLAVE_C)!;
    expect(borrador).toContain('Nuevo.');
    expect(borrador).toContain('Edición vieja.');
    // Llega la lista: la edición vieja aparece en su comentario y el nuevo sigue en el formulario.
    soltar();
    await vi.advanceTimersByTimeAsync(0);
    const item = itemsComentario(raiz).find((i) => i.dataset.id === '5')!;
    expect((item.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Edición vieja.');
    expect((form.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Nuevo.');
  });
});
