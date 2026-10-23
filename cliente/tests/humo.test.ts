import { describe, expect, it } from 'vitest';
import type { Rango } from '../src/tipos';

describe('humo', () => {
  it('suma y acepta tipos del proyecto', () => {
    const r: Rango = { desde: 0, hasta: 1 };
    expect(1 + 1).toBe(2);
    expect(r.hasta).toBeGreaterThan(r.desde);
  });
});
