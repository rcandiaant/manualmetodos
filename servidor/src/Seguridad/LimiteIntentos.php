<?php

declare(strict_types=1);

namespace Manual\Seguridad;

use Manual\Reloj;

/**
 * Límite de intentos de login en la tabla intentos_login, con claves `ip:<ip>` y `cuenta:<índice hex>`.
 *
 * Flujo: reservar() ANTES de verificar la clave y luego confirmarFallo() o confirmarExito().
 * - reservar() cuenta el intento de forma atómica (todas las claves en una transacción con
 *   SELECT … FOR UPDATE). Si alguna clave está bloqueada o ya tiene 5 intentos sin resolver, rechaza
 *   sin contar nada. Así N peticiones en paralelo no pueden probar más de 5 claves por ventana.
 * - confirmarFallo(): el intento ya contado se mantiene; al llegar a 5 la clave se bloquea
 *   1, 5, 15 y 60 min (el último se repite) y vuelve a contar desde cero.
 * - confirmarExito(): borra la clave de la cuenta y devuelve la reserva de la IP. La IP no se
 *   reinicia del todo: si no, quien tenga una cuenta válida podría intercalar entradas correctas
 *   para probar claves ajenas sin límite desde una IP.
 * - Una clave sin actividad durante 24 h vuelve a empezar de cero (fallos y nivel de bloqueo).
 */
final class LimiteIntentos
{
    public const UMBRAL = 5;
    /** @var list<int> segundos */
    public const BLOQUEOS = [60, 300, 900, 3600];
    public const OLVIDO = 86400;

    /** @var list<string> claves que bloqueó la última reserva rechazada por saturación (para auditoría) */
    public array $bloqueadasAlReservar = [];

    public function __construct(private readonly \PDO $bd, private readonly Reloj $reloj)
    {
    }

    /**
     * Reserva un intento en todas las claves, o en ninguna.
     * @param list<string> $claves
     * @return int 0 si se reservó; si no, segundos de espera (para Retry-After)
     */
    public function reservar(array $claves): int
    {
        $ahora = $this->ahora();
        $this->bloqueadasAlReservar = [];
        return $this->enTransaccion($claves, function (array $filas) use ($ahora): int {
            $espera = 0;
            foreach ($filas as $f) {
                if ($f['hasta'] !== null && $f['hasta'] > $ahora->getTimestamp()) {
                    $espera = max($espera, $f['hasta'] - $ahora->getTimestamp());
                }
            }
            if ($espera > 0) {
                return $espera;
            }
            // Intentos sin resolver ya agotados (peticiones en paralelo): se bloquea ahora mismo.
            foreach ($filas as $clave => $f) {
                if ($f['fallos'] >= self::UMBRAL) {
                    $espera = max($espera, $this->bloquear($clave, $f, $ahora));
                    $this->bloqueadasAlReservar[] = $clave;
                }
            }
            if ($espera > 0) {
                return $espera;
            }
            foreach ($filas as $clave => $f) {
                $this->escribir($clave, $f['fallos'] + 1, $f['bloqueos'], null, $ahora);
            }
            return 0;
        });
    }

    /**
     * El intento reservado falló (sigue contado). Bloquea las claves que llegaron al umbral.
     * @param list<string> $claves
     * @return list<string> las claves que quedaron bloqueadas
     */
    public function confirmarFallo(array $claves): array
    {
        $ahora = $this->ahora();
        $bloqueadas = $this->enTransaccion($claves, function (array $filas) use ($ahora): array {
            $bloqueadas = [];
            foreach ($filas as $clave => $f) {
                if ($f['fallos'] >= self::UMBRAL) {
                    $this->bloquear($clave, $f, $ahora);
                    $bloqueadas[] = $clave;
                } else {
                    $this->escribir($clave, $f['fallos'], $f['bloqueos'], null, $ahora);
                }
            }
            return $bloqueadas;
        });
        $this->purgar($ahora);
        return $bloqueadas;
    }

    /**
     * El intento reservado tuvo éxito: las claves `cuenta:` se borran y las demás devuelven la reserva.
     * @param list<string> $claves
     */
    public function confirmarExito(array $claves): void
    {
        foreach ($claves as $clave) {
            if (str_starts_with($clave, 'cuenta:')) {
                $this->bd->prepare('DELETE FROM intentos_login WHERE clave = ?')->execute([$clave]);
            } else {
                $this->bd->prepare('UPDATE intentos_login SET fallos = IF(fallos > 0, fallos - 1, 0) WHERE clave = ?')->execute([$clave]);
            }
        }
    }

    /**
     * Ejecuta $f con las filas de $claves bloqueadas (FOR UPDATE, en orden fijo para evitar interbloqueos).
     * @template T
     * @param list<string> $claves
     * @param callable(array<string,array{fallos:int,bloqueos:int,hasta:?int}>): T $f
     * @return T
     */
    private function enTransaccion(array $claves, callable $f): mixed
    {
        $ahora = $this->ahora();
        $claves = array_values(array_unique($claves));
        sort($claves, SORT_STRING);
        $this->bd->beginTransaction();
        try {
            $filas = [];
            foreach ($claves as $clave) {
                $this->bd->prepare('INSERT IGNORE INTO intentos_login (clave, fallos, bloqueos, bloqueado_hasta, actualizado) VALUES (?, 0, 0, NULL, ?)')
                    ->execute([$clave, self::sql($ahora)]);
                $st = $this->bd->prepare('SELECT fallos, bloqueos, bloqueado_hasta, actualizado FROM intentos_login WHERE clave = ? FOR UPDATE');
                $st->execute([$clave]);
                $fila = $st->fetch();
                $hasta = $fila['bloqueado_hasta'] === null ? null : self::desdeSql($fila['bloqueado_hasta'])->getTimestamp();
                $olvidada = $ahora->getTimestamp() - self::desdeSql($fila['actualizado'])->getTimestamp() > self::OLVIDO
                    && ($hasta === null || $hasta <= $ahora->getTimestamp());
                $filas[$clave] = $olvidada
                    ? ['fallos' => 0, 'bloqueos' => 0, 'hasta' => null]
                    : ['fallos' => (int) $fila['fallos'], 'bloqueos' => (int) $fila['bloqueos'], 'hasta' => $hasta];
            }
            $resultado = $f($filas);
            $this->bd->commit();
            return $resultado;
        } catch (\Throwable $e) {
            $this->bd->rollBack();
            throw $e;
        }
    }

    /**
     * @param array{fallos:int,bloqueos:int,hasta:?int} $f
     * @return int segundos de bloqueo
     */
    private function bloquear(string $clave, array $f, \DateTimeImmutable $ahora): int
    {
        $segundos = self::BLOQUEOS[min($f['bloqueos'], count(self::BLOQUEOS) - 1)];
        $this->escribir($clave, 0, $f['bloqueos'] + 1, $ahora->modify("+$segundos seconds"), $ahora);
        return $segundos;
    }

    private function escribir(string $clave, int $fallos, int $bloqueos, ?\DateTimeImmutable $hasta, \DateTimeImmutable $ahora): void
    {
        $this->bd->prepare('UPDATE intentos_login SET fallos = ?, bloqueos = ?, bloqueado_hasta = COALESCE(?, bloqueado_hasta), actualizado = ? WHERE clave = ?')
            ->execute([$fallos, $bloqueos, $hasta === null ? null : self::sql($hasta), self::sql($ahora), $clave]);
    }

    /** Borra claves olvidadas y sin bloqueo vigente, para que la tabla no crezca sin límite. */
    private function purgar(\DateTimeImmutable $ahora): void
    {
        $this->bd->prepare('DELETE FROM intentos_login WHERE actualizado < ? AND (bloqueado_hasta IS NULL OR bloqueado_hasta < ?) LIMIT 500')
            ->execute([self::sql($ahora->modify('-' . self::OLVIDO . ' seconds')), self::sql($ahora)]);
    }

    private function ahora(): \DateTimeImmutable
    {
        return $this->reloj->ahora()->setTimezone(new \DateTimeZone('UTC'));
    }

    private static function sql(\DateTimeImmutable $t): string
    {
        return $t->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }

    private static function desdeSql(string $s): \DateTimeImmutable
    {
        return new \DateTimeImmutable($s, new \DateTimeZone('UTC'));
    }
}
