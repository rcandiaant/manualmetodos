/**
 * Conversión entre `datetime-local` ("2026-11-12T09:00") y ISO con desfase para una zona
 * (por defecto America/Santiago), con `Intl.DateTimeFormat` y sin dependencias.
 */

export const ZONA_CHILE = 'America/Santiago';

const formatos = new Map<string, Intl.DateTimeFormat>();
function formato(zona: string): Intl.DateTimeFormat {
  let f = formatos.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatos.set(zona, f);
  }
  return f;
}

/** Hora de pared en `zona` para el instante `ms`, expresada como ms "UTC" de esa hora. */
function paredMs(ms: number, zona: string): number {
  const p: Record<string, number> = {};
  for (const parte of formato(zona).formatToParts(new Date(ms))) {
    if (parte.type !== 'literal') p[parte.type] = Number(parte.value);
  }
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** Desfase (ms) de la zona en el instante `ms`: pared - instante. */
const desfaseMs = (ms: number, zona: string): number => paredMs(ms, zona) - ms;

const RE_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function textoDesfase(ms: number): string {
  const min = Math.round(ms / 60000);
  const signo = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  return `${signo}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

const dos = (n: number): string => String(n).padStart(2, '0');

export type EstadoLocal = 'normal' | 'ambigua' | 'inexistente';

export interface AnalisisLocal {
  /** ISO con desfase, p. ej. `2026-11-12T09:00:00-03:00`. */
  iso: string;
  estado: EstadoLocal;
}

/**
 * Convierte una hora local de la zona a ISO con desfase. En una hora ambigua (se repite al
 * retrasar el reloj) elige la primera; en una inexistente (se salta al adelantarlo) usa el
 * desfase anterior, es decir, la hora queda adelantada. `estado` lo dice para avisarlo.
 */
export function analizarLocal(local: string, zona: string = ZONA_CHILE): AnalisisLocal {
  const m = RE_LOCAL.exec(local);
  if (!m) throw new RangeError(`Fecha local inválida: ${local}`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const pared = Date.UTC(y, mo - 1, d, h, mi, 0);
  const comprobacion = new Date(pared);
  if (
    comprobacion.getUTCFullYear() !== y ||
    comprobacion.getUTCMonth() !== mo - 1 ||
    comprobacion.getUTCDate() !== d ||
    comprobacion.getUTCHours() !== h
  ) {
    throw new RangeError(`Fecha local inválida: ${local}`);
  }
  const antes = desfaseMs(pared - 86_400_000, zona);
  const despues = desfaseMs(pared + 86_400_000, zona);
  const candidatos = [...new Set([antes, despues])]
    .map((off) => ({ off, t: pared - off }))
    .filter(({ off, t }) => desfaseMs(t, zona) === off)
    .sort((a, b) => a.t - b.t);
  let off: number;
  let estado: EstadoLocal = 'normal';
  if (candidatos.length === 0) {
    off = antes;
    estado = 'inexistente';
  } else {
    off = candidatos[0].off;
    if (candidatos.length > 1) estado = 'ambigua';
  }
  return { iso: `${local}:00${textoDesfase(off)}`, estado };
}

export const aIsoConZona = (local: string, zona: string = ZONA_CHILE): string => analizarLocal(local, zona).iso;

/** Instante (ISO con Z u otro desfase) a hora local de la zona: `2026-11-12T09:00`. */
export function aLocal(isoZ: string, zona: string = ZONA_CHILE): string {
  const ms = new Date(isoZ).getTime();
  if (Number.isNaN(ms)) throw new RangeError(`Fecha inválida: ${isoZ}`);
  const d = new Date(paredMs(ms, zona));
  return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}T${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}`;
}
