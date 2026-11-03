import { afterEach, describe, expect, it, vi } from 'vitest';
import { vistaConsulta } from '../../../src/app/admin/consulta';
import { crearApi } from '../../../src/app/api';
import type { Consulta } from '../../../src/app/tipos-api';
import { fetchSimulado, json } from '../ayudas';

/** «Ahora» fijo de las pruebas: 3 de noviembre de 2026, 09:00 en Chile (UTC−3). */
const AHORA = Date.parse('2026-11-03T12:00:00Z');
const DIA = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

const base = (c: Partial<Consulta>): Consulta => ({
  apertura: '2026-11-02T12:00:00Z',
  cierre: '2026-11-12T12:00:00Z',
  etapa: 'consulta',
  motivoObligatorio: false,
  decisionesTomadas: 0,
  aportes: 0,
  reinicioPermitido: false,
  ...c,
});

async function montar(c: Consulta, ...extra: Response[]) {
  const f = fetchSimulado(json(200, c), ...extra);
  const api = crearApi({ fetch: f.fetch, alSinSesion: () => {} });
  const raiz = document.createElement('div');
  document.body.append(raiz);
  const vista = vistaConsulta(api, { ahora: () => AHORA });
  vista.montar(raiz);
  await vista.listo;
  const campo = (n: string) => raiz.querySelector(`input[name=${n}]`) as HTMLInputElement;
  const boton = (texto: string, dentro: ParentNode = raiz) =>
    [...dentro.querySelectorAll('button')].find((b) => b.textContent === texto) as HTMLButtonElement | undefined;
  const confirmar = () => raiz.querySelector('.confirmar-consulta') as HTMLElement | null;
  const cuerpo = (i: number) => JSON.parse(String(f.llamadas[i].init.body));
  return { raiz, vista, f, campo, boton, confirmar, cuerpo };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('admin: consulta — estado y fechas', () => {
  it('muestra la etapa en una insignia y las dos fechas en hora de Chile', async () => {
    const { raiz } = await montar(base({}));
    const insignia = raiz.querySelector('.insignia-etapa') as HTMLElement;
    expect(insignia.textContent).toBe('Consulta abierta');
    expect(insignia.dataset.etapa).toBe('consulta');
    const fechas = raiz.querySelector('.fechas-consulta') as HTMLElement;
    expect(fechas.textContent).toContain('02/11/2026 09:00');
    expect(fechas.textContent).toContain('12/11/2026 09:00');
    expect(fechas.textContent).toContain('hora de Chile');
  });

  it('nombra cada etapa y dice cuando no hay fechas', async () => {
    let r = await montar(base({ etapa: 'preparacion', apertura: null, cierre: null }));
    expect(r.raiz.querySelector('.insignia-etapa')?.textContent).toBe('Preparación');
    expect(r.raiz.querySelector('.fechas-consulta')?.textContent).toContain('sin fecha');
    r = await montar(base({ etapa: 'edicion_final' }));
    expect(r.raiz.querySelector('.insignia-etapa')?.textContent).toBe('Edición final');
  });

  it('los campos de fecha se editan libremente en cualquier etapa', async () => {
    for (const etapa of ['preparacion', 'consulta', 'edicion_final'] as const) {
      const { campo } = await montar(base({ etapa }));
      expect(campo('apertura').disabled).toBe(false);
      expect(campo('cierre').disabled).toBe(false);
    }
  });

  it('guardar sin cambio de etapa envía las fechas con el desfase de Chile, sin confirmar', async () => {
    const { campo, boton, vista, f, cuerpo, confirmar } = await montar(
      base({}),
      json(200, base({ cierre: '2026-11-10T12:00:00Z' })),
    );
    // Acortar el cierre ya no se rechaza.
    campo('cierre').value = '2026-11-10T09:00';
    boton('Guardar')!.click();
    await vista.listo;
    expect(confirmar()).toBeNull();
    expect(f.llamadas[1].url).toBe('/api/admin/consulta');
    expect(f.llamadas[1].init.method).toBe('PUT');
    expect(cuerpo(1)).toEqual({ apertura: '2026-11-02T12:00:00Z', cierre: '2026-11-10T09:00:00-03:00', motivoObligatorio: false });
    expect(campo('cierre').value).toBe('2026-11-10T09:00');
  });

  it('guardar fechas que cambian la etapa pide confirmación con la advertencia', async () => {
    const { campo, boton, vista, f, cuerpo, confirmar } = await montar(
      base({}),
      json(200, base({ etapa: 'edicion_final', cierre: '2026-11-03T11:00:00Z' })),
    );
    campo('cierre').value = '2026-11-03T08:00';
    boton('Guardar')!.click();
    await vista.listo;
    expect(f.llamadas).toHaveLength(1);
    expect(confirmar()?.textContent).toContain('Los laboratorios ya no podrán editar; el revisor podrá decidir.');
    boton('Confirmar', confirmar()!)!.click();
    await vista.listo;
    expect(cuerpo(1).cierre).toBe('2026-11-03T08:00:00-03:00');
  });

  it('vaciar ambas fechas vuelve a preparación; una sola vacía se rechaza en el cliente', async () => {
    const { raiz, campo, boton, vista, f, cuerpo, confirmar } = await montar(
      base({ aportes: 0 }),
      json(200, base({ etapa: 'preparacion', apertura: null, cierre: null })),
    );
    campo('cierre').value = '';
    boton('Guardar')!.click();
    await vista.listo;
    expect(f.llamadas).toHaveLength(1);
    expect(raiz.querySelector('[data-campo=cierre]')?.textContent).toContain('ambas fechas');
    campo('apertura').value = '';
    boton('Guardar')!.click();
    await vista.listo;
    boton('Confirmar', confirmar()!)!.click();
    await vista.listo;
    expect(cuerpo(1)).toEqual({ apertura: null, cierre: null, motivoObligatorio: false });
    expect(raiz.querySelector('.insignia-etapa')?.textContent).toBe('Preparación');
  });

  it('muestra los errores 400 por campo', async () => {
    const { campo, vista, boton, raiz } = await montar(
      base({ etapa: 'preparacion', apertura: '2026-12-01T12:00:00Z', cierre: '2026-12-20T12:00:00Z' }),
      json(400, {
        error: { codigo: 'entrada_invalida', mensaje: 'x', campos: { apertura: 'Fecha inválida.', cierre: 'Debe ser posterior.' } },
      }),
    );
    campo('apertura').value = '2026-12-02T09:00';
    boton('Guardar')!.click();
    await vista.listo;
    expect(raiz.querySelector('[data-campo=apertura]')?.textContent).toContain('Fecha inválida.');
    expect(raiz.querySelector('[data-campo=cierre]')?.textContent).toContain('posterior');
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

describe('admin: consulta — acciones rápidas', () => {
  it('«Abrir ahora» sin fechas: apertura ahora y cierre en 7 días, tras confirmar', async () => {
    const confirmNativo = vi.spyOn(window, 'confirm');
    const { raiz, boton, vista, f, cuerpo, confirmar } = await montar(
      base({ etapa: 'preparacion', apertura: null, cierre: null, motivoObligatorio: true }),
      json(200, base({ apertura: iso(AHORA), cierre: iso(AHORA + 7 * DIA) })),
    );
    expect(boton('Cerrar ahora')).toBeUndefined();
    boton('Abrir ahora')!.click();
    expect(confirmar()).not.toBeNull();
    expect(f.llamadas).toHaveLength(1);
    expect(document.activeElement?.textContent).toBe('Cancelar');
    boton('Confirmar', confirmar()!)!.click();
    await vista.listo;
    expect(cuerpo(1)).toEqual({ apertura: iso(AHORA), cierre: iso(AHORA + 7 * DIA), motivoObligatorio: true });
    expect(confirmar()).toBeNull();
    expect(raiz.querySelector('.insignia-etapa')?.textContent).toBe('Consulta abierta');
    expect(confirmNativo).not.toHaveBeenCalled();
  });

  it('«Abrir ahora» conserva un cierre futuro ya fijado', async () => {
    const { boton, vista, cuerpo, confirmar } = await montar(
      base({ etapa: 'preparacion', apertura: '2026-12-01T12:00:00Z', cierre: '2026-12-20T12:00:00Z' }),
      json(200, base({})),
    );
    boton('Abrir ahora')!.click();
    boton('Confirmar', confirmar()!)!.click();
    await vista.listo;
    expect(cuerpo(1)).toEqual({ apertura: iso(AHORA), cierre: '2026-12-20T12:00:00Z', motivoObligatorio: false });
  });

  it('«Cerrar ahora» fija el cierre en este instante y advierte la consecuencia', async () => {
    const { raiz, boton, vista, cuerpo, confirmar } = await montar(
      base({}),
      json(200, base({ etapa: 'edicion_final', cierre: iso(AHORA) })),
    );
    expect(boton('Abrir ahora')).toBeUndefined();
    boton('Cerrar ahora')!.click();
    expect(confirmar()?.querySelector('.advertencia')?.textContent).toBe('Los laboratorios ya no podrán editar; el revisor podrá decidir.');
    boton('Confirmar', confirmar()!)!.click();
    await vista.listo;
    expect(cuerpo(1)).toEqual({ apertura: '2026-11-02T12:00:00Z', cierre: iso(AHORA), motivoObligatorio: false });
    expect(raiz.querySelector('.insignia-etapa')?.textContent).toBe('Edición final');
    expect(raiz.querySelector('.exito')?.textContent).toContain('Cambios guardados');
  });

  it('«Extender cierre +1 día» y «+1 semana» suman al cierre actual', async () => {
    const { boton, vista, cuerpo, confirmar } = await montar(
      base({}),
      json(200, base({ cierre: '2026-11-13T12:00:00Z' })),
      json(200, base({ cierre: '2026-11-20T12:00:00Z' })),
    );
    boton('Extender cierre +1 día')!.click();
    expect(confirmar()?.querySelector('.advertencia')).toBeNull();
    boton('Confirmar', confirmar()!)!.click();
    await vista.listo;
    expect(cuerpo(1).cierre).toBe('2026-11-13T12:00:00Z');
    boton('+1 semana')!.click();
    boton('Confirmar', confirmar()!)!.click();
    await vista.listo;
    expect(cuerpo(2)).toEqual({ apertura: '2026-11-02T12:00:00Z', cierre: '2026-11-20T12:00:00Z', motivoObligatorio: false });
  });

  it('«Volver a abrir» en edición final: cierre en 7 días y aviso si hay decisiones del revisor', async () => {
    const { boton, vista, cuerpo, confirmar } = await montar(
      base({ etapa: 'edicion_final', cierre: '2026-11-03T11:00:00Z', decisionesTomadas: 3 }),
      json(200, base({ cierre: iso(AHORA + 7 * DIA) })),
    );
    expect(boton('Cerrar ahora')).toBeUndefined();
    expect(boton('Extender cierre +1 día')).toBeUndefined();
    boton('Volver a abrir')!.click();
    expect(confirmar()?.querySelector('.advertencia')?.textContent).toBe(
      'Hay 3 decisiones tomadas por el revisor. Las propuestas que los laboratorios no cambien conservan su decisión. Si un laboratorio modifica una propuesta ya decidida, pasa a ser una propuesta nueva y llega pendiente: el revisor tendrá que decidirla de nuevo.',
    );
    boton('Confirmar', confirmar()!)!.click();
    await vista.listo;
    expect(cuerpo(1)).toEqual({ apertura: '2026-11-02T12:00:00Z', cierre: iso(AHORA + 7 * DIA), motivoObligatorio: false });
  });

  it('«Volver a abrir» con versiones finales guardadas lo advierte', async () => {
    const { boton, confirmar } = await montar(base({ etapa: 'edicion_final', cierre: '2026-11-03T11:00:00Z', versionesFinal: 2 }));
    boton('Volver a abrir')!.click();
    const avisos = [...confirmar()!.querySelectorAll('.advertencia')].map((a) => a.textContent);
    expect(avisos).toContain(
      'Hay 2 versiones finales guardadas. Si los laboratorios cambian sus propuestas, el revisor tendrá que revisarlas y volver a guardar la versión final.',
    );
  });

  it('las acciones rápidas usan la hora del servidor, no la del navegador', async () => {
    // El navegador va 10 minutos atrasado respecto del servidor.
    const servidor = AHORA + 10 * 60_000;
    const { boton, vista, cuerpo, confirmar } = await montar(
      base({ etapa: 'preparacion', apertura: null, cierre: null, ahora: iso(servidor) }),
      json(200, base({ ahora: iso(servidor + 1000) })),
    );
    boton('Abrir ahora')!.click();
    boton('Confirmar', confirmar()!)!.click();
    await vista.listo;
    expect(cuerpo(1)).toEqual({ apertura: iso(servidor), cierre: iso(servidor + 7 * DIA), motivoObligatorio: false });
  });

  it('«Volver a abrir» sin decisiones no muestra esa advertencia', async () => {
    const { boton, confirmar } = await montar(base({ etapa: 'edicion_final', cierre: '2026-11-03T11:00:00Z', decisionesTomadas: 0 }));
    boton('Volver a abrir')!.click();
    expect(confirmar()?.textContent).not.toContain('decisiones');
  });

  it('«Volver a preparación» quita las fechas y advierte que el trabajo queda guardado', async () => {
    const { raiz, boton, vista, cuerpo, confirmar } = await montar(
      base({ aportes: 5 }),
      json(200, base({ etapa: 'preparacion', apertura: null, cierre: null, aportes: 5 })),
    );
    boton('Volver a preparación')!.click();
    const aviso = confirmar()?.querySelector('.advertencia')?.textContent ?? '';
    expect(aviso).toContain('quedan guardados');
    expect(aviso).toContain('no podrán editar');
    boton('Confirmar', confirmar()!)!.click();
    await vista.listo;
    expect(cuerpo(1)).toEqual({ apertura: null, cierre: null, motivoObligatorio: false });
    expect(raiz.querySelector('.insignia-etapa')?.textContent).toBe('Preparación');
    // Sin fechas ya no se ofrece volver a preparación.
    expect(boton('Volver a preparación')).toBeUndefined();
  });

  it('«Cancelar» cierra la confirmación sin llamar al servidor', async () => {
    const { boton, f, confirmar } = await montar(base({}));
    boton('Cerrar ahora')!.click();
    boton('Cancelar', confirmar()!)!.click();
    expect(confirmar()).toBeNull();
    expect(f.llamadas).toHaveLength(1);
  });
});

describe('admin: consulta — zona de pruebas', () => {
  it('no aparece si el reinicio no está habilitado', async () => {
    const { raiz } = await montar(base({ reinicioPermitido: false }));
    expect(raiz.querySelector('.zona-pruebas')).toBeNull();
  });

  it('exige escribir REINICIAR, reinicia y muestra el respaldo y los conteos', async () => {
    const resultado = {
      respaldo: 'respaldo-20261103-120000.sql.gz',
      borrados: { comentarios: 2, sugerencias: 5, revisiones_copia: 3, copias_laboratorio: 2, versiones_final: 1 },
    };
    const { raiz, vista, f, cuerpo } = await montar(
      base({ reinicioPermitido: true, aportes: 7 }),
      json(200, resultado),
      json(200, base({ etapa: 'preparacion', apertura: null, cierre: null, reinicioPermitido: true })),
    );
    const zona = raiz.querySelector('.zona-pruebas') as HTMLElement;
    expect(zona.textContent).toContain('Se borra');
    expect(zona.textContent).toContain('Se conserva');
    const entrada = zona.querySelector('input[name=confirmacion-reinicio]') as HTMLInputElement;
    const btn = [...zona.querySelectorAll('button')].find((b) => b.textContent === 'Reiniciar datos de prueba') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    for (const v of ['reiniciar', 'REINICIAR ', 'REINICIA']) {
      entrada.value = v;
      entrada.dispatchEvent(new Event('input'));
      expect(btn.disabled).toBe(true);
    }
    entrada.value = 'REINICIAR';
    entrada.dispatchEvent(new Event('input'));
    expect(btn.disabled).toBe(false);
    btn.click();
    await vista.listo;
    expect(f.llamadas[1].url).toBe('/api/admin/reiniciar');
    expect(f.llamadas[1].init.method).toBe('POST');
    expect(cuerpo(1)).toEqual({ confirmacion: 'REINICIAR' });
    const estado = zona.querySelector('[role=status]') as HTMLElement;
    expect(estado.hidden).toBe(false);
    expect(estado.textContent).toContain('respaldo-20261103-120000.sql.gz');
    expect(estado.textContent).toContain('5 sugerencias');
    expect(estado.textContent).toContain('2 comentarios');
    expect(estado.textContent).toContain('1 versión final');
    // Se vuelve a leer la consulta: ahora en preparación.
    expect(f.llamadas[2].url).toBe('/api/consulta');
    expect(raiz.querySelector('.insignia-etapa')?.textContent).toBe('Preparación');
    expect(entrada.value).toBe('');
    expect(btn.disabled).toBe(true);
  });

  it('un error del reinicio se muestra en role=alert', async () => {
    const { raiz, vista } = await montar(
      base({ reinicioPermitido: true }),
      json(500, { error: { codigo: 'respaldo_fallido', mensaje: 'No se pudo crear el respaldo de la base; no se borró nada.' } }),
    );
    const zona = raiz.querySelector('.zona-pruebas') as HTMLElement;
    const entrada = zona.querySelector('input[name=confirmacion-reinicio]') as HTMLInputElement;
    entrada.value = 'REINICIAR';
    entrada.dispatchEvent(new Event('input'));
    [...zona.querySelectorAll('button')].find((b) => b.textContent === 'Reiniciar datos de prueba')!.click();
    await vista.listo;
    const alerta = zona.querySelector('[role=alert]') as HTMLElement;
    expect(alerta.hidden).toBe(false);
    expect(alerta.textContent).toContain('no se borró nada');
  });
});
