import { Editor } from '@tiptap/core';
import { undo } from '@tiptap/pm/history';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { crearApi } from '../../src/app/api';
import { extensionesLaboratorio } from '../../src/app/laboratorio/protegidos';
import { vistaCapitulo } from '../../src/app/laboratorio/vista';
import { crearBarra, type Barra } from '../../src/editor/barra';
import { abrirEditorFormula } from '../../src/editor/formulas';
import type { DocJSON } from '../../src/tipos';
import { doc, ecuacion, parrafo } from '../ayudantes-doc';
import { error, json } from './ayudas';

/*
 * MathLive simulado: se prueba el contrato del diálogo, no MathLive. La fábrica corre
 * la primera vez que algo importa 'mathlive', así se puede contar cuándo se carga.
 */
const sim = vi.hoisted(() => ({ importaciones: 0, normalizar: false }));
vi.mock('mathlive', () => {
  sim.importaciones++;
  class MathfieldElement extends HTMLElement {
    static fontsDirectory: string | null = './fonts/';
    static soundsDirectory: string | null = './sounds';
    static keypressSound: unknown = 'keypress.wav';
    static plonkSound: unknown = 'plonk.wav';
    private valor = '';
    // Como el real, puede normalizar el LaTeX al asignarlo (aquí: espacios alrededor de ^).
    get value() {
      return this.valor;
    }
    set value(v: string) {
      this.valor = sim.normalizar ? v.replace(/\s*\^\s*/g, ' ^ ') : v;
    }
    mathVirtualKeyboardPolicy = 'auto';
    connectedCallback() {
      this.tabIndex = 0; // el real también recibe el foco
    }
  }
  customElements.define('math-field', MathfieldElement);
  return { MathfieldElement };
});

const MATE: DocJSON = { type: 'matematica', attrs: { latex: 'x^2' } };
const DOC = doc(parrafo('p1', 'Área ', MATE, ' total.'), ecuacion('e1', 'a+b=c'));

const editores: { ed: Editor; barra: Barra }[] = [];

function montar(contenido: DocJSON = DOC) {
  const area = document.createElement('div');
  document.body.append(area);
  const ed = new Editor({ element: area, extensions: extensionesLaboratorio(), content: structuredClone(contenido) });
  const barra = crearBarra(ed);
  document.body.append(barra.elemento);
  editores.push({ ed, barra });
  return { ed, barra, area };
}

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
const esperarDialogo = () => vi.waitFor(() => expect(dialogo()).not.toBeNull());
const campo = () => dialogo()!.querySelector<HTMLElement & { value: string }>('math-field, textarea')!;
const botonEn = (raiz: ParentNode, t: string) =>
  [...raiz.querySelectorAll('button')].find((b) => b.textContent?.trim() === t) as HTMLButtonElement;
const latexDe = (ed: Editor, tipo: string) => {
  let l: unknown;
  ed.state.doc.descendants((n) => {
    if (n.type.name === tipo && l === undefined) l = n.attrs.latex;
  });
  return l;
};
const tecla = (objetivo: Element, key: string) =>
  objetivo.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true }));

beforeAll(() => {
  // jsdom no mide: ProseMirror lo pide al llevar la selección a la vista tras focus().
  const sinMedidas = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects ??= sinMedidas;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

afterEach(() => {
  sim.normalizar = false;
  for (const { ed, barra } of editores.splice(0)) {
    barra.destruir();
    ed.destroy();
  }
  document.body.replaceChildren();
});

describe('fórmulas con MathLive', () => {
  // Va primero: comprueba que nada carga MathLive antes de abrir el diálogo.
  it('mathlive se importa solo al abrir', async () => {
    const { area } = montar();
    expect(sim.importaciones).toBe(0);
    area.querySelector('.vista-matematica')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await esperarDialogo();
    expect(sim.importaciones).toBe(1);
    expect(dialogo()!.querySelector('math-field')).not.toBeNull();
    // Configurado sin recursos externos: sin carpeta de fuentes ni sonidos.
    const { MathfieldElement } = (await import('mathlive')) as unknown as {
      MathfieldElement: { fontsDirectory: unknown; soundsDirectory: unknown; keypressSound: unknown; plonkSound: unknown };
    };
    expect(MathfieldElement.fontsDirectory).toBeNull();
    expect(MathfieldElement.soundsDirectory).toBeNull();
    expect(MathfieldElement.keypressSound).toBeNull();
    expect(MathfieldElement.plonkSound).toBeNull();
  });

  it('clic en matematica abre dialogo con su latex', async () => {
    const { area } = montar();
    area.querySelector('.vista-matematica')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await esperarDialogo();
    const d = dialogo()!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(campo().value).toBe('x^2');
    expect(d.querySelector('.vista-previa-formula .katex')).not.toBeNull();
    expect(document.activeElement).toBe(campo());
  });

  it('aceptar reemplaza attrs.latex', async () => {
    const { ed, area } = montar();
    const actualizaciones = vi.fn();
    ed.on('update', actualizaciones);
    area.querySelector('.vista-matematica')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await esperarDialogo();
    campo().value = 'y_1';
    campo().dispatchEvent(new Event('input', { bubbles: true }));
    botonEn(dialogo()!, 'Aceptar').click();
    await vi.waitFor(() => expect(latexDe(ed, 'matematica')).toBe('y_1'));
    expect(dialogo()).toBeNull();
    // Pasó por una transacción normal del editor: hay evento update (autoguardado) y se deshace.
    expect(actualizaciones).toHaveBeenCalled();
    undo(ed.state, ed.view.dispatch);
    expect(latexDe(ed, 'matematica')).toBe('x^2');
  });

  it('aceptar en una ecuacion en bloque conserva su bid', async () => {
    const { ed, area } = montar();
    area.querySelector('.vista-ecuacion')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await esperarDialogo();
    expect(campo().value).toBe('a+b=c');
    campo().value = 'a+b=d';
    botonEn(dialogo()!, 'Aceptar').click();
    await vi.waitFor(() => expect(latexDe(ed, 'ecuacion')).toBe('a+b=d'));
    let bid: unknown;
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'ecuacion') bid = n.attrs.bid;
    });
    expect(bid).toBe('e1');
  });

  it('cancelar no cambia nada', async () => {
    const { ed, area } = montar();
    const antes = JSON.stringify(ed.getJSON());
    const actualizaciones = vi.fn();
    ed.on('update', actualizaciones);
    area.querySelector('.vista-matematica')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await esperarDialogo();
    campo().value = 'z';
    botonEn(dialogo()!, 'Cancelar').click();
    await vi.waitFor(() => expect(dialogo()).toBeNull());
    await new Promise((r) => setTimeout(r, 0)); // deja terminar la promesa del primer diálogo
    // Esc también cancela; Enter en el campo no acepta.
    area.querySelector('.vista-matematica')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await esperarDialogo();
    campo().value = 'w';
    tecla(campo(), 'Enter');
    expect(dialogo()).not.toBeNull();
    tecla(campo(), 'Escape');
    await vi.waitFor(() => expect(dialogo()).toBeNull());
    expect(JSON.stringify(ed.getJSON())).toBe(antes);
    expect(actualizaciones).not.toHaveBeenCalled();
  });

  it('en solo lectura no abre el dialogo ni edita la formula', async () => {
    const { ed, barra, area } = montar();
    barra.habilitar(false);
    ed.setEditable(false, false);
    area.querySelector('.vista-matematica')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    botonEn(barra.elemento, 'Fórmula').click();
    await new Promise((r) => setTimeout(r, 20));
    expect(dialogo()).toBeNull();
    expect(botonEn(barra.elemento, 'Fórmula').disabled).toBe(true);
  });

  it('pasar a solo lectura con el dialogo abierto lo cierra sin editar', async () => {
    const { ed, barra, area } = montar();
    area.querySelector('.vista-matematica')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await esperarDialogo();
    campo().value = 'q';
    barra.habilitar(false);
    ed.setEditable(false, false);
    await vi.waitFor(() => expect(dialogo()).toBeNull());
    expect(latexDe(ed, 'matematica')).toBe('x^2');
  });

  it('el boton Formula inserta una formula nueva en el cursor', async () => {
    const { ed, barra } = montar(doc(parrafo('p1', 'Hola.')));
    let pos = -1;
    ed.state.doc.descendants((n, p) => {
      if (pos < 0 && n.type.name === 'parrafo') pos = p + 1;
    });
    ed.commands.setTextSelection(pos + 4); // tras "Hola"
    botonEn(barra.elemento, 'Fórmula').click();
    await esperarDialogo();
    expect(campo().value).toBe('');
    campo().value = '\\frac{1}{2}';
    botonEn(dialogo()!, 'Aceptar').click();
    await vi.waitFor(() => expect(latexDe(ed, 'matematica')).toBe('\\frac{1}{2}'));
    expect(ed.state.doc.textBetween(0, ed.state.doc.content.size)).toContain('Hola');
  });

  it('el boton Ecuacion inserta una ecuacion en bloque nueva sin bid', async () => {
    const { ed, barra } = montar(doc(parrafo('p1', 'Hola.')));
    let pos = -1;
    ed.state.doc.descendants((n, p) => {
      if (pos < 0 && n.type.name === 'parrafo') pos = p + 1;
    });
    ed.commands.setTextSelection(pos + 2);
    botonEn(barra.elemento, 'Ecuación').click();
    await esperarDialogo();
    campo().value = 'E=mc^2';
    botonEn(dialogo()!, 'Aceptar').click();
    await vi.waitFor(() => expect(latexDe(ed, 'ecuacion')).toBe('E=mc^2'));
    let bid: unknown = 'sin ver';
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'ecuacion') bid = n.attrs.bid;
    });
    expect(bid).toBeNull();
  });

  it('aceptar vacio no se permite y avisa', async () => {
    const r = abrirEditorFormula({ latex: 'x', enBloque: false });
    await esperarDialogo();
    campo().value = '   ';
    botonEn(dialogo()!, 'Aceptar').click();
    const alerta = dialogo()!.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alerta.hidden).toBe(false);
    expect(alerta.textContent).toContain('Escriba una fórmula');
    botonEn(dialogo()!, 'Cancelar').click();
    await expect(r).resolves.toBeNull();
  });

  it('Tab queda atrapado dentro del dialogo', async () => {
    const r = abrirEditorFormula({ latex: 'x', enBloque: true });
    await esperarDialogo();
    const aceptar = botonEn(dialogo()!, 'Aceptar');
    aceptar.focus();
    tecla(aceptar, 'Tab');
    expect(document.activeElement).toBe(campo());
    campo().focus();
    campo().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(aceptar);
    tecla(campo(), 'Escape');
    await expect(r).resolves.toBeNull();
  });

  it('si MathLive no carga usa un textarea con vista previa', async () => {
    const r = abrirEditorFormula(
      { latex: 'a^2', enBloque: false },
      { cargar: () => Promise.reject(new Error('sin red')) },
    );
    await esperarDialogo();
    const area = dialogo()!.querySelector('textarea') as HTMLTextAreaElement;
    expect(area).not.toBeNull();
    expect(dialogo()!.querySelector('math-field')).toBeNull();
    expect(area.value).toBe('a^2');
    expect(dialogo()!.textContent).toContain('No se pudo cargar el editor visual');
    area.value = 'b^2';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    expect(dialogo()!.querySelector('.vista-previa-formula')!.textContent).toContain('b');
    botonEn(dialogo()!, 'Aceptar').click();
    await expect(r).resolves.toBe('b^2');
  });

  it('la vista previa no ejecuta comandos de confianza de KaTeX', async () => {
    const r = abrirEditorFormula(
      { latex: '\\href{javascript:alert(1)}{x}\\htmlId{z}{y}', enBloque: false },
      { cargar: () => Promise.reject(new Error('x')) },
    );
    await esperarDialogo();
    const previa = dialogo()!.querySelector('.vista-previa-formula')!;
    expect(previa.querySelector('a[href^="javascript"]')).toBeNull();
    expect(previa.querySelector('#z')).toBeNull();
    tecla(dialogo()!.querySelector('textarea')!, 'Escape');
    await expect(r).resolves.toBeNull();
  });

  it('en la vista: aceptar dispara el autoguardado y tras cerrarse la consulta no se edita', async () => {
    const puts: { docJson: DocJSON }[] = [];
    const respuestas = [() => json(200, { actualizado: '2026-11-03T15:20:00Z' }), () => error(409, 'etapa_no_permite')];
    const fetchRuta = (async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(entrada);
      const metodo = init.method ?? 'GET';
      if (url === '/api/capitulos/3/base') return json(200, { versionId: 7, docJson: DOC });
      if (url === '/api/capitulos/3/copia' && metodo === 'GET') return json(200, { docJson: null });
      if (url === '/api/consulta') {
        return json(200, { apertura: '2026-11-02T12:00:00Z', cierre: '2026-11-12T12:00:00Z', etapa: 'consulta', motivoObligatorio: false });
      }
      if (url === '/api/capitulos/3/copia' && metodo === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return respuestas.shift()!();
      }
      throw new Error(`ruta inesperada ${metodo} ${url}`);
    }) as unknown as typeof fetch;
    const raiz = document.createElement('div');
    document.body.append(raiz);
    const vista = vistaCapitulo(crearApi({ fetch: fetchRuta, alSinSesion: () => {} }), { id: 12, nombre: 'Ana', laboratorio: 'Lab', roles: ['laboratorio'] }, '3', {
      almacen: localStorage,
      esperaMs: 10,
    });
    vista.montar(raiz);
    try {
      await vista.listo;
      raiz.querySelector('.vista-matematica')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await esperarDialogo();
      campo().value = 'y_1';
      botonEn(dialogo()!, 'Aceptar').click();
      await vi.waitFor(() => expect(puts).toHaveLength(1), { timeout: 3000 });
      expect(JSON.stringify(puts[0].docJson)).toContain('y_1');
      // Segunda edición: el servidor responde que la consulta se cerró → solo lectura.
      await new Promise((r) => setTimeout(r, 0));
      raiz.querySelector('.vista-matematica')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await esperarDialogo();
      campo().value = 'y_2';
      botonEn(dialogo()!, 'Aceptar').click();
      await vi.waitFor(() => expect(vista.editor()!.isEditable).toBe(false), { timeout: 3000 });
      raiz.querySelector('.vista-matematica')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
      expect(dialogo()).toBeNull();
      expect(latexDe(vista.editor()!, 'matematica')).toBe('y_2');
      expect(puts).toHaveLength(2);
    } finally {
      await vista.desmontar();
      localStorage.clear();
    }
  });

  it('aceptar sin editar no crea un cambio aunque MathLive normalice el latex', async () => {
    sim.normalizar = true;
    const r = abrirEditorFormula({ latex: 'x^2', enBloque: false });
    await esperarDialogo();
    expect(campo().value).toBe('x ^ 2'); // normalizado por el campo
    botonEn(dialogo()!, 'Aceptar').click();
    await expect(r).resolves.toBe('x^2'); // el original, intacto

    // En el editor: aceptar sin editar no despacha nada; editar sí.
    const { ed, area } = montar();
    const actualizaciones = vi.fn();
    ed.on('update', actualizaciones);
    area.querySelector('.vista-matematica')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await esperarDialogo();
    botonEn(dialogo()!, 'Aceptar').click();
    await vi.waitFor(() => expect(dialogo()).toBeNull());
    await new Promise((res) => setTimeout(res, 0));
    expect(actualizaciones).not.toHaveBeenCalled();
    expect(latexDe(ed, 'matematica')).toBe('x^2');
    area.querySelector('.vista-matematica')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await esperarDialogo();
    campo().value = 'x^3';
    botonEn(dialogo()!, 'Aceptar').click();
    await vi.waitFor(() => expect(latexDe(ed, 'matematica')).toBe('x ^ 3'));
  });

  it('Esc con un menu o popover de MathLive abierto no cancela el dialogo', async () => {
    const r = abrirEditorFormula({ latex: 'x', enBloque: false });
    await esperarDialogo();
    // Popover de sugerencias visible (MathLive lo pone en document.body).
    const popover = Object.assign(document.createElement('div'), { id: 'mathlive-suggestion-popover', className: 'is-visible' });
    document.body.append(popover);
    tecla(campo(), 'Escape');
    expect(dialogo()).not.toBeNull();
    popover.remove();
    // Menú contextual dentro del campo: Esc lo cierra a él, no al diálogo.
    const menu = Object.assign(document.createElement('div'), { className: 'ui-menu-container' });
    menu.setAttribute('role', 'menu');
    campo().append(menu);
    tecla(menu, 'Escape');
    expect(dialogo()).not.toBeNull();
    menu.remove();
    // Sin nada abierto, Esc cancela.
    tecla(campo(), 'Escape');
    await expect(r).resolves.toBeNull();
  });
});
