import { describe, expect, it, vi } from 'vitest';
import { vistaUsuarios } from '../../../src/app/admin/usuarios';
import { crearApi } from '../../../src/app/api';
import type { UsuarioAdmin } from '../../../src/app/tipos-api';
import { error, fetchSimulado, json } from '../ayudas';

const USUARIOS: UsuarioAdmin[] = [
  { id: 1, nombre: 'Admin', laboratorio: 'INIA', correo: 'admin@inia.cl', roles: ['admin'], activo: true },
  { id: 2, nombre: 'Ana Pérez', laboratorio: 'Lab Norte', correo: 'ana@lab.cl', roles: ['laboratorio'], activo: true },
];
const CLAVES = [{ correo: 'ana2@lab.cl', clave: 'Xy7SecretaClave99' }];

async function montar(...extra: Response[]) {
  const f = fetchSimulado(json(200, USUARIOS), ...extra);
  const api = crearApi({ fetch: f.fetch, alSinSesion: () => {} });
  const raiz = document.createElement('div');
  const vista = vistaUsuarios(api);
  vista.montar(raiz);
  await vista.listo;
  return { raiz, vista, f };
}
const boton = (raiz: HTMLElement, texto: string) =>
  [...raiz.querySelectorAll('button')].find((b) => b.textContent === texto) as HTMLButtonElement;

describe('admin: usuarios', () => {
  it('lista y filtra', async () => {
    const { raiz } = await montar();
    expect(raiz.querySelectorAll('tbody tr')).toHaveLength(2);
    const filtro = raiz.querySelector('input[type=search]') as HTMLInputElement;
    filtro.value = 'norte';
    filtro.dispatchEvent(new Event('input'));
    const filas = raiz.querySelectorAll('tbody tr');
    expect(filas).toHaveLength(1);
    expect(filas[0].textContent).toContain('Ana Pérez');
  });

  it('claves importadas se muestran una vez y no quedan en el estado al salir', async () => {
    const { raiz, vista, f } = await montar(json(201, CLAVES), json(200, [...USUARIOS]));
    await vista.importar('nombre,correo,laboratorio\nAna 2,ana2@lab.cl,Lab Norte');
    expect(f.llamadas[1].url).toBe('/api/admin/usuarios/importar');
    expect(raiz.textContent).toContain('Xy7SecretaClave99');
    expect(raiz.textContent).toContain('no volverán a mostrarse');
    expect(vista.clavesMostradas()).toEqual(CLAVES);
    // No se guardan en el almacenamiento del navegador.
    expect(JSON.stringify({ ...localStorage })).not.toContain('Xy7');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('Xy7');
    // Ocultarlas las borra.
    boton(raiz, 'Ocultar claves').click();
    expect(raiz.textContent).not.toContain('Xy7SecretaClave99');
    expect(vista.clavesMostradas()).toEqual([]);

    // Y al salir de la vista también se olvidan.
    const otra = await montar(json(201, CLAVES), json(200, USUARIOS));
    await otra.vista.importar('nombre,correo,laboratorio\nAna 2,ana2@lab.cl,Lab Norte');
    await otra.vista.desmontar();
    expect(otra.vista.clavesMostradas()).toEqual([]);
    expect(otra.raiz.textContent).not.toContain('Xy7SecretaClave99');
  });

  it('copia todo y descarga el CSV generado en el navegador', async () => {
    const escribir = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escribir }, configurable: true });
    const crear = vi.fn(() => 'blob:prueba');
    const revocar = vi.fn();
    Object.assign(URL, { createObjectURL: crear, revokeObjectURL: revocar });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { raiz, vista } = await montar(json(201, CLAVES), json(200, USUARIOS));
    await vista.importar('nombre,correo,laboratorio\nAna 2,ana2@lab.cl,Lab Norte');
    boton(raiz, 'Copiar todo').click();
    expect(escribir).toHaveBeenCalledWith('correo\tclave\nana2@lab.cl\tXy7SecretaClave99');
    boton(raiz, 'Descargar CSV').click();
    expect(crear).toHaveBeenCalledTimes(1);
    const blob = (crear.mock.calls[0] as unknown as [Blob])[0];
    expect(await blob.text()).toBe('correo,clave\r\nana2@lab.cl,Xy7SecretaClave99\r\n');
    expect(revocar).not.toHaveBeenCalled(); // se revoca diferido
    await vi.advanceTimersByTimeAsync(1500);
    expect(revocar).toHaveBeenCalledWith('blob:prueba');
    vi.useRealTimers();
  });

  it('copiar todo da aviso visible y, si falla, ofrece seleccionar', async () => {
    const escribir = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escribir }, configurable: true });
    const { raiz, vista } = await montar(json(201, CLAVES), json(200, USUARIOS));
    await vista.importar('nombre,correo,laboratorio\nAna 2,ana2@lab.cl,Lab Norte');
    boton(raiz, 'Copiar todo').click();
    await Promise.resolve();
    await Promise.resolve();
    expect(raiz.querySelector('.copiado')?.textContent).toContain('Copiado');
    escribir.mockRejectedValueOnce(new Error('no'));
    boton(raiz, 'Copiar todo').click();
    await Promise.resolve();
    await Promise.resolve();
    expect(raiz.querySelector('.copiado')?.textContent).toContain('seleccione');
  });

  it('el CSV descargado neutraliza fórmulas de planilla', async () => {
    const crear = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: crear, revokeObjectURL: vi.fn() });
    const peligrosas = [{ correo: '=cmd@lab.cl', clave: '-abc,def' }];
    const { raiz, vista } = await montar(json(201, peligrosas), json(200, USUARIOS));
    await vista.importar('nombre,correo,laboratorio\nA,b@lab.cl,L');
    boton(raiz, 'Descargar CSV').click();
    const blob = (crear.mock.calls[0] as unknown as [Blob])[0];
    expect(await blob.text()).toBe('correo,clave\r\n\'=cmd@lab.cl,"\'-abc,def"\r\n');
    vi.useRealTimers();
  });

  it('regenerar o reimportar no descarta claves aún visibles', async () => {
    const { raiz, vista } = await montar(
      json(201, CLAVES),
      json(200, USUARIOS),
      json(200, { clave: 'OtraClave1234567' }),
    );
    await vista.importar('nombre,correo,laboratorio\nAna 2,ana2@lab.cl,Lab Norte');
    const fila = raiz.querySelectorAll('tbody tr')[1];
    ([...fila.querySelectorAll('button')].find((b) => b.textContent === 'Regenerar clave') as HTMLButtonElement).click();
    boton(raiz, 'Confirmar regeneración').click();
    await vista.listo;
    expect(raiz.textContent).toContain('Xy7SecretaClave99');
    expect(raiz.textContent).toContain('OtraClave1234567');
    expect(vista.clavesMostradas()).toHaveLength(2);
  });

  it('errores de csv por linea', async () => {
    const msg = 'No se creó ninguna cuenta; líneas con datos inválidos: 3, 7; correos repetidos o ya registrados en las líneas: 5.';
    const { raiz, vista } = await montar(
      json(400, { error: { codigo: 'entrada_invalida', mensaje: msg, campos: { csv: msg } } }),
    );
    await vista.importar('nombre,correo,laboratorio\n...');
    const items = [...raiz.querySelectorAll('.errores-csv li')].map((li) => li.textContent);
    expect(items).toEqual(['Línea 3: datos inválidos', 'Línea 7: datos inválidos', 'Línea 5: correo repetido o ya registrado']);
    expect(raiz.querySelector('.errores-csv')?.textContent).toContain('No se creó ninguna cuenta');
    expect(vista.clavesMostradas()).toEqual([]);
  });

  it('el tope de 100 filas se avisa antes de enviar', async () => {
    const { raiz, vista, f } = await montar();
    const filas = Array.from({ length: 101 }, (_, i) => `N${i},c${i}@lab.cl,Lab`).join('\n');
    await vista.importar(`nombre,correo,laboratorio\n${filas}`);
    expect(f.llamadas).toHaveLength(1);
    expect(raiz.querySelector('.errores-csv')?.textContent).toContain('100');
  });

  it('regenerar clave avisa que cierra sesiones, pide confirmar y muestra la clave una vez', async () => {
    const { raiz, vista, f } = await montar(json(200, { clave: 'NuevaClave123456' }));
    const fila = raiz.querySelectorAll('tbody tr')[1];
    ([...fila.querySelectorAll('button')].find((b) => b.textContent === 'Regenerar clave') as HTMLButtonElement).click();
    expect(raiz.textContent).toContain('cerrará todas sus sesiones abiertas');
    expect(f.llamadas).toHaveLength(1);
    boton(raiz, 'Confirmar regeneración').click();
    await vista.listo;
    expect(f.llamadas[1].url).toBe('/api/admin/usuarios/2/clave');
    expect(raiz.textContent).toContain('NuevaClave123456');
    await vista.desmontar();
    expect(raiz.textContent).not.toContain('NuevaClave123456');
  });

  it('activa/desactiva y cambia roles con PATCH; un 409 se muestra', async () => {
    const { raiz, vista, f } = await montar(
      json(200, { id: 2 }),
      json(200, { id: 2 }),
      error(409, 'operacion_no_permitida'),
    );
    const fila = () => raiz.querySelectorAll('tbody tr')[1];
    ([...fila().querySelectorAll('button')].find((b) => b.textContent === 'Desactivar') as HTMLButtonElement).click();
    await vista.listo;
    expect(f.llamadas[1].init.method).toBe('PATCH');
    expect(JSON.parse(String(f.llamadas[1].init.body))).toEqual({ activo: false });
    expect(fila().textContent).toContain('Inactivo');

    const revisor = fila().querySelector('input[value=revisor]') as HTMLInputElement;
    revisor.checked = true;
    ([...fila().querySelectorAll('button')].find((b) => b.textContent === 'Guardar roles') as HTMLButtonElement).click();
    await vista.listo;
    expect(JSON.parse(String(f.llamadas[2].init.body))).toEqual({ roles: ['laboratorio', 'revisor'] });

    const adm = raiz.querySelectorAll('tbody tr')[0];
    ([...adm.querySelectorAll('button')].find((b) => b.textContent === 'Desactivar') as HTMLButtonElement).click();
    await vista.listo;
    expect(raiz.querySelector('.error')?.textContent).toBeTruthy();
  });
});
