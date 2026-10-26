import { describe, expect, it, vi } from 'vitest';
import { crearApi } from '../../../src/app/api';
import { vistaRevisor } from '../../../src/app/revisor/vista';
import { json } from '../ayudas';
import { aportes, BASE } from './datos';

// El editor no se puede crear (p. ej. un nodo que el esquema rechaza): la vista debe avisar.
vi.mock('../../../src/editor/editor', () => ({
  extensionesDemo: () => {
    throw new Error('esquema roto');
  },
}));

describe('vista del revisor ante un fallo del editor', () => {
  it('si el editor no se puede crear, muestra un aviso role=alert', async () => {
    const fetchRuta = (async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url === '/api/consulta') return json(200, { apertura: null, cierre: null, etapa: 'consulta', motivoObligatorio: false });
      if (url === '/api/capitulos') return json(200, []);
      if (url === '/api/capitulos/3/base') return json(200, { versionId: 7, docJson: BASE });
      if (url === '/api/capitulos/3/aportes') return json(200, aportes());
      throw new Error(`ruta inesperada ${url}`);
    }) as unknown as typeof fetch;
    const api = crearApi({ fetch: fetchRuta, alSinSesion: () => {} });
    const raiz = document.createElement('div');
    const vista = vistaRevisor(api, 3);
    vista.montar(raiz);
    await expect(vista.listo).resolves.toBeUndefined();
    const alerta = raiz.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alerta.hidden).toBe(false);
    expect(alerta.textContent).toContain('esquema roto');
    vista.desmontar();
  });
});
