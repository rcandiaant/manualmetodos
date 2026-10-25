<?php

declare(strict_types=1);

namespace Manual\Validacion;

use Manual\Http\ErrorHttp;

/**
 * Valida una sugerencia enviada por el cliente (lista blanca de campos) y la devuelve normalizada
 * **sin** `autor`: el autor lo pone el servidor desde la sesión.
 *
 * Errores: 400 `entrada_invalida` (con `campos`) para campos ausentes o mal formados;
 * 422 `documento_invalido` si `original` o `propuesta` traen nodos fuera del esquema.
 */
final class ValidadorSugerencia
{
    public const TIPOS = ['contenido', 'formato', 'bloque-insertado', 'bloque-eliminado'];
    public const LARGO_ID = 190;
    public const LARGO_MOTIVO = 2000;

    /** @throws ErrorHttp */
    public static function validar(mixed $s): array
    {
        // Acepta la forma de objetos (json_decode(..., false), estricta con listas) o arrays asociativos.
        $estricto = $s instanceof \stdClass;
        $s = self::objeto($s, $estricto);
        if ($s === null) {
            throw new ErrorHttp(400, 'entrada_invalida', 'La sugerencia debe ser un objeto', ['sugerencia' => 'debe ser un objeto']);
        }

        $r = [
            'id' => Entrada::texto($s, 'id', self::LARGO_ID),
            'bloqueId' => Entrada::texto($s, 'bloqueId', self::LARGO_ID),
            'base' => self::rango($s, 'base', $estricto),
            'copia' => self::rango($s, 'copia', $estricto),
            'original' => self::nodos($s, 'original'),
            'propuesta' => self::nodos($s, 'propuesta'),
            'tipo' => Entrada::enumeracion($s, 'tipo', self::TIPOS),
        ];
        // Obligatorio en el formato del cliente, pero se descarta: no se confía en el autor declarado.
        Entrada::texto($s, 'autor', self::LARGO_ID);

        // Opcionales (null equivale a ausente).
        if (isset($s['profundidad'])) {
            $r['profundidad'] = Entrada::entero($s, 'profundidad', 0, ValidadorDocumento::PROFUNDIDAD_MAXIMA);
        }
        if (isset($s['siguiente'])) {
            $r['siguiente'] = Entrada::texto($s, 'siguiente', self::LARGO_ID);
        }
        if (isset($s['primerHijo'])) {
            if (!is_bool($s['primerHijo'])) {
                throw Entrada::invalido('primerHijo', 'debe ser booleano');
            }
            $r['primerHijo'] = $s['primerHijo'];
        }
        if (isset($s['grupo'])) {
            $r['grupo'] = Entrada::texto($s, 'grupo', self::LARGO_ID);
        }
        if (isset($s['orden'])) {
            $r['orden'] = Entrada::entero($s, 'orden', 0, ValidadorDocumento::NODOS_MAXIMOS);
        }
        if (isset($s['motivo'])) {
            $r['motivo'] = Entrada::texto($s, 'motivo', self::LARGO_MOTIVO, 0);
        }
        return $r;
    }

    /** @return array{desde: int, hasta: int} */
    /** Objeto JSON como array asociativo, o null si no lo es. */
    private static function objeto(mixed $v, bool $estricto): ?array
    {
        if ($v instanceof \stdClass) {
            return get_object_vars($v);
        }
        return !$estricto && is_array($v) && !array_is_list($v) ? $v : null;
    }

    private static function rango(array $s, string $campo, bool $estricto): array
    {
        $v = self::objeto($s[$campo] ?? null, $estricto);
        if ($v === null) {
            throw Entrada::invalido($campo, 'debe ser un objeto {desde, hasta}');
        }
        try {
            $desde = Entrada::entero($v, 'desde', 0);
            $hasta = Entrada::entero($v, 'hasta', 0);
        } catch (ErrorHttp $e) {
            throw Entrada::invalido($campo, 'desde y hasta deben ser enteros ≥ 0');
        }
        if ($desde > $hasta) {
            throw Entrada::invalido($campo, 'desde no puede ser mayor que hasta');
        }
        return ['desde' => $desde, 'hasta' => $hasta];
    }

    private static function nodos(array $s, string $campo): array
    {
        $v = $s[$campo] ?? null;
        if (!is_array($v) || !array_is_list($v)) {
            throw Entrada::invalido($campo, 'debe ser una lista de nodos');
        }
        ValidadorDocumento::validarNodos($v, $campo);
        // Se devuelve siempre como arrays asociativos (la forma que se guarda con json_encode).
        return json_decode(json_encode($v, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);
    }
}
