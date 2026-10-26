import { describe, expect, it } from 'vitest';
import { vistaConsulta } from '../../../src/app/admin/consulta';
import { crearApi } from '../../../src/app/api';
import type { Consulta } from '../../../src/app/tipos-api';
import { fetchSimulado, json } from '../ayudas';

const base = (c: Partial<Consulta>): Consulta => ({
  apertura: '2026-11-02T12:00:00Z',
  cierre: '2026-11-12T12:00:00Z',
  etapa: 'consulta',
  motivoObligatorio: false,
  ...c,
});

async function montar(c: Consulta, ...extra: Response[]) {
  const f = fetchSimulado(json(200, c), ...extra);
  const api = crearApi({ fetch: f.fetch, alSinSesion: () => {} });
  const raiz = document.createElement('div');
  const vista = vistaConsulta(api);
  vista.montar(raiz);
  await vista.listo;
  const campo = (n: string) => raiz.querySelector(`input[name=${n}]`) as HTMLInputElement;
  const guardar = () => [...raiz.querySelectorAll('button')].find((b) => b.textContent === 'Guardar') as HTMLButtonElement;
  return { raiz, vista, f, campo, guardar };
}

describe('admin: consulta', () => {
  it('muestra las fechas en hora de Chile y envía el desfase correcto', async () => {
    const { campo, guardar, vista, f } = await montar(
      base({ etapa: 'preparacion', apertura: null, cierre: null }),
      json(200, base({ etapa: 'preparacion', apertura: '2026-11-02T12:00:00Z', cierre: '2026-11-12T12:00:00Z' })),
    );
    expect(campo('apertura').value).toBe('');
    campo('apertura').value = '2026-11-02T09:00';
    campo('cierre').value = '2026-11-12T09:00';
    guardar().click();
    await vista.listo;
    expect(f.llamadas[1].url).toBe('/api/admin/consulta');
    expect(f.llamadas[1].init.method).toBe('PUT');
    expect(JSON.parse(String(f.llamadas[1].init.body))).toEqual({
      apertura: '2026-11-02T09:00:00-03:00',
      cierre: '2026-11-12T09:00:00-03:00',
      motivoObligatorio: false,
    });
    expect(campo('cierre').value).toBe('2026-11-12T09:00');
  });

  it('en consulta solo se puede extender el cierre', async () => {
    const { campo, guardar, vista, f, raiz } = await montar(
      base({}),
      json(200, base({ cierre: '2026-11-19T12:00:00Z' })),
    );
    expect(campo('apertura').disabled).toBe(true);
    expect(campo('cierre').disabled).toBe(false);
    expect(raiz.textContent).toContain('solo se puede extender el cierre');
    // Acortar se rechaza en el cliente, sin llamar.
    campo('cierre').value = '2026-11-10T09:00';
    guardar().click();
    await vista.listo;
    expect(f.llamadas).toHaveLength(1);
    expect(raiz.querySelector('[data-campo=cierre]')?.textContent).toContain('posterior');
    // Extender: reenvía los tres campos con la apertura original.
    campo('cierre').value = '2026-11-19T09:00';
    guardar().click();
    await vista.listo;
    expect(JSON.parse(String(f.llamadas[1].init.body))).toEqual({
      apertura: '2026-11-02T12:00:00Z',
      cierre: '2026-11-19T09:00:00-03:00',
      motivoObligatorio: false,
    });
  });

  it('en edición final solo cambia el motivo obligatorio', async () => {
    const { campo, vista, guardar, f } = await montar(
      base({ etapa: 'edicion_final' }),
      json(200, base({ etapa: 'edicion_final', motivoObligatorio: true })),
    );
    expect(campo('apertura').disabled).toBe(true);
    expect(campo('cierre').disabled).toBe(true);
    campo('motivoObligatorio').checked = true;
    guardar().click();
    await vista.listo;
    expect(JSON.parse(String(f.llamadas[1].init.body))).toEqual({
      apertura: '2026-11-02T12:00:00Z',
      cierre: '2026-11-12T12:00:00Z',
      motivoObligatorio: true,
    });
  });

  it('muestra los errores 400 por campo', async () => {
    const { campo, vista, guardar, raiz } = await montar(
      base({ etapa: 'preparacion' }),
      json(400, {
        error: {
          codigo: 'entrada_invalida',
          mensaje: 'x',
          campos: { apertura: 'Debe ser desde hace 5 minutos.', cierre: 'Debe ser futura.' },
        },
      }),
    );
    campo('apertura').value = '2020-01-01T09:00';
    guardar().click();
    await vista.listo;
    expect(raiz.querySelector('[data-campo=apertura]')?.textContent).toContain('hace 5 minutos');
    expect(raiz.querySelector('[data-campo=cierre]')?.textContent).toContain('futura');
    expect(raiz.querySelector('[data-campo=cierre]')?.getAttribute('role')).toBe('alert');
  });

  it('avisa de hora ambigua o inexistente', async () => {
    const { campo, raiz } = await montar(base({ etapa: 'preparacion' }));
    campo('apertura').value = '2026-09-06T00:30';
    campo('apertura').dispatchEvent(new Event('input'));
    expect(raiz.querySelector('[data-aviso=apertura]')?.textContent).toContain('no existe');
    campo('apertura').value = '2026-04-04T23:30';
    campo('apertura').dispatchEvent(new Event('input'));
    expect(raiz.querySelector('[data-aviso=apertura]')?.textContent).toContain('dos veces');
  });
});
