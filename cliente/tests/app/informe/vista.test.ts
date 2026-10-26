import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearApi } from '../../../src/app/api';
import { LIMITE_PETICIONES, TAMANO_PAGINA, vistaInforme, vistaInformeUsuario, type DepsInforme } from '../../../src/app/informe/vista';
import type { Aportes, CapituloLista, Consulta, Etapa, Usuario } from '../../../src/app/tipos-api';
import { error, json } from '../ayudas';
import { BASE, comentario, deLab } from '../revisor/datos';

const consulta = (etapa: Etapa): Consulta => ({
  apertura: '2026-11-02T12:00:00Z',
  cierre: '2026-11-12T12:00:00Z',
  etapa,
  motivoObligatorio: false,
});

const cap = (id: number, orden: number, titulo = `Capítulo ${orden}`): CapituloLista => ({
  id,
  orden,
  slug: `cap-${orden}`,
  titulo,
  misCambios: 0,
  misComentarios: 0,
});

/** Aportes de prueba: Norte acepta p1, Sur queda pendiente y derivada a reunión, un comentario de Centro. */
function aportesDe(): Aportes {
  return {
    sugerencias: [
      ...deLab(12, { p1: 'Disolver 43,0 g de NaCl.' }, { estado: 'aceptada', resueltoPorNombre: 'Rita Revisora', resueltoEn: '2026-11-12T12:00:00Z' }),
      ...deLab(15, { p2: 'Agitar durante 10 minutos.' }, { derivadaReunion: true, motivo: 'Tiempo real del ensayo' }),
    ],
    comentarios: [comentario(1, 20, 'p3', 'Confirmar el <b>pH</b>.')],
  };
}

interface OpcionesServidor {
  etapa?: Etapa;
  caps?: CapituloLista[];
  aportes?: (id: number) => Aportes;
  /** Capítulos cuyo `…/aportes` falla (una vez por cada entrada; `Infinity` siempre). */
  fallos?: Map<number, number>;
  codigoFallo?: string;
  estadoFallo?: number;
  demora?: number;
  alSinSesion?: () => void;
  alPedir?: (url: string) => void;
  /** Respuestas de `base`/`aportes` retenidas hasta que se resuelva la puerta de su capítulo. */
  puertas?: Map<number, Promise<void>>;
}

function servidor(op: OpcionesServidor = {}) {
  const caps = op.caps ?? [cap(3, 1), cap(4, 2)];
  const pedidas: string[] = [];
  let activos = 0;
  let maxActivos = 0;
  const fetchRuta = (async (entrada: RequestInfo | URL) => {
    const url = String(entrada);
    pedidas.push(url);
    op.alPedir?.(url);
    if (url === '/api/consulta') return json(200, consulta(op.etapa ?? 'edicion_final'));
    if (url === '/api/capitulos') return json(200, caps);
    const m = /^\/api\/capitulos\/(\d+)\/(base|aportes)$/.exec(url);
    if (!m) throw new Error(`ruta inesperada ${url}`);
    const id = Number(m[1]);
    activos++;
    maxActivos = Math.max(maxActivos, activos);
    await new Promise((r) => setTimeout(r, op.demora ?? 0));
    await op.puertas?.get(id);
    activos--;
    if (m[2] === 'base') return json(200, { versionId: 7, docJson: BASE });
    const quedan = op.fallos?.get(id) ?? 0;
    if (quedan > 0) {
      op.fallos!.set(id, quedan - 1);
      return error(op.estadoFallo ?? 500, op.codigoFallo ?? 'error_interno');
    }
    return json(200, (op.aportes ?? aportesDe)(id));
  }) as unknown as typeof fetch;
  const api = crearApi({ fetch: fetchRuta, alSinSesion: op.alSinSesion ?? (() => {}) });
  return { api, pedidas, max: () => maxActivos };
}

const montadas: { desmontar(): unknown }[] = [];
afterEach(() => {
  while (montadas.length > 0) montadas.pop()?.desmontar();
  history.replaceState(null, '', '#');
  vi.restoreAllMocks();
});

const cuadroInmediato: DepsInforme['cuadro'] = (cb) => void setTimeout(cb, 0);

async function montar(op: OpcionesServidor & { capituloId?: number; query?: string; deps?: DepsInforme } = {}) {
  const s = servidor(op);
  const raiz = document.createElement('div');
  document.body.append(raiz);
  const vista = vistaInforme(s.api, op.capituloId, new URLSearchParams(op.query ?? ''), { cuadro: cuadroInmediato, ...op.deps });
  montadas.push(vista);
  vista.montar(raiz);
  await vista.listo;
  return { raiz, vista, ...s };
}

const filas = (raiz: HTMLElement) => [...raiz.querySelectorAll<HTMLTableRowElement>('.tabla-informe tbody tr')];
const botonCon = (raiz: HTMLElement, texto: string) =>
  [...raiz.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.startsWith(texto));
const selectorDe = (raiz: HTMLElement, nombre: string) => raiz.querySelector<HTMLSelectElement>(`select[name="${nombre}"]`)!;

describe('vista del informe (registro de cambios)', () => {
  it('solo revisor accede al informe', async () => {
    const s = servidor();
    const lab: Usuario = { id: 1, nombre: 'Ana', laboratorio: 'Lab Norte', roles: ['laboratorio', 'admin'] };
    const raiz = document.createElement('div');
    const v = vistaInformeUsuario(s.api, lab, undefined, new URLSearchParams());
    montadas.push(v);
    v.montar(raiz);
    expect(raiz.querySelector('[role="alert"]')!.textContent).toMatch(/rol revisor/);
    expect(s.pedidas).toEqual([]);

    // El servidor también lo exige: un 403 sin_permiso se explica, sin tabla.
    const neg = await montar({ fallos: new Map([[3, Infinity], [4, Infinity]]), estadoFallo: 403, codigoFallo: 'sin_permiso' });
    expect(neg.raiz.querySelector('[role="alert"]:not([hidden])')!.textContent).toMatch(/rol revisor/);
    expect(filas(neg.raiz)).toHaveLength(0);

    // Con el rol, la vista carga.
    const rev: Usuario = { ...lab, roles: ['revisor'] };
    const r2 = document.createElement('div');
    const v2 = vistaInformeUsuario(s.api, rev, undefined, new URLSearchParams(), { cuadro: cuadroInmediato });
    montadas.push(v2);
    v2.montar(r2);
    await (v2 as unknown as { listo: Promise<void> }).listo;
    expect(filas(r2).length).toBeGreaterThan(0);
  });

  it('carga todos los capitulos con concurrencia limitada y muestra avance', async () => {
    const caps = [1, 2, 3, 4, 5, 6].map((n) => cap(n + 10, n));
    const { raiz, pedidas, max } = await montar({ caps, demora: 5 });
    // Las 12 peticiones (base + aportes de 6 capítulos), nunca más de 4 a la vez.
    expect(LIMITE_PETICIONES).toBe(4);
    expect(pedidas.filter((u) => /\/(base|aportes)$/.test(u))).toHaveLength(12);
    expect(max()).toBeLessThanOrEqual(4);
    expect(max()).toBeGreaterThan(1);
    // Todas las filas de los 6 capítulos (3 aportes cada uno).
    expect(filas(raiz)).toHaveLength(18);
    expect(raiz.querySelector<HTMLElement>('.avance-informe')!.hidden).toBe(true);
  });

  it('muestra el avance mientras carga', async () => {
    const caps = [1, 2, 3].map((n) => cap(n + 10, n));
    const abrir = new Map<number, () => void>();
    const puertas = new Map(caps.map((c) => [c.id, new Promise<void>((r) => abrir.set(c.id, r))] as const));
    const s = servidor({ caps, puertas });
    const raiz = document.createElement('div');
    const vista = vistaInforme(s.api, undefined, new URLSearchParams(), { cuadro: cuadroInmediato });
    montadas.push(vista);
    vista.montar(raiz);
    await vi.waitFor(() => expect(raiz.querySelector('.avance-informe')!.textContent).toBe('Cargando 0 de 3 capítulos…'));
    abrir.get(11)!();
    await vi.waitFor(() => expect(raiz.querySelector('.avance-informe')!.textContent).toBe('Cargando 1 de 3 capítulos…'));
    abrir.get(12)!();
    abrir.get(13)!();
    await vista.listo;
    expect(raiz.querySelector<HTMLElement>('.avance-informe')!.hidden).toBe(true);
  });

  it('fallo de un capitulo muestra alerta y reintentar sin ocultar el resto', async () => {
    const caps = [cap(3, 1, 'Reactivos'), cap(4, 2, 'Muestreo')];
    const { raiz, vista } = await montar({ caps, fallos: new Map([[4, 1]]) });
    const alerta = raiz.querySelector<HTMLElement>('.fallos-informe')!;
    expect(alerta.getAttribute('role')).toBe('alert');
    expect(alerta.hidden).toBe(false);
    expect(alerta.textContent).toContain('2. Muestreo');
    expect(alerta.textContent).not.toContain('Reactivos');
    // El capítulo que sí cargó se muestra igual.
    expect(filas(raiz)).toHaveLength(3);
    expect(filas(raiz).every((f) => f.textContent!.includes('Reactivos'))).toBe(true);

    botonCon(alerta, 'Reintentar')!.click();
    await vista.listo;
    expect(alerta.hidden).toBe(true);
    expect(filas(raiz)).toHaveLength(6);
  });

  it('en preparacion muestra un estado vacio amable sin pedir aportes', async () => {
    const { raiz, pedidas } = await montar({ etapa: 'preparacion' });
    expect(raiz.querySelector('.vacio-informe')!.textContent).toMatch(/cuando se abra la consulta/);
    expect(pedidas.some((u) => u.endsWith('/aportes'))).toBe(false);
    expect(raiz.querySelector('[role="alert"]:not([hidden])')).toBeNull();
  });

  it('un 401 sigue el flujo de sesion sin mostrar el informe a medias', async () => {
    const alSinSesion = vi.fn();
    const { raiz } = await montar({ fallos: new Map([[3, 1], [4, 1]]), estadoFallo: 401, codigoFallo: 'sin_sesion', alSinSesion });
    expect(alSinSesion).toHaveBeenCalled();
    expect(raiz.querySelector<HTMLElement>('.fallos-informe')!.hidden).toBe(true);
  });

  it('filtros se reflejan en el hash y lo restauran', async () => {
    const { raiz } = await montar({ query: 'lab=Laboratorio+Sur&reunion=1' });
    expect(selectorDe(raiz, 'lab').value).toBe('Laboratorio Sur');
    expect(raiz.querySelector<HTMLInputElement>('input[name="reunion"]')!.checked).toBe(true);
    expect(filas(raiz)).toHaveLength(2); // Sur en los dos capítulos
    expect(filas(raiz).every((f) => f.textContent!.includes('Laboratorio Sur'))).toBe(true);

    const estado = selectorDe(raiz, 'estado');
    estado.value = 'aceptada';
    estado.dispatchEvent(new Event('change'));
    expect(filas(raiz)).toHaveLength(0);
    const q = new URLSearchParams(location.hash.split('?')[1]);
    expect(location.hash.startsWith('#/informe?')).toBe(true);
    expect(q.get('lab')).toBe('Laboratorio Sur');
    expect(q.get('estado')).toBe('aceptada');
    expect(q.get('reunion')).toBe('1');

    const lab = selectorDe(raiz, 'lab');
    lab.value = '';
    lab.dispatchEvent(new Event('change'));
    const reunion = raiz.querySelector<HTMLInputElement>('input[name="reunion"]')!;
    reunion.checked = false;
    reunion.dispatchEvent(new Event('change'));
    expect(filas(raiz)).toHaveLength(2); // Norte aceptada en los dos capítulos
    expect(location.hash).toBe('#/informe?estado=aceptada');
  });

  it('informe de un capitulo usa su ruta y pide solo ese capitulo', async () => {
    const { raiz, pedidas } = await montar({ capituloId: 4, caps: [cap(3, 1), cap(4, 2, 'Muestreo')] });
    expect(pedidas.filter((u) => /\/(base|aportes)$/.test(u))).toEqual(['/api/capitulos/4/base', '/api/capitulos/4/aportes']);
    expect(filas(raiz)).toHaveLength(3);
    expect(raiz.querySelector('h1')!.textContent).toContain('2. Muestreo');
    const tipo = selectorDe(raiz, 'tipo');
    tipo.value = 'comentario';
    tipo.dispatchEvent(new Event('change'));
    expect(location.hash).toBe('#/informe/4?tipo=comentario');
    expect(filas(raiz)).toHaveLength(1);
  });

  it('tabla con columnas, contadores, prefijos como etiqueta y textos sin HTML', async () => {
    const { raiz } = await montar({ capituloId: 3 });
    const cab = [...raiz.querySelectorAll('.tabla-informe thead th')].map((t) => t.textContent);
    expect(cab).toEqual(['Capítulo', 'Ubicación', 'Original → Propuesta', 'Laboratorio', 'Motivo', 'Decisión', 'Resuelto por', 'Fecha', 'Nota']);
    const contadores = raiz.querySelector('.contadores-informe')!.textContent!;
    expect(contadores).toContain('1 aceptada');
    expect(contadores).toContain('1 pendiente');
    expect(contadores).toContain('1 comentario abierto');
    const norte = filas(raiz).find((f) => f.textContent!.includes('Laboratorio Norte'))!;
    expect(norte.textContent).toContain('Rita Revisora');
    expect(norte.textContent).toContain('2026-11-12 09:00');
    const sur = filas(raiz).find((f) => f.textContent!.includes('Laboratorio Sur'))!;
    expect(sur.textContent).toMatch(/derivada a reunión/);
    const com = filas(raiz).find((f) => f.textContent!.includes('Laboratorio Centro'))!;
    expect(com.textContent).toContain('Confirmar el <b>pH</b>.');
    expect(com.querySelector('b')).toBeNull();
    expect(raiz.querySelector('.ayuda-informe')!.textContent).toMatch(/aproximad/);
  });

  it('prefijos de tipo de cambio se muestran como etiqueta aparte', async () => {
    const sugs = [
      {
        ...deLab(12, { p1: 'Disolver 43,0 g de NaCl.' })[0],
        tipo: 'bloque-insertado' as const,
        propuesta: [{ type: 'parrafo', attrs: { bid: 'n1' }, content: [{ type: 'text', text: 'Nuevo <i>paso</i>' }] }],
        original: [],
      },
    ];
    const { raiz } = await montar({ capituloId: 3, aportes: () => ({ sugerencias: sugs, comentarios: [] }) });
    const celda = filas(raiz)[0].querySelector('.propuesta-informe')!;
    expect(celda.querySelector('.etiqueta-cambio')!.textContent).toBe('bloque insertado');
    expect(celda.textContent).toContain('Nuevo <i>paso</i>');
    expect(celda.querySelector('i')).toBeNull();
  });

  it('una propuesta de contenido que empieza con corchetes no se toma como etiqueta', async () => {
    const s = { ...deLab(12, { p1: 'Disolver 43,0 g de NaCl.' })[0] };
    s.propuesta = [{ type: 'text', text: '[bloque eliminado] literal' }];
    const { raiz } = await montar({ capituloId: 3, aportes: () => ({ sugerencias: [s], comentarios: [] }) });
    const celda = filas(raiz)[0].querySelector('.propuesta-informe')!;
    expect(celda.querySelector('.etiqueta-cambio')).toBeNull();
    expect(celda.textContent).toBe('[bloque eliminado] literal');
  });

  it('al salir de la vista no se envian las peticiones que quedaban en cola', async () => {
    const caps = [1, 2, 3, 4, 5, 6].map((n) => cap(n + 10, n));
    let soltar: () => void = () => {};
    const puerta = new Promise<void>((r) => (soltar = r));
    const s = servidor({ caps, puertas: new Map(caps.map((c) => [c.id, puerta] as const)) });
    const raiz = document.createElement('div');
    const vista = vistaInforme(s.api, undefined, new URLSearchParams(), { cuadro: cuadroInmediato });
    vista.montar(raiz);
    const capitulo = () => s.pedidas.filter((u) => /\/(base|aportes)$/.test(u)).length;
    await vi.waitFor(() => expect(capitulo()).toBe(LIMITE_PETICIONES));
    vista.desmontar();
    soltar();
    await vista.listo;
    expect(capitulo()).toBe(LIMITE_PETICIONES);
  });

  it('imprimir llama window.print y el titulo impreso nombra los filtros', async () => {
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => {});
    const { raiz } = await montar({ query: 'lab=Laboratorio+Norte&estado=aceptada', caps: [cap(3, 1, 'Reactivos')] });
    botonCon(raiz, 'Imprimir')!.click();
    await vi.waitFor(() => expect(imprimir).toHaveBeenCalledTimes(1));
    const titulo = raiz.querySelector('.titulo-impreso')!.textContent!;
    expect(titulo).toContain('Registro de cambios');
    expect(titulo).toContain('Laboratorio: Laboratorio Norte');
    expect(titulo).toContain('Estado: aceptada');
    expect(titulo).toMatch(/\d{2}-\d{2}-\d{4}/);
    // Botones y navegación no se imprimen.
    for (const b of raiz.querySelectorAll('button')) expect(b.closest('.no-imprimir')).not.toBeNull();
  });

  it('tabla grande se pagina con mostrar mas e imprimir pinta todas las filas antes', async () => {
    const base = deLab(12, { p1: 'Disolver 43,0 g de NaCl.' })[0];
    const muchas = Array.from({ length: 1200 }, (_, i) => ({ ...base, sugerenciaId: 5000 + i, laboratorio: `Lab ${i % 35}` }));
    let alImprimir = -1;
    let raizRef: HTMLElement | null = null;
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => {
      alImprimir = raizRef ? filas(raizRef).length : -1;
    });
    const { raiz } = await montar({ capituloId: 3, aportes: () => ({ sugerencias: muchas, comentarios: [] }) });
    raizRef = raiz;
    expect(TAMANO_PAGINA).toBe(500);
    expect(filas(raiz)).toHaveLength(500);
    expect(raiz.querySelector('.contadores-informe')!.textContent).toContain('1200');
    botonCon(raiz, 'Mostrar 500 más')!.click();
    expect(filas(raiz)).toHaveLength(1000);
    botonCon(raiz, 'Imprimir')!.click();
    await vi.waitFor(() => expect(imprimir).toHaveBeenCalledTimes(1));
    expect(alImprimir).toBe(1200); // todas pintadas antes de llamar a print
    expect(filas(raiz)).toHaveLength(1200);
  });

  it('css de impresion repite cabecera y oculta navegacion', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app/informe/informe.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const i = css.indexOf('@media print');
    expect(i).toBeGreaterThanOrEqual(0);
    // Bloque balanceado de @media print.
    let nivel = 0;
    let fin = -1;
    for (let k = css.indexOf('{', i); k < css.length; k++) {
      if (css[k] === '{') nivel++;
      else if (css[k] === '}' && --nivel === 0) {
        fin = k;
        break;
      }
    }
    const print = css.slice(i, fin).replace(/\s+/g, ' ');
    const regla = (selector: RegExp) => {
      const m = new RegExp(`${selector.source}[^{]*\\{([^}]*)\\}`).exec(print);
      return m ? m[1] : '';
    };
    expect(regla(/thead/)).toMatch(/display:\s*table-header-group/);
    expect(regla(/\btr\b/)).toMatch(/break-inside:\s*avoid/);
    expect(regla(/\.no-imprimir/)).toMatch(/display:\s*none/);
    expect(regla(/\.cabecera-app/)).toMatch(/display:\s*none/);
    expect(regla(/\.titulo-impreso/)).toMatch(/display:\s*block/);
    // Hoja apaisada solo para el informe: página con nombre, asignada al imprimir.
    expect(regla(/\.vista-informe/)).toMatch(/page:\s*informe/);
    const pagina = /@page\s+informe\s*\{([^}]*)\}/.exec(css);
    expect(pagina?.[1]).toMatch(/size:\s*landscape/);
    expect(pagina?.[1]).toMatch(/margin:\s*12mm/);
    expect(/@page\s*\{/.test(css)).toBe(false); // ninguna @page sin nombre (afectaría otras vistas)
    // Ningún otro @media (p. ej. el responsivo) se aplica al imprimir.
    for (const m of css.matchAll(/@media([^{]*)\{/g)) {
      if (m[1].trim() !== 'print') expect(m[1]).toMatch(/\bscreen\b/);
    }
    // Todo bajo la clase raíz de la vista.
    for (const sel of print.match(/[^{}]+(?=\{)/g)!.slice(1)) {
      for (const parte of sel.split(',')) expect(parte.trim()).toMatch(/^\.vista-informe\b/);
    }
  });

  it('descargar csv usa las filas filtradas', async () => {
    let blob: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return 'blob:informe';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    let descargado = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      descargado = this.download;
    });
    vi.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true });
    try {
      const { raiz } = await montar({ query: 'lab=Laboratorio+Sur', deps: { ahora: () => new Date('2026-11-13T02:30:00Z') } });
      botonCon(raiz, 'Descargar CSV')!.click();
      expect(descargado).toBe('registro-cambios-20261112.csv'); // fecha de Chile
      expect(blob).not.toBeNull();
      expect(blob!.type).toMatch(/^text\/csv/);
      const texto = await blob!.text();
      const lineas = texto.replace(/^﻿/, '').trim().split('\n');
      expect(lineas).toHaveLength(3); // cabecera + Sur en dos capítulos
      expect(lineas.slice(1).every((l) => l.includes('Laboratorio Sur'))).toBe(true);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1500);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:informe');
    } finally {
      vi.useRealTimers();
    }
  });
});

beforeEach(() => {
  history.replaceState(null, '', '#/informe');
});
