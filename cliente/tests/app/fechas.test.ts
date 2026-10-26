import { describe, expect, it } from 'vitest';
import { analizarLocal, aIsoConZona, aLocal } from '../../src/app/fechas';

describe('fechas', () => {
  it('fechas de la consulta respetan America/Santiago y el horario de verano', () => {
    // Fecha normal en verano austral (UTC-3).
    expect(aIsoConZona('2026-11-12T09:00')).toBe('2026-11-12T09:00:00-03:00');
    // Septiembre: el horario de verano empieza el sábado 5 a las 24:00.
    expect(aIsoConZona('2026-09-04T09:00')).toBe('2026-09-04T09:00:00-04:00');
    expect(aIsoConZona('2026-09-10T09:00')).toBe('2026-09-10T09:00:00-03:00');
    // Abril: termina el sábado 4 a las 24:00.
    expect(aIsoConZona('2026-04-03T09:00')).toBe('2026-04-03T09:00:00-03:00');
    expect(aIsoConZona('2026-04-10T09:00')).toBe('2026-04-10T09:00:00-04:00');
    // Invierno.
    expect(aIsoConZona('2026-07-15T09:00')).toBe('2026-07-15T09:00:00-04:00');
    // Es el mismo instante que el UTC esperado.
    expect(new Date(aIsoConZona('2026-11-12T09:00')).toISOString()).toBe('2026-11-12T12:00:00.000Z');
    expect(new Date(aIsoConZona('2026-07-15T09:00')).toISOString()).toBe('2026-07-15T13:00:00.000Z');
  });

  it('aLocal es la conversión inversa', () => {
    expect(aLocal('2026-11-12T12:00:00Z')).toBe('2026-11-12T09:00');
    expect(aLocal('2026-07-15T13:00:00Z')).toBe('2026-07-15T09:00');
    expect(aLocal('2026-04-05T02:30:00Z')).toBe('2026-04-04T23:30');
    for (const l of ['2026-09-10T09:00', '2026-04-10T09:00', '2026-12-31T23:59', '2026-01-01T00:00']) {
      expect(aLocal(new Date(aIsoConZona(l)).toISOString())).toBe(l);
    }
    expect(() => aLocal('basura')).toThrow(RangeError);
  });

  it('hora ambigua elige la primera y hora inexistente se avisa', () => {
    // 4 de abril 23:30 ocurre dos veces: se toma la primera (UTC-3).
    const amb = analizarLocal('2026-04-04T23:30');
    expect(amb.estado).toBe('ambigua');
    expect(amb.iso).toBe('2026-04-04T23:30:00-03:00');
    // 6 de septiembre 00:30 no existe (00:00 salta a 01:00).
    const ine = analizarLocal('2026-09-06T00:30');
    expect(ine.estado).toBe('inexistente');
    expect(aLocal(new Date(ine.iso).toISOString())).toBe('2026-09-06T01:30');
    expect(analizarLocal('2026-11-12T09:00').estado).toBe('normal');
    expect(() => aIsoConZona('12/11/2026')).toThrow(RangeError);
  });
});
