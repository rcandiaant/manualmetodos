import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Aportes } from '../../../src/app/tipos-api';
import { calcularSugerencias } from '../../../src/cambios/sugerencias';
import { exportarLatex } from '../../../src/latex/exportar';
import type { DocJSON } from '../../../src/tipos';
import { doc, parrafo, ref } from '../../ayudantes-doc';
import { aportes, LABS } from './datos';
import { botonCon, desmontarTodas, escrituras, esperar, montarVista } from './servidor';

let descargas: { nombre: string; blob: Blob }[];
let ultimoBlob: Blob | null;

beforeEach(() => {
  descargas = [];
  ultimoBlob = null;
  URL.createObjectURL = vi.fn((b: Blob) => {
    ultimoBlob = b;
    return 'blob:prueba';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    descargas.push({ nombre: this.download, blob: ultimoBlob! });
  });
});

afterEach(() => {
  desmontarTodas();
  vi.restoreAllMocks();
  localStorage.clear();
});

const textoFinal = (raiz: HTMLElement) => raiz.querySelector<HTMLElement>('.editor-final')?.textContent ?? null;

/** Editor TipTap de la versión final (TipTap lo deja en `view.dom.editor`). */
const editorFinal = (raiz: HTMLElement) =>
  (raiz.querySelector('.editor-final .ProseMirror') as unknown as { editor: import('@tiptap/core').Editor }).editor;

const salirDeLaPagina = () => {
  const ev = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
};

describe('versión final del revisor', () => {
  it('fila colapsada aceptada se compone una sola vez', async () => {
    // aportes(): Norte y Sur proponen lo mismo en p1 («42,0» → «43,0»); Centro propone «44,0».
    const { raiz } = await montarVista();
    const colapsada = [...raiz.querySelectorAll<HTMLElement>('.panel-bloques [data-bloque="p1"] .fila-propuesta')].find(
      (f) => f.querySelectorAll('.chip-lab').length === 2,
    )!;
    botonCon(colapsada, 'Aceptar')!.click();
    await esperar();
    botonCon(raiz.querySelector<HTMLElement>('.confirmacion-conflicto')!, 'Confirmar')!.click(); // rechaza la de Centro
    await esperar();
    botonCon(raiz, 'Componer versión final')!.click();
    await esperar();
    expect(raiz.querySelector('.revisor-final [role="alert"]:not([hidden])')).toBeNull();
    const texto = textoFinal(raiz)!;
    expect(texto).toContain('Disolver 43,0 g de NaCl.');
    expect(texto.split('43,0')).toHaveLength(2); // el cambio, una sola vez
  });

  it('ediciones sin guardar de la final avisan al salir y se recuperan del borrador local', async () => {
    const { raiz } = await montarVista();
    expect(salirDeLaPagina()).toBe(false);
    botonCon(raiz, 'Componer versión final')!.click();
    await esperar();
    editorFinal(raiz).chain().focus('end').insertContent(' Redacción del revisor.').run();
    expect(salirDeLaPagina()).toBe(true); // beforeunload: el navegador pregunta antes de salir

    // Cambiar de vista (hashchange desmonta) no pierde las ediciones: quedan en un borrador local.
    desmontarTodas();
    expect(salirDeLaPagina()).toBe(false);
    const vuelta = await montarVista();
    const borrador = vuelta.raiz.querySelector<HTMLElement>('.borrador-final')!;
    expect(borrador.hidden).toBe(false);
    expect(borrador.getAttribute('role')).toBe('status');
    botonCon(borrador, 'Recuperar el borrador local')!.click();
    await esperar();
    expect(textoFinal(vuelta.raiz)).toContain('Redacción del revisor.');

    // Guardar en el servidor borra el borrador local.
    botonCon(vuelta.raiz, 'Guardar versión final')!.click();
    await esperar();
    expect(salirDeLaPagina()).toBe(false);
    desmontarTodas();
    const otra = await montarVista();
    expect(otra.raiz.querySelector<HTMLElement>('.borrador-final')!.hidden).toBe(true);
  });

  it('componer final aplica aceptadas y muestra error visible de aplicar', async () => {
    // aportes(): la de Sur en p2 («5» → «10») ya está aceptada; las demás, pendientes.
    const { raiz } = await montarVista();
    botonCon(raiz, 'Componer versión final')!.click();
    await esperar();
    expect(textoFinal(raiz)).toContain('Agitar durante 10 minutos.');
    expect(textoFinal(raiz)).toContain('Disolver 42,0 g de NaCl.');
    expect(raiz.querySelector('.revisor-final [role="alert"]:not([hidden])')).toBeNull();

    // Dos laboratorios aceptados en el mismo conflicto: aplicarSugerencias lanza y el error se ve.
    const datos = aportes();
    for (const s of datos.sugerencias) if (s.bloqueId === 'p1' && (s.usuarioId === 12 || s.usuarioId === 20)) s.estado = 'aceptada';
    const otra = await montarVista({ datos });
    botonCon(otra.raiz, 'Componer versión final')!.click();
    await esperar();
    const alerta = otra.raiz.querySelector<HTMLElement>('.revisor-final [role="alert"]:not([hidden])')!;
    expect(alerta.textContent).toContain('Sugerencias en conflicto');
    expect(alerta.textContent).toContain('Laboratorio Norte');
    expect(alerta.textContent).toContain('Laboratorio Centro');
    expect(textoFinal(otra.raiz)).toBeNull();
  });

  it('guardar final envia docJson y tex exportado', async () => {
    const { raiz, peticiones } = await montarVista();
    botonCon(raiz, 'Componer versión final')!.click();
    await esperar();
    botonCon(raiz, 'Guardar versión final')!.click();
    await esperar();
    const [put] = escrituras(peticiones);
    expect(put.metodo).toBe('PUT');
    expect(put.url).toBe('/api/capitulos/3/final');
    const cuerpo = put.cuerpo as { docJson: DocJSON; tex: string };
    expect(Object.keys(cuerpo).sort()).toEqual(['docJson', 'tex']);
    expect(cuerpo.tex).toBe(exportarLatex(cuerpo.docJson));
    expect(cuerpo.tex).toContain('Agitar durante 10 minutos.');
    expect(raiz.querySelector('.revisor-final .estado-final')!.textContent).toMatch(/v9/);

    // Si ya hay una final guardada, se ofrece retomarla.
    const guardada = doc(parrafo('p1', 'Texto final redactado por el revisor.'));
    const otra = await montarVista({ final: { versionId: 8, docJson: guardada, tex: exportarLatex(guardada) } });
    expect(otra.raiz.querySelector('.revisor-final')!.textContent).toMatch(/v8/);
    botonCon(otra.raiz, 'Retomar la versión final guardada')!.click();
    await esperar();
    expect(textoFinal(otra.raiz)).toContain('Texto final redactado por el revisor.');

    // Fuera de la edición final no se puede guardar.
    const consulta = await montarVista({ etapa: 'consulta' });
    botonCon(consulta.raiz, 'Componer versión final')!.click();
    await esperar();
    expect(botonCon(consulta.raiz, 'Guardar versión final')!.disabled).toBe(true);
  });

  it('exportar avisa caracteres no soportados y referencias colgantes', async () => {
    // Sin problemas: descarga directa, slug.tex, UTF-8 y LF.
    const limpio = await montarVista();
    botonCon(limpio.raiz, 'Componer versión final')!.click();
    await esperar();
    botonCon(limpio.raiz, 'Exportar .tex')!.click();
    expect(descargas.map((d) => d.nombre)).toEqual(['cap-1.tex']);
    expect(descargas[0].blob.type).toBe('text/plain;charset=utf-8');
    const tex = await descargas[0].blob.text();
    expect(tex).toContain('Agitar durante 10 minutos.');
    expect(tex).not.toContain('\r');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled(); // se revoca después, para no cortar la descarga
    await new Promise((r) => setTimeout(r, 1100));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:prueba');
    expect(limpio.raiz.querySelector<HTMLElement>('.aviso-exportar')!.hidden).toBe(true);

    // Con un carácter sin forma LaTeX y una referencia colgante: aviso en la página, sin confirm().
    const confirmar = vi.spyOn(window, 'confirm');
    const base = doc(
      parrafo('p1', 'Disolver 42,0 g de NaCl.'),
      parrafo('p2', 'Agitar durante 5 minutos.'),
      parrafo('p3', 'Medir el pH ☺ según ', ref('itm:x:z'), '.'),
    );
    const copia = doc(
      parrafo('p1', 'Disolver 42,0 g de NaCl.'),
      parrafo('p2', 'Agitar durante 10 minutos.'),
      parrafo('p3', 'Medir el pH ☺ según ', ref('itm:x:z'), '.'),
    );
    const datos: Aportes = {
      sugerencias: calcularSugerencias(base, copia, 'u15').map((s, i) => ({
        ...s,
        sugerenciaId: 700 + i,
        usuarioId: 15,
        laboratorio: LABS[15],
        versionId: 7,
        estado: 'aceptada' as const,
        notaResolucion: null,
        derivadaReunion: false,
      })),
      comentarios: [],
    };
    const { raiz } = await montarVista({ base, datos });
    descargas = [];
    botonCon(raiz, 'Componer versión final')!.click();
    await esperar();
    botonCon(raiz, 'Exportar .tex')!.click();
    expect(descargas).toEqual([]);
    const aviso = raiz.querySelector<HTMLElement>('.aviso-exportar')!;
    expect(aviso.hidden).toBe(false);
    expect(aviso.getAttribute('role')).toBe('alert');
    expect(aviso.textContent).toContain('☺');
    expect(aviso.textContent).toContain('U+263A');
    expect(aviso.textContent).toContain('p3');
    expect(aviso.textContent).toContain('itm:x:z');

    // Cambiar una decisión oculta el aviso: hay que volver a revisar antes de exportar.
    botonCon(raiz.querySelector<HTMLElement>('.panel-bloques .fila-propuesta')!, 'Rechazar')!.click();
    await esperar();
    expect(aviso.hidden).toBe(true);
    expect(descargas).toEqual([]);

    botonCon(raiz, 'Exportar .tex')!.click();
    expect(aviso.hidden).toBe(false);
    botonCon(aviso, 'Exportar de todos modos')!.click();
    expect(descargas.map((d) => d.nombre)).toEqual(['cap-1.tex']);
    expect(aviso.hidden).toBe(true);
    expect(confirmar).not.toHaveBeenCalled();
  });

  describe('borrador local de la versión final', () => {
    const CLAVE_40 = 'mm:revisor:final:40:3:7';
    const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

    it('la clave lleva el usuario y la version base: otro revisor del mismo navegador no lo ve', async () => {
      const { raiz } = await montarVista({ usuarioId: 40 });
      botonCon(raiz, 'Componer versión final')!.click();
      await esperar();
      editorFinal(raiz).chain().focus('end').insertContent(' De Ana.').run();
      desmontarTodas();
      expect(localStorage.getItem(CLAVE_40)).toContain('De Ana.');
      expect(localStorage.getItem('mm:revisor:final:3')).toBeNull();
      const otro = await montarVista({ usuarioId: 41 });
      expect(otro.raiz.querySelector<HTMLElement>('.borrador-final')!.hidden).toBe(true);
      desmontarTodas();
      const mismo = await montarVista({ usuarioId: 40 });
      expect(mismo.raiz.querySelector<HTMLElement>('.borrador-final')!.hidden).toBe(false);
    });

    it('componer con un borrador local sin recuperar pide confirmacion y no lo pisa en silencio', async () => {
      localStorage.setItem(
        CLAVE_40,
        JSON.stringify({ docJson: doc(parrafo('p1', 'Borrador anterior.')), fecha: '2026-11-20T12:00:00Z' }),
      );
      const { raiz } = await montarVista({ usuarioId: 40 });
      botonCon(raiz, 'Componer versión final')!.click();
      await esperar();
      const confirmacion = raiz.querySelector<HTMLElement>('.confirmacion-final')!;
      expect(confirmacion.hidden).toBe(false);
      expect(confirmacion.textContent).toContain('borrador local');
      expect(textoFinal(raiz)).toBeNull(); // no se abrió nada todavía
      botonCon(confirmacion, 'Cancelar')!.click();
      expect(localStorage.getItem(CLAVE_40)).toContain('Borrador anterior.');
      botonCon(raiz, 'Componer versión final')!.click();
      botonCon(confirmacion, 'Descartar el borrador local y componer')!.click();
      await esperar();
      expect(textoFinal(raiz)).not.toBeNull();
      expect(localStorage.getItem(CLAVE_40)).toBeNull();
      expect(raiz.querySelector<HTMLElement>('.borrador-final')!.hidden).toBe(true);
    });

    it('el borrador se escribe como mucho cada 500 ms y se vacia al salir de la pagina', async () => {
      const { raiz } = await montarVista({ usuarioId: 40 });
      botonCon(raiz, 'Componer versión final')!.click();
      await esperar();
      const ed = editorFinal(raiz);
      for (const t of ['a', 'b', 'c', 'd', 'e']) ed.commands.insertContentAt(ed.state.doc.content.size - 1, t);
      expect(localStorage.getItem(CLAVE_40)).toBeNull(); // nada serializado en cada tecla
      await pausa(600);
      expect(localStorage.getItem(CLAVE_40)).toContain('abcde');
      ed.commands.insertContentAt(ed.state.doc.content.size - 1, 'Z');
      salirDeLaPagina(); // beforeunload escribe ya lo pendiente
      expect(localStorage.getItem(CLAVE_40)).toContain('abcdeZ');
    });
  });
});
