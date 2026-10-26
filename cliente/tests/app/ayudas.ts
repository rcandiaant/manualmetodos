import { vi } from 'vitest';

/** `fetch` simulado compartido por las pruebas de las vistas. */
export interface Llamada {
  url: string;
  init: RequestInit;
}
type Respuesta = Response | (() => Response);

export function json(estado: number, cuerpo: unknown, cabeceras: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json', ...cabeceras },
  });
}

export const error = (estado: number, codigo: string, cabeceras: Record<string, string> = {}): Response =>
  json(estado, { error: { codigo, mensaje: 'Texto del servidor.' } }, cabeceras);

/** Entrega las respuestas en orden y registra cada llamada. */
export function fetchSimulado(...respuestas: Respuesta[]) {
  const llamadas: Llamada[] = [];
  const fn = vi.fn(async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
    llamadas.push({ url: String(entrada), init });
    const r = respuestas.shift();
    if (!r) throw new Error(`llamada inesperada a ${String(entrada)}`);
    return typeof r === 'function' ? r() : r;
  });
  return { fetch: fn as unknown as typeof fetch, llamadas };
}

export const ANA = { id: 12, nombre: 'Ana Pérez', laboratorio: 'Laboratorio Norte' };
