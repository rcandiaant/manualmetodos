<?php

declare(strict_types=1);

namespace Manual\Mantenimiento;

use Manual\Acceso\Auditoria;
use Manual\Reloj;

/**
 * Limpieza periódica (bin/cron.php limpieza).
 * - intentos_login: borra claves sin actividad hace más de 7 días y sin bloqueo vigente.
 *   (LimiteIntentos ya purga de a 500 al iniciar sesión; esto cubre los periodos sin logins.)
 * - revisiones_copia NO se toca: Copias ya recorta a MAX_INSTANTANEAS al escribir.
 */
final class Limpieza
{
    public const DIAS_INTENTOS = 7;

    public function __construct(private readonly \PDO $bd, private readonly Reloj $reloj)
    {
    }

    /** @return array{intentos:int} */
    public function ejecutar(): array
    {
        $ahora = $this->reloj->ahora()->setTimezone(new \DateTimeZone('UTC'));
        $st = $this->bd->prepare('DELETE FROM intentos_login WHERE actualizado < ? AND (bloqueado_hasta IS NULL OR bloqueado_hasta < ?)');
        $st->execute([
            $ahora->modify('-' . self::DIAS_INTENTOS . ' days')->format('Y-m-d H:i:s'),
            $ahora->format('Y-m-d H:i:s'),
        ]);
        $r = ['intentos' => $st->rowCount()];
        (new Auditoria($this->bd, $this->reloj))->registrar(null, 'cron_limpieza', 'intentos_login', null, $r);
        return $r;
    }
}
