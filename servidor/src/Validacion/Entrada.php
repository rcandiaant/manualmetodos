<?php

declare(strict_types=1);

namespace Manual\Validacion;

use Manual\Http\ErrorHttp;

/** Lectura estricta de campos de entrada. Todo fallo es 400 `entrada_invalida` con el campo en `campos`. */
final class Entrada
{
    private const FECHA_ISO = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/';

    public static function invalido(string $campo, string $mensaje): ErrorHttp
    {
        return new ErrorHttp(400, 'entrada_invalida', "Campo «{$campo}»: {$mensaje}", [$campo => $mensaje]);
    }

    /** String UTF-8 válido con entre `$min` y `$max` caracteres. */
    public static function texto(array $d, string $campo, int $max, int $min = 1): string
    {
        $v = $d[$campo] ?? null;
        if (!is_string($v) || !mb_check_encoding($v, 'UTF-8')) {
            throw self::invalido($campo, 'debe ser un texto');
        }
        $largo = mb_strlen($v, 'UTF-8');
        if ($largo < $min || $largo > $max) {
            throw self::invalido($campo, $min > 0 ? "debe tener entre {$min} y {$max} caracteres" : "no puede pasar de {$max} caracteres");
        }
        return $v;
    }

    /** Entero JSON (no float, no string) dentro de [`$min`, `$max`]. */
    public static function entero(array $d, string $campo, int $min = PHP_INT_MIN, int $max = PHP_INT_MAX): int
    {
        $v = $d[$campo] ?? null;
        if (!is_int($v)) {
            throw self::invalido($campo, 'debe ser un número entero');
        }
        if ($v < $min || $v > $max) {
            throw self::invalido($campo, 'está fuera de rango');
        }
        return $v;
    }

    /** Fecha ISO 8601 con zona explícita, devuelta en UTC. */
    public static function fechaIso(array $d, string $campo): \DateTimeImmutable
    {
        $v = $d[$campo] ?? null;
        if (!is_string($v) || preg_match(self::FECHA_ISO, $v) !== 1) {
            throw self::invalido($campo, 'debe ser una fecha ISO 8601 con zona horaria');
        }
        try {
            $f = new \DateTimeImmutable($v);
        } catch (\Exception) {
            throw self::invalido($campo, 'no es una fecha válida');
        }
        // DateTime desborda valores imposibles (30 de febrero → 2 de marzo, 25:00 → día siguiente):
        // se exige que lo interpretado coincida con lo escrito.
        if ($f->format('Y-m-d\TH:i') !== substr($v, 0, 16)) {
            throw self::invalido($campo, 'no es una fecha válida');
        }
        return $f->setTimezone(new \DateTimeZone('UTC'));
    }

    /** @param list<string> $valores */
    public static function enumeracion(array $d, string $campo, array $valores): string
    {
        $v = $d[$campo] ?? null;
        if (!is_string($v) || !in_array($v, $valores, true)) {
            throw self::invalido($campo, 'debe ser uno de: ' . implode(', ', $valores));
        }
        return $v;
    }

    /**
     * Conserva solo los campos permitidos y descarta el resto.
     * @param list<string> $permitidos
     */
    public static function soloCampos(array $d, array $permitidos): array
    {
        return array_intersect_key($d, array_flip($permitidos));
    }
}
