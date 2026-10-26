/** Servidor simulado para las pruebas de decisiones y versión final del revisor (Task 7). */
import { Node } from '@tiptap/pm/model';
import { crearApi } from '../../../src/app/api';
import { vistaRevisor } from '../../../src/app/revisor/vista';
import type { Aportes, CapituloLista, Etapa, Final } from '../../../src/app/tipos-api';
import { calcularSugerencias } from '../../../src/cambios/sugerencias';
import { esquemaManual } from '../../../src/esquema/esquema';
import type { DocJSON } from '../../../src/tipos';
import { doc, item, lista, parrafo } from '../../ayudantes-doc';
import { error, json } from '../ayudas';
import { aportes, BASE, LABS } from './datos';

export interface Peticion {
  metodo: string;
  url: string;
  cuerpo: unknown;
}

export const CAPS: CapituloLista[] = [{ id: 3, orden: 1, slug: 'cap-1', titulo: 'Capítulo 1', misCambios: 0, misComentarios: 0 }];

export interface OpcionesMontar {
  etapa?: Etapa;
  datos?: Aportes;
  base?: DocJSON;
  final?: Final | null;
  /** Respuesta propia para una petición (undefined: la respuesta por omisión). */
  responder?: (p: Peticion) => Response | undefined;
  /** Usuario revisor (40 por omisión). */
  usuarioId?: number;
}

const montadas: { desmontar(): unknown }[] = [];

export function desmontarTodas(): void {
  while (montadas.length > 0) montadas.pop()?.desmontar();
  history.replaceState(null, '', '#');
}

export async function montarVista(op: OpcionesMontar = {}) {
  const datos = op.datos ?? aportes();
  const base = op.base ?? BASE;
  const peticiones: Peticion[] = [];
  const fetchRuta = (async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
    const p: Peticion = {
      metodo: init.method ?? 'GET',
      url: String(entrada),
      cuerpo: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    peticiones.push(p);
    const propia = op.responder?.(p);
    if (propia) return propia;
    const { metodo, url } = p;
    if (metodo === 'GET') {
      if (url === '/api/consulta') {
        return json(200, { apertura: '2026-11-02T12:00:00Z', cierre: '2026-11-12T12:00:00Z', etapa: op.etapa ?? 'edicion_final', motivoObligatorio: false });
      }
      if (url === '/api/capitulos') return json(200, CAPS);
      if (url === '/api/capitulos/3/base') return json(200, { versionId: 7, docJson: base }, { ETag: '"v7"' });
      if (url === '/api/capitulos/3/aportes') return json(200, datos);
      if (url === '/api/capitulos/3/final') return op.final ? json(200, op.final) : error(404, 'no_encontrado');
    }
    let m = /^\/api\/sugerencias\/(\d+)$/.exec(url);
    if (metodo === 'PATCH' && m) return json(200, { id: Number(m[1]) });
    m = /^\/api\/comentarios\/(\d+)\/resolucion$/.exec(url);
    if (metodo === 'PATCH' && m) return json(200, { id: Number(m[1]) });
    if (metodo === 'PUT' && url === '/api/capitulos/3/final') return json(200, { versionId: 9 });
    throw new Error(`ruta inesperada ${metodo} ${url}`);
  }) as unknown as typeof fetch;
  const api = crearApi({ fetch: fetchRuta, alSinSesion: () => {} });
  const raiz = document.createElement('div');
  document.body.append(raiz);
  const vista = vistaRevisor(api, 3, undefined, op.usuarioId ?? 40);
  montadas.push(vista);
  vista.montar(raiz);
  await vista.listo;
  return { raiz, peticiones, datos };
}

/** Peticiones de escritura (sin los GET de la carga). */
export const escrituras = (ps: Peticion[]) => ps.filter((p) => p.metodo !== 'GET');

export const botonCon = (raiz: ParentNode, texto: string): HTMLButtonElement | undefined =>
  [...raiz.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === texto);

/** Espera a que terminen las promesas pendientes (fetch simulado y redibujos). */
export const esperar = async (vueltas = 6) => {
  for (let i = 0; i < vueltas; i++) await new Promise((r) => setTimeout(r, 0));
};

/* ---------- Bloque movido (unido al ítem anterior con Backspace) ---------- */

const normalizar = (d: DocJSON): DocJSON => Node.fromJSON(esquemaManual, d).toJSON() as DocJSON;

export const BASE_MOVIDO = normalizar(
  doc(
    parrafo('p0', 'Introducción.'),
    lista(item(null, parrafo('i1', 'Pesar 10 g.')), item(null, parrafo('i2', 'Disolver 42,0 g.'))),
  ),
);

const COPIA_MOVIDO = normalizar(
  doc(parrafo('p0', 'Introducción.'), lista(item(null, parrafo('i1', 'Pesar 10 g.'), parrafo('i2', 'Disolver 42,00 g.')))),
);

/** Aportes con un solo bloque movido (dos miembros con el mismo `grupo`) del Laboratorio Norte. */
export function aportesMovido(): Aportes {
  let fila = 500;
  const sugerencias = calcularSugerencias(BASE_MOVIDO, COPIA_MOVIDO, 'u12').map((s) => ({
    ...s,
    sugerenciaId: fila++,
    usuarioId: 12,
    laboratorio: LABS[12],
    versionId: 7,
    estado: 'pendiente' as const,
    notaResolucion: null,
    derivadaReunion: false,
    resueltoPor: null,
    resueltoEn: null,
  }));
  return { sugerencias, comentarios: [] };
}
