<?php

declare(strict_types=1);

namespace Manual\Dominio;

/** Etapa de la consulta, calculada por fecha en cada petición (spec §6.8). */
final class Etapa
{
    public const PREPARACION = 'preparacion';
    public const CONSULTA = 'consulta';
    public const EDICION_FINAL = 'edicion_final';

    /**
     * preparacion: sin apertura o ahora < apertura. consulta: apertura <= ahora < cierre
     * (sin cierre, sigue abierta). edicion_final: ahora >= cierre.
     */
    public static function actual(?\DateTimeImmutable $apertura, ?\DateTimeImmutable $cierre, \DateTimeImmutable $ahora): string
    {
        if ($apertura === null || $ahora < $apertura) {
            return self::PREPARACION;
        }
        return $cierre !== null && $ahora >= $cierre ? self::EDICION_FINAL : self::CONSULTA;
    }
}
