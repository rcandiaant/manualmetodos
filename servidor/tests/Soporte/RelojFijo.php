<?php

declare(strict_types=1);

namespace Manual\Pruebas\Soporte;

use Manual\Reloj;

/** Reloj de pruebas: no avanza solo. */
final class RelojFijo implements Reloj
{
    private \DateTimeImmutable $ahora;

    public function __construct(string $inicio = '2026-11-02 12:00:00')
    {
        $this->ahora = new \DateTimeImmutable($inicio, new \DateTimeZone('UTC'));
    }

    public function ahora(): \DateTimeImmutable
    {
        return $this->ahora;
    }

    public function avanzar(int $segundos): void
    {
        $this->ahora = $this->ahora->modify(($segundos >= 0 ? '+' : '') . $segundos . ' seconds');
    }
}
