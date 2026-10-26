import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearApi } from '../../../src/app/api';
import { claveBorrador } from '../../../src/app/laboratorio/autoguardado';
import { vistaCapitulo } from '../../../src/app/laboratorio/vista';
import type { Base, Consulta, Copia, Usuario } from '../../../src/app/tipos-api';
import { crearBarra } from '../../../src/editor/barra';
import { extensionesDemo } from '../../../src/editor/editor';
import type { DocJSON } from '../../../src/tipos';
import { doc, item, lista, parrafo, texto } from '../../ayudantes-doc';
import { error, json } from '../ayudas';

const ANA: Usuario = { id: 12, nombre: 'Ana Pérez', laboratorio: 'Lab Norte', roles: ['laboratorio'] };
const ESPECIAL: DocJSON = { type: 'especial', attrs: { bid: 'e1', latex: '\\begin{raro}x\\end{raro}' } };
const BASE_DOC = doc(parrafo('p1', 'Uno.'), parrafo('p2', 'Dos.'));
const CLAVE = claveBorrador(12, 3, 7);

const consulta = (etapa: Consulta['etapa'] = 'consulta'): Consulta => ({
  apertura: '2026-11-02T12:00:00Z',
  cierre: '2026-11-12T12:00:00Z',
  etapa,
  motivoObligatorio: false,
});

interface Escenario {
  base?: DocJSON;
  copia?: Copia;
  etapa?: Consulta['etapa'];
  /** Respuestas de PUT …/copia, en orden (por defecto 200). */
  puts?: (() => Response | Promise<Response>)[];
}

const vistas: { desmontar(): void | Promise<void> }[] = [];

function montar(esc: Escenario = {}) {
  const puts: { url: string; cuerpo: { versionId: number; docJson: DocJSON; sugerencias: unknown[] } }[] = [];
  const respuestasPut = [...(esc.puts ?? [])];
  const fetchRuta = (async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(entrada);
    const metodo = init.method ?? 'GET';
    if (metodo === 'GET' && url === '/api/capitulos/3/base') {
      return json(200, { versionId: 7, docJson: esc.base ?? BASE_DOC } satisfies Base, { ETag: '"v7"' });
    }
    if (metodo === 'GET' && url === '/api/capitulos/3/copia') return json(200, esc.copia ?? { docJson: null });
    if (metodo === 'GET' && url === '/api/consulta') return json(200, consulta(esc.etapa));
    if (metodo === 'GET' && url === '/api/capitulos/3/comentarios') return json(200, []);
    if (metodo === 'GET' && url === '/api/capitulos/3/mis-aportes') return json(200, { sugerencias: [], comentarios: [] });
    if (metodo === 'PUT' && url === '/api/capitulos/3/copia') {
      puts.push({ url, cuerpo: JSON.parse(String(init.body)) });
      const r = respuestasPut.shift();
      return r ? r() : json(200, { actualizado: '2026-11-03T15:20:00Z' });
    }
    throw new Error(`ruta inesperada ${metodo} ${url}`);
  }) as unknown as typeof fetch;
  const api = crearApi({ fetch: fetchRuta, alSinSesion: () => {} });
  const raiz = document.createElement('div');
  document.body.append(raiz);
  const vista = vistaCapitulo(api, ANA, '3', { almacen: localStorage });
  vista.montar(raiz);
  vistas.push(vista);
  return { vista, raiz, puts };
}

const botonTexto = (raiz: HTMLElement, t: string) =>
  [...raiz.querySelectorAll('button')].find((b) => b.textContent?.trim() === t);

/** Escribe `t` al comienzo del primer párrafo con texto. */
function escribir(ed: Editor, t: string) {
  let pos = -1;
  ed.state.doc.descendants((n, p) => {
    if (pos < 0 && n.type.name === 'parrafo') pos = p + 1;
  });
  ed.chain().setTextSelection(pos).insertContent(t).run();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-11-03T16:00:00Z'));
  localStorage.clear();
});
afterEach(async () => {
  for (const v of vistas.splice(0)) await v.desmontar();
  vi.useRealTimers();
  localStorage.clear();
  document.body.replaceChildren();
});

describe('vista del capítulo (laboratorio)', () => {
  it('carga base y copia, monta el editor con las marcas y guarda al editar', async () => {
    const copiaDoc = doc(parrafo('p1', 'Uno más.'), parrafo('p2', 'Dos.'));
    const { vista, raiz, puts } = montar({
      copia: { docJson: copiaDoc, actualizado: '2026-11-03T15:59:50Z', versionId: 7, sugerencias: [] },
    });
    await vista.listo;
    expect(raiz.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('true');
    expect(raiz.querySelector('.cambio-insertado')).not.toBeNull();
    expect(raiz.querySelector('.estado-guardado')?.textContent).toContain('Guardado hace 10 s');
    escribir(vista.editor()!, 'X');
    await vi.advanceTimersByTimeAsync(3000);
    expect(puts).toHaveLength(1);
    expect(raiz.querySelector('.estado-guardado')?.textContent).toContain('Guardado hace');
  });

  it('error al guardar es visible y no marca la copia como guardada', async () => {
    const { vista, raiz, puts } = montar({ puts: [() => error(422, 'documento_invalido')] });
    await vista.listo;
    escribir(vista.editor()!, 'X');
    await vi.advanceTimersByTimeAsync(3000);
    expect(puts).toHaveLength(1);
    const alerta = raiz.querySelector('[role="alert"].error-guardado') as HTMLElement;
    expect(alerta.hidden).toBe(false);
    expect(alerta.textContent).toContain('Texto del servidor.');
    expect(raiz.querySelector('.estado-guardado')?.textContent).not.toContain('Guardado hace');
    expect(localStorage.getItem(CLAVE)).not.toBeNull();
  });

  it('cierre de la consulta pasa a solo lectura', async () => {
    const { vista, raiz, puts } = montar({ puts: [() => error(409, 'etapa_no_permite')] });
    await vista.listo;
    escribir(vista.editor()!, 'Perdible');
    await vi.advanceTimersByTimeAsync(3000);
    expect(puts).toHaveLength(1);
    expect(vista.editor()!.isEditable).toBe(false);
    expect(raiz.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false');
    const alerta = raiz.querySelector('[role="alert"].error-guardado') as HTMLElement;
    expect(alerta.textContent).toContain('solo lectura');
    // El borrador no guardado se ofrece para copiar.
    const area = raiz.querySelector('textarea.borrador-texto') as HTMLTextAreaElement;
    expect(area).not.toBeNull();
    expect(area.value).toContain('Perdible');
    expect(botonTexto(raiz, 'Copiar texto')).toBeDefined();
    // Los botones de la barra quedan deshabilitados.
    expect((botonTexto(raiz, 'N') as HTMLButtonElement).disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(120000);
    expect(puts).toHaveLength(1);
  });

  it('version_obsoleta pasa a solo lectura y ofrece copiar lo no guardado', async () => {
    const { vista, raiz, puts } = montar({ puts: [() => error(409, 'version_obsoleta')] });
    await vista.listo;
    escribir(vista.editor()!, 'Huerfano');
    await vi.advanceTimersByTimeAsync(3000);
    expect(puts).toHaveLength(1);
    expect(vista.editor()!.isEditable).toBe(false);
    const alerta = raiz.querySelector('[role="alert"].error-guardado') as HTMLElement;
    expect(alerta.hidden).toBe(false);
    expect(alerta.textContent).toContain('versión del capítulo cambió');
    expect(alerta.textContent).toContain('solo lectura');
    const area = raiz.querySelector('textarea.borrador-texto') as HTMLTextAreaElement;
    expect(area.value).toContain('Huerfano');
    expect((botonTexto(raiz, 'N') as HTMLButtonElement).disabled).toBe(true);
  });

  it('salir de la pagina con un envio en curso deja en el borrador lo mas nuevo', async () => {
    let soltar!: (r: Response) => void;
    const colgado = () => new Promise<Response>((r) => (soltar = r));
    const { vista, puts } = montar({ puts: [colgado] });
    await vista.listo;
    escribir(vista.editor()!, 'A');
    await vi.advanceTimersByTimeAsync(3000);
    expect(puts).toHaveLength(1); // en curso
    escribir(vista.editor()!, 'B'); // edición nueva, aún en la espera de 300 ms
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    const b = JSON.parse(localStorage.getItem(CLAVE)!) as { docJson: DocJSON };
    expect(JSON.stringify(b.docJson)).toContain('BAUno.');
    soltar(json(200, { actualizado: '2026-11-03T15:20:00Z' }));
    await vi.advanceTimersByTimeAsync(0);
  });

  it('fuera de la etapa consulta el editor es de solo lectura', async () => {
    const { vista, raiz } = montar({ etapa: 'edicion_final' });
    await vista.listo;
    expect(vista.editor()!.isEditable).toBe(false);
    expect(raiz.textContent).toContain('solo lectura');
  });

  it('recuperar borrador mas nuevo que el servidor', async () => {
    const borradorDoc = doc(parrafo('p1', 'Uno del borrador.'), parrafo('p2', 'Dos.'));
    localStorage.setItem(
      CLAVE,
      JSON.stringify({
        docJson: borradorDoc,
        guardadoLocal: '2026-11-03T15:50:00Z',
        actualizadoServidor: '2026-11-03T14:00:00Z',
      }),
    );
    const { vista, raiz, puts } = montar({
      copia: {
        docJson: doc(parrafo('p1', 'Uno del servidor.'), parrafo('p2', 'Dos.')),
        actualizado: '2026-11-03T15:00:00Z',
        versionId: 7,
        sugerencias: [],
      },
    });
    await vista.listo;
    // Mientras no se decide, no se edita (no se pisa el borrador).
    expect(vista.editor()!.isEditable).toBe(false);
    expect(raiz.textContent).toContain('Hay cambios sin guardar en este navegador');
    botonTexto(raiz, 'Recuperar borrador no guardado')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(vista.editor()!.isEditable).toBe(true);
    expect(vista.editor()!.getText()).toContain('Uno del borrador.');
    await vi.advanceTimersByTimeAsync(3000);
    expect(puts).toHaveLength(1);
    expect(JSON.stringify(puts[0].cuerpo.docJson)).toContain('Uno del borrador.');
    expect(localStorage.getItem(CLAVE)).toBeNull();
  });

  it('descartar el borrador deja la copia del servidor', async () => {
    localStorage.setItem(
      CLAVE,
      JSON.stringify({
        docJson: doc(parrafo('p1', 'Borrador.'), parrafo('p2', 'Dos.')),
        guardadoLocal: '2026-11-03T15:50:00Z',
        actualizadoServidor: null,
      }),
    );
    const { vista, raiz, puts } = montar({
      copia: { docJson: doc(parrafo('p1', 'Servidor.'), parrafo('p2', 'Dos.')), actualizado: '2026-11-03T15:00:00Z', versionId: 7, sugerencias: [] },
    });
    await vista.listo;
    botonTexto(raiz, 'Descartarlo')!.click();
    await vi.advanceTimersByTimeAsync(3000);
    expect(vista.editor()!.getText()).toContain('Servidor.');
    expect(localStorage.getItem(CLAVE)).toBeNull();
    expect(puts).toHaveLength(0);
  });

  it('borrador sobre la misma copia del servidor (p. ej. tras sesion vencida) se recupera y guarda solo', async () => {
    localStorage.setItem(
      CLAVE,
      JSON.stringify({
        docJson: doc(parrafo('p1', 'Seguido.'), parrafo('p2', 'Dos.')),
        guardadoLocal: '2026-11-03T15:50:00Z',
        actualizadoServidor: '2026-11-03T15:00:00Z',
      }),
    );
    const { vista, raiz, puts } = montar({
      copia: { docJson: doc(parrafo('p1', 'Servidor.'), parrafo('p2', 'Dos.')), actualizado: '2026-11-03T15:00:00Z', versionId: 7, sugerencias: [] },
    });
    await vista.listo;
    await vi.advanceTimersByTimeAsync(0);
    expect(vista.editor()!.getText()).toContain('Seguido.');
    expect(raiz.textContent).toContain('Se recuperaron cambios que no alcanzaron a guardarse');
    expect(puts).toHaveLength(1);
    expect(localStorage.getItem(CLAVE)).toBeNull();
  });

  it('desmontar hace el ultimo guardado (vista)', async () => {
    const { vista, puts } = montar();
    await vista.listo;
    escribir(vista.editor()!, 'Z');
    expect(puts).toHaveLength(0);
    await vista.desmontar();
    vistas.splice(vistas.indexOf(vista), 1);
    expect(puts).toHaveLength(1);
    expect(JSON.stringify(puts[0].cuerpo.docJson)).toContain('Z');
  });

  it('especial no editable', async () => {
    const { vista, raiz } = montar({ base: doc(parrafo('p1', 'Uno.'), ESPECIAL, parrafo('p2', 'Dos.')) });
    await vista.listo;
    const ed = vista.editor()!;
    const dom = raiz.querySelector('[data-tipo="especial"]') as HTMLElement;
    expect(dom.getAttribute('contenteditable')).toBe('false');
    expect(dom.classList.contains('bloque-especial')).toBe(true);
    // Seleccionarlo y borrarlo no hace nada.
    let pos = -1;
    ed.state.doc.descendants((n, p) => {
      if (n.type.name === 'especial') pos = p;
    });
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)));
    ed.commands.deleteSelection();
    expect(JSON.stringify(jsonDe(ed))).toContain('\\\\begin{raro}');
    // Borrar un rango que lo contiene tampoco.
    ed.commands.deleteRange({ from: 3, to: ed.state.doc.content.size - 2 });
    expect(JSON.stringify(jsonDe(ed))).toContain('\\\\begin{raro}');
    // El texto de alrededor sí se edita.
    escribir(ed, 'Q');
    expect(ed.getText()).toContain('Q');
  });
});

/* ---------- Barra ---------- */

const jsonDe = (ed: Editor): DocJSON => ed.getJSON() as DocJSON;
const editores: Editor[] = [];
function editorCon(contenido: DocJSON) {
  const el = document.createElement('div');
  document.body.append(el);
  const ed = new Editor({ element: el, extensions: extensionesDemo(), content: contenido });
  editores.push(ed);
  const barra = crearBarra(ed);
  document.body.append(barra.elemento);
  return { ed, barra };
}
afterEach(() => {
  while (editores.length > 0) editores.pop()?.destroy();
});

/** Posición dentro del texto `t` (inicio + desplazamiento). */
function posDe(ed: Editor, t: string, desp = 0): number {
  let res = -1;
  ed.state.doc.descendants((n, p) => {
    if (res < 0 && n.isText && n.text?.includes(t)) res = p + n.text.indexOf(t) + desp;
  });
  return res;
}

describe('barra', () => {
  it('barra: referencia insertada es nodo atomico con la etiqueta elegida', () => {
    const { ed, barra } = editorCon(
      doc(
        lista(item('itm:a', parrafo('p1', 'Primer ítem')), item('itm:b', parrafo('p2', 'Segundo ítem'))),
        parrafo('p3', 'Ver el ítem.'),
      ),
    );
    ed.commands.setTextSelection(posDe(ed, 'Ver el ítem', 6));
    botonTexto(barra.elemento, 'Referenciar ítem')!.click();
    const opciones = [...barra.elemento.querySelectorAll('.lista-referencias button')];
    expect(opciones.map((o) => o.textContent)).toEqual([
      expect.stringContaining('itm:a'),
      expect.stringContaining('itm:b'),
    ]);
    (opciones[1] as HTMLButtonElement).click();
    let ref: { etiqueta: unknown; atomo: boolean } | null = null;
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'referencia') ref = { etiqueta: n.attrs.etiqueta, atomo: n.isAtom };
    });
    expect(ref).toEqual({ etiqueta: 'itm:b', atomo: true });
    expect(barra.elemento.querySelector('.lista-referencias')).toBeNull();
  });

  it('barra: sub y sup se excluyen', () => {
    const { ed, barra } = editorCon(doc(parrafo('p1', 'H2O')));
    const p = posDe(ed, 'H2O', 1);
    ed.commands.setTextSelection({ from: p, to: p + 1 });
    botonTexto(barra.elemento, 'x₂')!.click();
    expect(ed.isActive('subindice')).toBe(true);
    botonTexto(barra.elemento, 'x²')!.click();
    const marcas = ed.state.doc.nodeAt(p)!.marks.map((m) => m.type.name);
    expect(marcas).toEqual(['superindice']);
    expect(botonTexto(barra.elemento, 'x²')!.getAttribute('aria-pressed')).toBe('true');
    expect(botonTexto(barra.elemento, 'x₂')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('negrita y cursiva', () => {
    const { ed, barra } = editorCon(doc(parrafo('p1', 'Hola mundo')));
    const p = posDe(ed, 'Hola');
    ed.commands.setTextSelection({ from: p, to: p + 4 });
    botonTexto(barra.elemento, 'N')!.click();
    botonTexto(barra.elemento, 'K')!.click();
    expect(ed.state.doc.nodeAt(p)!.marks.map((m) => m.type.name).sort()).toEqual(['cursiva', 'negrita']);
  });

  it('listas: numerada, con viñetas, sangria y quitar sangria', () => {
    const { ed, barra } = editorCon(doc(parrafo('p1', 'Uno'), parrafo('p2', 'Dos')));
    ed.commands.setTextSelection(posDe(ed, 'Uno'));
    botonTexto(barra.elemento, 'Lista numerada')!.click();
    expect((jsonDe(ed).content ?? [])[2].type).toBe('listaOrdenada');
    ed.commands.setTextSelection(posDe(ed, 'Dos'));
    botonTexto(barra.elemento, 'Lista numerada')!.click();
    // Se une a la lista anterior: dos ítems.
    const listaJson = (jsonDe(ed).content ?? [])[2];
    expect(listaJson.content).toHaveLength(2);
    ed.commands.setTextSelection(posDe(ed, 'Dos'));
    botonTexto(barra.elemento, 'Aumentar sangría')!.click();
    const anidada = (jsonDe(ed).content ?? [])[2].content![0].content![1];
    expect(anidada.type).toBe('listaOrdenada');
    ed.commands.setTextSelection(posDe(ed, 'Dos'));
    botonTexto(barra.elemento, 'Reducir sangría')!.click();
    expect((jsonDe(ed).content ?? [])[2].content).toHaveLength(2);
    ed.commands.setTextSelection(posDe(ed, 'Uno'));
    botonTexto(barra.elemento, 'Lista con viñetas')!.click();
    expect(JSON.stringify(jsonDe(ed))).toContain('listaVinetas');
  });

  it('tabla: insertar, agregar y quitar fila y columna', () => {
    const { ed, barra } = editorCon(doc(parrafo('p1', 'Antes')));
    ed.commands.setTextSelection(posDe(ed, 'Antes'));
    botonTexto(barra.elemento, 'Insertar tabla')!.click();
    const tabla = () => (jsonDe(ed).content ?? []).find((n) => n.type === 'tabla')!;
    expect(tabla().content).toHaveLength(2);
    expect(tabla().content![0].content).toHaveLength(2);
    expect(tabla().attrs?.columnas).toBe('|l|l|');
    expect(ed.state.selection.$from.parent.type.name).toBe('celda');
    botonTexto(barra.elemento, 'Agregar fila')!.click();
    expect(tabla().content).toHaveLength(3);
    botonTexto(barra.elemento, 'Agregar columna')!.click();
    expect(tabla().content!.every((f) => f.content!.length === 3)).toBe(true);
    expect(tabla().attrs?.columnas).toBe('|l|l|l|');
    botonTexto(barra.elemento, 'Quitar columna')!.click();
    expect(tabla().content!.every((f) => f.content!.length === 2)).toBe(true);
    expect(tabla().attrs?.columnas).toBe('|l|l|');
    botonTexto(barra.elemento, 'Quitar fila')!.click();
    expect(tabla().content).toHaveLength(2);
    // Las celdas nuevas no llevan bid (R27).
    expect(JSON.stringify(tabla())).not.toMatch(/"bid":"/);
  });

  it('simbolos se insertan en el cursor', () => {
    const { ed, barra } = editorCon(doc(parrafo('p1', 'T')));
    ed.commands.setTextSelection(posDe(ed, 'T', 1));
    for (const s of ['°', '±', '≤', '≥', 'µ', '·', '×', '→']) botonTexto(barra.elemento, s)!.click();
    expect(ed.getText()).toContain('T°±≤≥µ·×→');
  });

  it('nota al pie: insertar y editar en el panel lateral', () => {
    const { ed, barra } = editorCon(doc(parrafo('p1', 'Texto')));
    ed.commands.setTextSelection(posDe(ed, 'Texto', 5));
    botonTexto(barra.elemento, 'Nota al pie')!.click();
    const panel = barra.panelNota;
    expect(panel.hidden).toBe(false);
    const mini = barra.editorNota()!;
    mini.commands.insertContent('Detalle');
    let bloques: DocJSON[] = [];
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'notaPie') bloques = n.attrs.bloques as DocJSON[];
    });
    expect(bloques).toEqual([{ type: 'parrafo', attrs: { bid: null, pegado: false }, content: [texto('Detalle')] }]);
    botonTexto(panel, 'Cerrar nota')!.click();
    expect(panel.hidden).toBe(true);
  });
});
