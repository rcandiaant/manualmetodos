import { describe, expect, it } from 'vitest';
import { armarCsv, celdaCsv } from '../../../src/app/csv';
import {
  csvInforme,
  describirFiltros,
  filasInforme,
  filtrar,
  type FilaInforme,
} from '../../../src/app/informe/datos';
import type { Comentario, SugerenciaServidor } from '../../../src/app/tipos-api';
import type { DocJSON } from '../../../src/tipos';
import { doc, ecuacion, item, lista, parrafo, texto } from '../../ayudantes-doc';

const seccion = (bid: string, titulo: string): DocJSON => ({ type: 'seccion', attrs: { bid }, content: [texto(titulo)] });
const mat = (latex: string): DocJSON => ({ type: 'matematica', attrs: { latex } });

/** Base: «1. Alcance» con un párrafo, «2. Reactivos» con una lista de dos ítems y una ecuación. */
const baseA = doc(
  parrafo('p0', 'Preámbulo'),
  seccion('s1', 'Alcance'),
  parrafo('p1', 'Se aplica a suelos.'),
  seccion('s2', 'Reactivos'),
  lista(item(null, parrafo('i1', 'Agua destilada')), item(null, parrafo('i2', 'Ácido ', mat('H_2SO_4'), ' 1 M'))),
  ecuacion('e1', 'x^2'),
);

let n = 0;
function sug(over: Partial<SugerenciaServidor>): SugerenciaServidor {
  n++;
  return {
    id: `s${n}`,
    autor: 'u1',
    bloqueId: 'p1',
    base: { desde: 0, hasta: 1 },
    copia: { desde: 0, hasta: 1 },
    original: [texto('Se')],
    propuesta: [texto('Esto se')],
    tipo: 'contenido',
    estado: 'pendiente',
    motivo: '',
    sugerenciaId: n,
    usuarioId: 1,
    laboratorio: 'Lab Norte',
    versionId: 10,
    notaResolucion: null,
    derivadaReunion: false,
    resueltoPor: null,
    resueltoEn: null,
    resueltoPorNombre: null,
    ...over,
  };
}

function com(over: Partial<Comentario>): Comentario {
  n++;
  return {
    id: n,
    bloqueId: 'p1',
    rango: { desde: 0, hasta: 1 },
    texto: 'Comentario',
    estado: 'abierto',
    creado: '2026-11-12T12:00:00Z',
    notaResolucion: null,
    usuarioId: 1,
    laboratorio: 'Lab Norte',
    resueltoPor: null,
    resueltoEn: null,
    resueltoPorNombre: null,
    ...over,
  };
}

const capA = { id: 1, titulo: 'pH en suelos', base: baseA };

function unCapitulo(sugerencias: SugerenciaServidor[], comentarios: Comentario[] = []): FilaInforme[] {
  return filasInforme([capA], new Map([[1, { sugerencias, comentarios }]]));
}

describe('informe: filasInforme', () => {
  it('ubicacion con seccion e item de lista', () => {
    const filas = unCapitulo([
      sug({ bloqueId: 'i2', original: [texto('Ácido '), mat('H_2SO_4')], propuesta: [texto('Ácido '), mat('HCl')] }),
      sug({ bloqueId: 'p1' }),
      sug({ bloqueId: 's2', original: [texto('Reactivos')], propuesta: [texto('Reactivos y materiales')] }),
      sug({ bloqueId: 'e1', tipo: 'bloque-eliminado', original: [ecuacion('e1', 'x^2')], propuesta: [] }),
      sug({ bloqueId: 'p0' }),
    ]);
    // Orden de documento: p0, p1, s2, i2, e1.
    expect(filas.map((f) => f.ubicacion)).toEqual([
      'Inicio del capítulo',
      '1. Alcance',
      '2. Reactivos',
      '2. Reactivos › ítem 2',
      '2. Reactivos',
    ]);
    const i2 = filas[3];
    expect(i2.original).toBe('Ácido $H_2SO_4$');
    expect(i2.propuesta).toBe('Ácido $HCl$');
    expect(filas[4].original).toBe('$x^2$');
    expect(filas[4].propuesta).toBe('[bloque eliminado]');
    expect(i2).toMatchObject({ capituloId: 1, capitulo: 'pH en suelos', tipo: 'sugerencia', laboratorio: 'Lab Norte', estado: 'pendiente' });
  });

  it('bloque inexistente dice no encontrado', () => {
    const filas = unCapitulo(
      [sug({ bloqueId: 'borrado', versionId: 9, laboratorio: 'Lab A' }), sug({ bloqueId: 'p1', laboratorio: 'Lab B' })],
      [com({ bloqueId: 'tampoco', laboratorio: 'Lab C', rango: { desde: 2, hasta: 5 } })],
    );
    expect(filas).toHaveLength(3);
    // Los no encontrados van al final del capítulo.
    expect(filas[0].ubicacion).toBe('1. Alcance');
    expect(filas[1].ubicacion).toBe('Bloque no encontrado en la versión vigente');
    expect(filas[2].ubicacion).toBe('Bloque no encontrado en la versión vigente');
    expect(filas[2].original).toBe('');
  });

  it('comentario aparece como fila con su texto', () => {
    // Tokens de i2: «Ácido», « », $H_2SO_4$, « », «1», « », «M».
    const filas = unCapitulo([], [com({ bloqueId: 'i2', rango: { desde: 0, hasta: 3 }, texto: '¿Qué concentración?', notaResolucion: 'Se aclara' })]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      tipo: 'comentario',
      ubicacion: '2. Reactivos › ítem 2',
      original: 'Ácido $H_2SO_4$',
      propuesta: '¿Qué concentración?',
      motivo: '',
      estado: 'abierto',
      derivadaReunion: false,
      nota: 'Se aclara',
    });
  });

  it('fechas en America/Santiago y nombre de quien resolvio', () => {
    const filas = unCapitulo(
      [
        sug({
          estado: 'aceptada',
          resueltoPor: 7,
          resueltoPorNombre: 'Ana Revisora',
          resueltoEn: '2026-11-12T12:00:00Z',
          derivadaReunion: true,
          notaResolucion: 'Ok',
          motivo: 'Claridad',
        }),
      ],
      [com({ bloqueId: 'p0', estado: 'resuelto', resueltoPorNombre: 'Ana Revisora', resueltoEn: '2026-07-15T13:00:00Z' })],
    );
    expect(filas[0]).toMatchObject({ tipo: 'comentario', resueltoPor: 'Ana Revisora', resueltoEn: '2026-07-15 09:00', estado: 'resuelto' });
    expect(filas[1]).toMatchObject({
      tipo: 'sugerencia',
      resueltoPor: 'Ana Revisora',
      resueltoEn: '2026-11-12 09:00',
      derivadaReunion: true,
      nota: 'Ok',
      motivo: 'Claridad',
      estado: 'aceptada',
    });
    // Pendiente: sin nombre ni fecha.
    const pend = unCapitulo([sug({})])[0];
    expect(pend.resueltoPor).toBe('');
    expect(pend.resueltoEn).toBe('');
  });

  it('formato antepone a la propuesta las marcas agregadas y quitadas', () => {
    const filas = unCapitulo([
      sug({
        tipo: 'formato',
        original: [texto('Se', ['cursiva']), texto(' aplica')],
        propuesta: [texto('Se', ['negrita']), texto(' aplica')],
      }),
      sug({
        tipo: 'formato',
        laboratorio: 'Lab Sur',
        original: [texto('H'), texto('2', ['superindice']), mat('x')],
        propuesta: [texto('H'), texto('2', ['subindice']), mat('x')],
      }),
      sug({
        tipo: 'formato',
        laboratorio: 'Lab Tres',
        // Parcial: «Se» ya era negrita; ahora también « aplica». El conjunto de marcas no cambia.
        original: [texto('Se', ['negrita']), texto(' aplica')],
        propuesta: [texto('Se aplica', ['negrita'])],
      }),
    ]);
    const por = (lab: string) => filas.find((f) => f.laboratorio === lab) as FilaInforme;
    expect(por('Lab Norte').original).toBe('Se aplica');
    expect(por('Lab Norte').propuesta).toBe('[formato: +negrita, −cursiva] Se aplica');
    expect(por('Lab Sur').propuesta).toBe('[formato: +subíndice, −superíndice] H2$x$');
    expect(por('Lab Tres').propuesta).toBe('[formato: +negrita] Se aplica');
  });

  it('bloque insertado, eliminado y movido se nombran en la propuesta', () => {
    const filas = unCapitulo([
      sug({ bloqueId: 'p1', tipo: 'bloque-insertado', original: [], propuesta: [parrafo(null, 'Nuevo párrafo')], laboratorio: 'A' }),
      sug({ bloqueId: 'p1', tipo: 'bloque-eliminado', original: [parrafo('p1', 'Se aplica a suelos.')], propuesta: [], laboratorio: 'B' }),
      sug({ bloqueId: 'p0', tipo: 'bloque-eliminado', grupo: 'mov:p0', original: [parrafo('p0', 'Preámbulo')], propuesta: [], laboratorio: 'C' }),
      sug({ bloqueId: 'i1', tipo: 'bloque-insertado', grupo: 'mov:p0', original: [], propuesta: [parrafo('p0', 'Preámbulo')], laboratorio: 'C' }),
    ]);
    expect(filas.map((f) => f.propuesta)).toEqual([
      '[bloque movido: lugar original]',
      '[bloque insertado] Nuevo párrafo',
      '[bloque eliminado]',
      '[bloque movido: lugar nuevo] Preámbulo',
    ]);
    expect(filas[2].original).toBe('Se aplica a suelos.');
  });

  it('fecha ilegible se muestra tal cual sin romper el informe', () => {
    const f = unCapitulo([sug({ estado: 'aceptada', resueltoEn: 'basura', resueltoPorNombre: 'Ana' })])[0];
    expect(f.resueltoEn).toBe('basura');
  });

  it('una sugerencia identica de varios laboratorios da una fila por laboratorio, ordenadas por laboratorio', () => {
    const filas = unCapitulo([sug({ laboratorio: 'Lab Sur' }), sug({ laboratorio: 'Lab Centro' }), sug({ laboratorio: 'Lab Norte' })]);
    expect(filas.map((f) => f.laboratorio)).toEqual(['Lab Centro', 'Lab Norte', 'Lab Sur']);
  });

  it('capitulos en su orden', () => {
    const capB = { id: 2, titulo: 'Fósforo', base: baseA, orden: 1 };
    const capA2 = { ...capA, orden: 2 };
    const aportes = new Map([
      [1, { sugerencias: [sug({})], comentarios: [] }],
      [2, { sugerencias: [sug({})], comentarios: [] }],
    ]);
    expect(filasInforme([capA2, capB], aportes).map((f) => f.capituloId)).toEqual([2, 1]);
  });
});

describe('informe: filtrar y describirFiltros', () => {
  const capB = { id: 2, titulo: 'Fósforo', base: baseA };
  const aportes = new Map([
    [
      1,
      {
        sugerencias: [
          sug({ laboratorio: 'Lab A', estado: 'aceptada', derivadaReunion: true }),
          sug({ laboratorio: 'Lab B', estado: 'rechazada' }),
        ],
        comentarios: [com({ laboratorio: 'Lab A' })],
      },
    ],
    [2, { sugerencias: [sug({ laboratorio: 'Lab A', estado: 'aceptada' })], comentarios: [] }],
  ]);
  const filas = filasInforme([capA, capB], aportes);

  it('filtrar por capitulo laboratorio estado y solo reunion', () => {
    expect(filas).toHaveLength(4);
    expect(filtrar(filas, {})).toHaveLength(4);
    expect(filtrar(filas, { capituloId: 2 }).map((f) => f.capituloId)).toEqual([2]);
    expect(filtrar(filas, { laboratorio: 'Lab A' })).toHaveLength(3);
    expect(filtrar(filas, { estado: 'aceptada' })).toHaveLength(2);
    expect(filtrar(filas, { soloReunion: true })).toHaveLength(1);
    expect(filtrar(filas, { tipo: 'comentario' })).toHaveLength(1);
    expect(filtrar(filas, { capituloId: 1, laboratorio: 'Lab A', estado: 'aceptada', soloReunion: true })).toHaveLength(1);
    expect(filtrar(filas, { capituloId: 1, laboratorio: 'Lab B', soloReunion: true })).toHaveLength(0);
  });

  it('describirFiltros nombra los filtros activos', () => {
    const caps = [capA, capB];
    expect(describirFiltros({}, caps)).toBe('Todos los aportes');
    const d = describirFiltros({ capituloId: 2, laboratorio: 'Lab A', estado: 'aceptada', soloReunion: true, tipo: 'sugerencia' }, caps);
    expect(d).toContain('Capítulo: Fósforo');
    expect(d).toContain('Laboratorio: Lab A');
    expect(d).toContain('Estado: aceptada');
    expect(d).toContain('Tipo: sugerencias');
    expect(d).toContain('Solo derivadas a reunión');
    expect(describirFiltros({ capituloId: 99 }, caps)).toContain('Capítulo: 99');
  });
});

describe('informe: CSV', () => {
  it('csv con BOM separador punto y coma y formulas neutralizadas', () => {
    expect(armarCsv(['a', 'b'], [['1', '=SUMA(A1)'], ['x;y', 'z']])).toBe('﻿a;b\n1;\'=SUMA(A1)\n"x;y";z\n');
    // celdaCsv conserva su comportamiento.
    expect(celdaCsv('+1')).toBe("'+1");
    expect(celdaCsv('a"b')).toBe('"a""b"');

    const filas = unCapitulo([
      sug({ propuesta: [texto('=HYPERLINK("x")')], laboratorio: '@Lab', motivo: 'línea 1\nlínea 2', derivadaReunion: true }),
    ]);
    const csv = csvInforme(filas);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).not.toContain('\r');
    const lineas = csv.slice(1).split('\n');
    expect(lineas[0]).toBe(
      'Capítulo;Tipo;Ubicación;Texto original;Propuesta o comentario;Laboratorio;Motivo;Estado;Derivada a reunión;Resuelto por;Resuelto en;Nota',
    );
    expect(lineas[1]).toContain(`pH en suelos;Sugerencia;1. Alcance;Se;"'=HYPERLINK(""x"")";'@Lab;"línea 1`);
    expect(csv).toContain('línea 2";pendiente;Sí;;;\n');
    expect(csv.endsWith('\n')).toBe(true);
  });
});

describe('informe: escala', () => {
  it('35 labs x 15 capitulos x 20 sugerencias en menos de 1500 ms', () => {
    // Capítulo sintético: 10 secciones con 2 párrafos y una lista de 3 ítems cada una.
    const bloques: DocJSON[] = [];
    const bids: string[] = [];
    for (let s = 0; s < 10; s++) {
      bloques.push(seccion(`s${s}`, `Sección ${s}`));
      for (let p = 0; p < 2; p++) {
        bloques.push(parrafo(`p${s}-${p}`, `Texto del párrafo ${p} con `, mat('x_i'), ' y más palabras para tokenizar.'));
        bids.push(`p${s}-${p}`);
      }
      bloques.push(lista(item(null, parrafo(`i${s}-0`, 'uno')), item(null, parrafo(`i${s}-1`, 'dos')), item(null, parrafo(`i${s}-2`, 'tres'))));
      bids.push(`i${s}-0`, `i${s}-1`, `i${s}-2`);
    }
    const base = doc(...bloques);
    const capitulos = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, titulo: `Capítulo ${i + 1}`, base, orden: i + 1 }));
    const estados = ['pendiente', 'aceptada', 'rechazada', 'modificada'] as const;
    const aportes = new Map(
      capitulos.map((c) => {
        const sugerencias: SugerenciaServidor[] = [];
        const comentarios: Comentario[] = [];
        for (let l = 0; l < 35; l++) {
          for (let k = 0; k < 20; k++) {
            sugerencias.push(
              sug({
                bloqueId: k === 19 ? 'inexistente' : bids[(l + k) % bids.length],
                laboratorio: `Lab ${l}`,
                estado: estados[k % 4],
                derivadaReunion: k % 7 === 0,
                resueltoEn: k % 4 === 0 ? null : '2026-11-12T12:00:00Z',
                resueltoPorNombre: k % 4 === 0 ? null : 'Ana',
                original: [texto('Texto del párrafo '), mat('x_i')],
                propuesta: [texto('Texto corregido '), mat('y_i')],
              }),
            );
          }
          comentarios.push(com({ bloqueId: bids[l % bids.length], laboratorio: `Lab ${l}`, rango: { desde: 0, hasta: 4 } }));
        }
        return [c.id, { sugerencias, comentarios }] as const;
      }),
    );
    const t0 = performance.now();
    const filas = filasInforme(capitulos, aportes);
    const filtradas = filtrar(filas, { laboratorio: 'Lab 3', estado: 'aceptada' });
    const reunion = filtrar(filas, { soloReunion: true, capituloId: 7 });
    const ms = performance.now() - t0;
    expect(filas).toHaveLength(15 * 35 * 21);
    expect(filtradas.length).toBeGreaterThan(0);
    expect(reunion.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1500);
  });
});
