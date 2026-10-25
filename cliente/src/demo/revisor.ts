import { Editor } from '@tiptap/core';
import { aplicarSugerencias, completarGrupo } from '../cambios/aplicar';
import { claveGrupo, detectarConflictos, type Conflicto } from '../cambios/conflictos';
import { avisosNoCubiertos, tipoMovimiento } from '../cambios/estructura';
import { ANCLA_INICIO, calcularSugerencias, listarBloques } from '../cambios/sugerencias';
import { validarDocumento } from '../esquema/esquema';
import { exportarLatex } from '../latex/exportar';
import { caracteresNoSoportados, referenciasColgantes } from '../latex/revision';
import type { DocJSON, Sugerencia } from '../tipos';
import { LABS, LETRA_LAB, NOMBRE_LAB, type ContextoModo, type Decision, type Lab, type Modo } from './almacen';
import { claveDecoraciones, decoracionesRevisor } from './decoraciones';
import { extensionesDemo } from './editor';
import {
  NOMBRE_MOVIMIENTO,
  NOMBRE_TIPO,
  bidDeGrupo,
  boton,
  cajaAvisosEstructura,
  cajaError,
  el,
  mensajeDe,
  resaltar,
  resumenUnidad,
  unidades,
  type Unidad,
} from './ui';

const esLab = (autor: string): autor is Lab => (LABS as string[]).includes(autor);
const claseAutor = (autor: string) => `autor-${autor}`;

/**
 * Tarjeta de una unidad (sugerencia suelta o bloque movido: par con el mismo grupo,
 * que se decide entero) o de un grupo de sugerencias en conflicto.
 */
type Entrada = { tipo: 'suelta'; u: Unidad } | { tipo: 'conflicto'; c: Conflicto; sugs: Sugerencia[] };

/**
 * Modo revisor: la base (solo lectura) con las sugerencias de todos los laboratorios
 * superpuestas por color, conflictos recuadrados en naranjo, tarjetas para decidir y
 * exportación del .tex final.
 */
export function montarRevisor(contenedor: HTMLElement, ctx: ContextoModo): Modo {
  const { estado } = ctx;
  const base = estado.base as DocJSON;
  const decisiones = estado.decisiones;

  const error = el('div', { class: 'error', role: 'alert' });
  error.hidden = true;
  /**
   * Task 4: aviso en la página (no `confirm`) con lo que el .tex no puede representar.
   * Se oculta al redibujar: si cambian las decisiones, hay que volver a revisar.
   */
  const avisoExportar = el('div', { class: 'aviso aviso-exportar', role: 'alert' });
  avisoExportar.hidden = true;
  const resumen = el('span', { class: 'contador', 'aria-live': 'polite' });
  const areaEditor = el('div', { class: 'editor', 'data-modo': 'revisor' });
  const lista = el('ol', { class: 'tarjetas' });

  // Decisiones borradas porque un laboratorio guardó otra copia: se avisa una vez.
  const descartadas = LABS.filter((l) => (estado.decisionesDescartadas[l] ?? 0) > 0);
  const avisoDescartadas = el(
    'div',
    { class: 'aviso', role: 'status' },
    ...descartadas.map((l) => {
      const n = estado.decisionesDescartadas[l] ?? 0;
      return el(
        'p',
        {},
        `Se borr${n === 1 ? 'ó 1 decisión' : `aron ${n} decisiones`} sobre el ${NOMBRE_LAB[l]} porque guardó una nueva copia; revise de nuevo sus sugerencias.`,
      );
    }),
  );
  avisoDescartadas.hidden = descartadas.length === 0;
  if (descartadas.length > 0) {
    estado.decisionesDescartadas = {};
    ctx.guardar();
  }

  // I1: cambios de estructura de cada laboratorio que no quedan cubiertos por un par movido.
  const avisosEstructura = el('div', { class: 'aviso aviso-estructura', role: 'status' });
  avisosEstructura.hidden = true;

  // Sugerencias de cada laboratorio que guardó copia, con sus motivos.
  let sugerencias: Sugerencia[] = [];
  let conflictos: Conflicto[] = [];
  const avisosPorLab: string[] = [];
  /** «Movido» o «Unido al ítem anterior» por autor y grupo. */
  const nombreGrupo = new Map<string, string>();
  const claveNombre = (s: Sugerencia) => claveGrupo(s) ?? s.id;
  try {
    for (const lab of LABS) {
      const copia = estado.copias[lab];
      if (!copia) continue;
      const deLab = calcularSugerencias(base, copia, lab);
      for (const a of avisosNoCubiertos(base, copia, deLab)) avisosPorLab.push(`${NOMBRE_LAB[lab]}: ${a}`);
      for (const s of deLab) {
        if (s.grupo !== undefined && !nombreGrupo.has(claveNombre(s))) {
          nombreGrupo.set(claveNombre(s), NOMBRE_MOVIMIENTO[tipoMovimiento(base, copia, bidDeGrupo(s.grupo))]);
        }
        const motivo = estado.motivos[lab][s.id];
        sugerencias.push(motivo ? { ...s, motivo } : s);
      }
    }
    conflictos = detectarConflictos(sugerencias);
    cajaAvisosEstructura(
      avisosEstructura,
      avisosPorLab,
      'Cambios de estructura de los laboratorios que NO se aplicarán (no se pudieron recoger como bloque movido). ' +
        'Si corresponde, rehágalos a mano en el .tex exportado o pida al laboratorio que los proponga como eliminación + bloque nuevo:',
    );
  } catch (e) {
    sugerencias = [];
    cajaError(error, `no se pudieron calcular las sugerencias: ${mensajeDe(e)}`);
  }

  // Orden de documento: índice del bloque en la base (las inserciones van tras su ancla).
  const indice = new Map(listarBloques(base).map((b, i) => [b.bid, i] as const));
  const clave = (s: Sugerencia): number =>
    (s.bloqueId === ANCLA_INICIO ? -1 : (indice.get(s.bloqueId) ?? 0)) * 1e6 +
    (s.tipo === 'bloque-insertado' ? 5e5 : s.base.desde);
  sugerencias.sort((a, b) => clave(a) - clave(b));

  const enConflicto = new Map<string, Conflicto>();
  for (const c of conflictos) for (const id of c.ids) enConflicto.set(id, c);
  const entradas: Entrada[] = [];
  const vistos = new Set<Conflicto>();
  // Unidades sin conflicto, por el id de su primer miembro (en orden de documento).
  const unidadDe = new Map(unidades(sugerencias.filter((s) => !enConflicto.has(s.id))).map((u) => [u.sugs[0].id, u] as const));
  for (const s of sugerencias) {
    const c = enConflicto.get(s.id);
    if (!c) {
      const u = unidadDe.get(s.id); // solo en el primer miembro de cada unidad
      if (u) entradas.push({ tipo: 'suelta', u });
    } else if (!vistos.has(c)) {
      vistos.add(c);
      entradas.push({ tipo: 'conflicto', c, sugs: sugerencias.filter((x) => c.ids.includes(x.id)) });
    }
  }

  const editor = new Editor({
    element: areaEditor,
    extensions: extensionesDemo(),
    content: structuredClone(base),
    editable: false,
  });

  const decidir = (cambios: [string, Decision | undefined][]) => {
    for (const [id, d] of cambios) {
      if (d) decisiones[id] = d;
      else delete decisiones[id];
    }
    ctx.guardar();
    redibujar();
  };

  function chipAutor(autor: string): HTMLElement {
    return el(
      'span',
      { class: `chip-autor ${claseAutor(autor)}`, title: esLab(autor) ? NOMBRE_LAB[autor] : autor },
      esLab(autor) ? LETRA_LAB[autor] : autor,
    );
  }

  function detalle(u: Unidad): HTMLElement {
    const s = u.principal;
    const etiqueta = s.grupo !== undefined ? (nombreGrupo.get(claveNombre(s)) ?? NOMBRE_MOVIMIENTO.movido) : NOMBRE_TIPO[s.tipo];
    const motivo = u.sugs.find((x) => x.motivo)?.motivo;
    return el(
      'div',
      { class: `detalle ${claseAutor(s.autor)}`, 'data-sug': s.id },
      el('div', { class: 'tarjeta-cabeza' }, chipAutor(s.autor), el('span', { class: 'etiqueta-tipo' }, etiqueta)),
      resumenUnidad(u),
      motivo ? el('p', { class: 'motivo-leido' }, `Motivo: ${motivo}`) : null,
    );
  }

  function botonDecision(texto: string, activo: boolean, accion: () => void, clase: string): HTMLButtonElement {
    const b = boton(texto, accion, `decision ${clase}`);
    b.setAttribute('aria-pressed', String(activo));
    return b;
  }

  function tarjeta(e: Entrada): HTMLLIElement {
    if (e.tipo === 'suelta') {
      const { u } = e;
      // Un solo Aceptar/Rechazar para toda la unidad (los dos miembros de un bloque movido).
      const d = decisiones[u.principal.id];
      const alternar = (v: Decision) => decidir(u.sugs.map((x) => [x.id, d === v ? undefined : v] as [string, Decision | undefined]));
      return el(
        'li',
        { class: `tarjeta ${d ? `decision-${d}` : ''}` },
        detalle(u),
        el(
          'div',
          { class: 'botones' },
          botonDecision('Aceptar', d === 'aceptada', () => alternar('aceptada'), 'aceptar'),
          botonDecision('Rechazar', d === 'rechazada', () => alternar('rechazada'), 'rechazar'),
        ),
      );
    }
    const { sugs } = e;
    const autores = [...new Set(sugs.map((s) => s.autor))];
    const elegido = (autor: string | null) =>
      sugs.every((s) => decisiones[s.id] === (s.autor === autor ? 'aceptada' : 'rechazada'));
    const elegir = (autor: string | null) =>
      decidir(sugs.map((s) => [s.id, s.autor === autor ? 'aceptada' : 'rechazada'] as [string, Decision]));
    const resuelto = autores.some((a) => elegido(a)) || elegido(null);
    return el(
      'li',
      { class: `tarjeta conflicto ${resuelto ? 'resuelto' : ''}` },
      el('div', { class: 'titulo-conflicto' }, resuelto ? 'Conflicto resuelto' : 'Conflicto: elija una propuesta'),
      ...unidades(sugs).map(detalle),
      el(
        'div',
        { class: 'botones' },
        ...autores.map((a) =>
          botonDecision(`Elegir ${esLab(a) ? LETRA_LAB[a] : a}`, elegido(a), () => elegir(a), `elegir ${claseAutor(a)}`),
        ),
        botonDecision('Ninguna', elegido(null), () => elegir(null), 'rechazar'),
      ),
    );
  }

  function redibujar(): void {
    // «Exportar de todos modos» no puede saltarse la revisión de lo recién aceptado.
    avisoExportar.hidden = true;
    try {
      const set = decoracionesRevisor(editor.state.doc, sugerencias, {
        conflictos,
        claseAutor,
        decision: (id) => decisiones[id],
      });
      editor.view.dispatch(editor.state.tr.setMeta(claveDecoraciones, set));
    } catch (e) {
      cajaError(error, `no se pudieron dibujar las sugerencias: ${mensajeDe(e)}`);
    }
    lista.replaceChildren(...entradas.map(tarjeta));
    if (entradas.length === 0) {
      lista.append(
        el('li', { class: 'vacio' }, 'No hay sugerencias. Los laboratorios deben editar su copia y pulsar «Guardar copia».'),
      );
    }
    const us = unidades(sugerencias);
    const aceptadas = us.filter((u) => decisiones[u.principal.id] === 'aceptada').length;
    const pendientes = us.filter((u) => !decisiones[u.principal.id]).length;
    resumen.textContent =
      `${us.length} sugerencias · ${aceptadas} aceptadas · ${pendientes} sin decidir · ` +
      `${conflictos.length} conflicto${conflictos.length === 1 ? '' : 's'}`;
  }

  function mostrarAvisoExportar(
    caracteres: ReturnType<typeof caracteresNoSoportados>,
    colgantes: string[],
  ): void {
    const lugar = (b: string | null) => (b === null ? 'en el título' : `en el bloque ${b}`);
    const punto = (c: string) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
    avisoExportar.replaceChildren(
      el('strong', {}, 'Antes de exportar: el .tex final puede no compilar o perder información.'),
      ...(caracteres.length > 0
        ? [
            el('p', {}, 'Caracteres sin forma LaTeX conocida (pdflatex puede fallar o no mostrarlos):'),
            el('ul', {}, ...caracteres.map((c) => el('li', {}, `«${c.caracter}» (${punto(c.caracter)}) ${lugar(c.bloqueId)}`))),
          ]
        : []),
      ...(colgantes.length > 0
        ? [
            el('p', {}, 'Referencias a etiquetas que ningún ítem declara (saldrán como «??»):'),
            el('ul', {}, ...colgantes.map((e) => el('li', {}, e))),
          ]
        : []),
      el(
        'div',
        { class: 'acciones' },
        boton('Exportar de todos modos', () => exportar(true), 'primario'),
        boton('Cancelar', () => (avisoExportar.hidden = true), 'secundario'),
      ),
    );
    avisoExportar.hidden = false;
  }

  function exportar(deTodosModos = false): void {
    try {
      // Un grupo se decide entero; completarGrupo lanza error si quedó decidido a medias.
      const aceptadas = completarGrupo(
        sugerencias.filter((s) => decisiones[s.id] === 'aceptada'),
        sugerencias,
        sugerencias.filter((s) => decisiones[s.id] === 'rechazada'),
      );
      const final = aplicarSugerencias(base, aceptadas);
      const v = validarDocumento(final);
      if (!v.ok) throw new Error(`el documento resultante no es válido: ${v.error}`);
      if (!deTodosModos) {
        const caracteres = caracteresNoSoportados(final);
        const colgantes = referenciasColgantes(final);
        if (caracteres.length > 0 || colgantes.length > 0) {
          mostrarAvisoExportar(caracteres, colgantes);
          cajaError(error, null);
          return;
        }
      }
      avisoExportar.hidden = true;
      const tex = exportarLatex(final);
      const nombre = (estado.archivo ?? 'capitulo.tex').replace(/\.tex$/i, '') + '-revisado.tex';
      const url = URL.createObjectURL(new Blob([tex], { type: 'text/x-tex;charset=utf-8' }));
      const a = el('a', { href: url, download: nombre });
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      cajaError(error, null);
    } catch (e) {
      cajaError(error, `no se pudo exportar: ${mensajeDe(e)}`);
    }
  }

  // Clic en una marca del texto → su tarjeta.
  areaEditor.addEventListener('click', (ev) => {
    const marca = (ev.target as HTMLElement).closest<HTMLElement>('[data-sug]');
    if (marca?.dataset.sug) resaltar(lista, marca.dataset.sug);
  });
  // Clic en una tarjeta → su marca en el texto.
  lista.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest('button')) return;
    const id = t.closest<HTMLElement>('[data-sug]')?.dataset.sug;
    if (id) resaltar(areaEditor, id);
  });

  const leyenda = el(
    'div',
    { class: 'leyenda' },
    ...LABS.filter((l) => estado.copias[l]).map((l) => el('span', {}, chipAutor(l), ` ${NOMBRE_LAB[l]}`)),
    el('span', { class: 'leyenda-conflicto' }, 'Conflicto'),
  );

  contenedor.replaceChildren(
    el(
      'div',
      { class: 'modo modo-revisor' },
      el(
        'section',
        { class: 'columna-editor', 'aria-label': 'Base con sugerencias' },
        el(
          'div',
          { class: 'barra-superior' },
          leyenda,
          el('div', { class: 'acciones' }, boton('Exportar .tex final', () => exportar(), 'primario')),
        ),
        el('p', { class: 'nota' }, 'Solo se aplican las sugerencias aceptadas; las que no tienen decisión se descartan.'),
        avisoDescartadas,
        avisosEstructura,
        avisoExportar,
        error,
        areaEditor,
      ),
      el('aside', { class: 'panel', 'aria-label': 'Decisiones' }, el('h2', {}, 'Sugerencias '), resumen, lista),
    ),
  );
  redibujar();

  return { destruir: () => editor.destroy() };
}
