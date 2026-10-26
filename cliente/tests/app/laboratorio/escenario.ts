/**
 * Montaje de la vista del capítulo con un `fetch` por rutas, compartido por las pruebas
 * del panel y de los comentarios (Task 5).
 */
import { Editor } from '@tiptap/core';
import { vi } from 'vitest';
import { crearApi } from '../../../src/app/api';
import { vistaCapitulo } from '../../../src/app/laboratorio/vista';
import type { Aportes, Base, Comentario, Consulta, Copia, Usuario } from '../../../src/app/tipos-api';
import type { DocJSON } from '../../../src/tipos';
import { json } from '../ayudas';

export const ANA: Usuario = { id: 12, nombre: 'Ana Pérez', laboratorio: 'Lab Norte', roles: ['laboratorio'] };

export interface LlamadaRuta {
  metodo: string;
  url: string;
  cuerpo: unknown;
}

type Manejador = (l: LlamadaRuta) => Response | Promise<Response | undefined> | undefined;

export interface Escenario {
  base: DocJSON;
  copia?: Copia;
  etapa?: Consulta['etapa'];
  motivoObligatorio?: boolean;
  comentarios?: Comentario[];
  aportes?: Aportes;
  /** Respuestas a medida: si devuelve undefined, se usa la respuesta por defecto. */
  manejar?: Manejador;
}

export function montarVista(esc: Escenario) {
  const llamadas: LlamadaRuta[] = [];
  let siguienteId = 100;
  const fetchRuta = (async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(entrada);
    const metodo = init.method ?? 'GET';
    const l: LlamadaRuta = { metodo, url, cuerpo: init.body ? JSON.parse(String(init.body)) : undefined };
    llamadas.push(l);
    const propia = await esc.manejar?.(l);
    if (propia) return propia;
    if (metodo === 'GET' && url === '/api/capitulos/3/base') {
      return json(200, { versionId: 7, docJson: esc.base } satisfies Base, { ETag: '"v7"' });
    }
    if (metodo === 'GET' && url === '/api/capitulos/3/copia') return json(200, esc.copia ?? { docJson: null });
    if (metodo === 'GET' && url === '/api/consulta') {
      return json(200, {
        apertura: '2026-11-02T12:00:00Z',
        cierre: '2026-11-12T12:00:00Z',
        etapa: esc.etapa ?? 'consulta',
        motivoObligatorio: esc.motivoObligatorio ?? false,
      } satisfies Consulta);
    }
    if (metodo === 'GET' && url === '/api/capitulos/3/comentarios') return json(200, esc.comentarios ?? []);
    if (metodo === 'GET' && url === '/api/capitulos/3/mis-aportes') {
      return json(200, esc.aportes ?? { sugerencias: [], comentarios: [] });
    }
    if (metodo === 'PUT' && url === '/api/capitulos/3/copia') return json(200, { actualizado: '2026-11-03T16:00:05Z' });
    if (metodo === 'PATCH' && url.startsWith('/api/capitulos/3/sugerencias/')) {
      const uid = decodeURIComponent(url.slice('/api/capitulos/3/sugerencias/'.length));
      const motivo = (l.cuerpo as { motivo: string }).motivo;
      return json(200, { id: uid, motivo: motivo === '' ? null : motivo });
    }
    if (metodo === 'POST' && url === '/api/capitulos/3/comentarios') return json(201, { id: siguienteId++ });
    const m = /^\/api\/comentarios\/(\d+)$/.exec(url);
    if (m && metodo === 'PATCH') return json(200, { id: Number(m[1]) });
    if (m && metodo === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`ruta inesperada ${metodo} ${url}`);
  }) as unknown as typeof fetch;
  const api = crearApi({ fetch: fetchRuta, alSinSesion: () => {} });
  api.fijarCsrf('tok');
  const raiz = document.createElement('div');
  document.body.append(raiz);
  const vista = vistaCapitulo(api, ANA, '3', { almacen: localStorage });
  vista.montar(raiz);
  return { vista, raiz, llamadas };
}

export const botonTexto = (raiz: ParentNode, t: string) =>
  [...raiz.querySelectorAll('button')].find((b) => b.textContent?.trim() === t) as HTMLButtonElement | undefined;

/** Posición dentro del texto `t` (inicio + desplazamiento). */
export function posDe(ed: Editor, t: string, desp = 0): number {
  let res = -1;
  ed.state.doc.descendants((n, p) => {
    if (res < 0 && n.isText && n.text?.includes(t)) res = p + n.text.indexOf(t) + desp;
  });
  return res;
}

/** Escribe en un campo y sale de él (como el usuario). */
export function escribirCampo(campo: HTMLTextAreaElement, valor: string): void {
  campo.focus();
  campo.value = valor;
  campo.dispatchEvent(new Event('input', { bubbles: true }));
}

export function salirCampo(campo: HTMLTextAreaElement): void {
  campo.dispatchEvent(new FocusEvent('blur'));
}

export function relojFalso(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-11-03T16:00:00Z'));
}
