<?php

declare(strict_types=1);

namespace Manual\Seguridad;

final class Claves
{
    /** Sin caracteres que se confunden al dictarlos o leerlos (0/O, 1/l/I). */
    public const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    public const LARGO = 16;

    /**
     * Hash Argon2id fijo, con los mismos parámetros que hash(), de una clave que nadie usa.
     * El login lo verifica cuando el correo no existe, para tardar lo mismo que con una clave errónea.
     */
    public const HASH_FICTICIO = '$argon2id$v=19$m=65536,t=4,p=1$eEFYTHM0UlJTVGlvRXZCWA$gGmYQatF/FclsPu7mYmCPS9xxbdFRACoWV1zEfEHKck';

    /** Ficticio para PHP sin Argon2id: bcrypt con el mismo costo que hash(). */
    public const HASH_FICTICIO_BCRYPT = '$2y$12$.ZHv31eqDeGF4q1e8k7M3.LscPRoy66OQ2VSRoOFjtdxi/ShWfW26';
    public const COSTO_BCRYPT = 12;

    /**
     * Argon2id si el PHP lo trae; si no, bcrypt (spec §8). password_verify entiende ambos formatos.
     * @param bool|null $argonDisponible null = detectar; true/false para probar la selección
     */
    public static function algoritmo(?bool $argonDisponible = null): string
    {
        return ($argonDisponible ?? defined('PASSWORD_ARGON2ID')) ? 'argon2id' : PASSWORD_BCRYPT;
    }

    public static function hash(#[\SensitiveParameter] string $clave, ?bool $argonDisponible = null): string
    {
        $algoritmo = self::algoritmo($argonDisponible);
        return password_hash($clave, $algoritmo, $algoritmo === PASSWORD_BCRYPT ? ['cost' => self::COSTO_BCRYPT] : []);
    }

    /** Hash ficticio del mismo algoritmo y costo que hash(), para igualar tiempos con correos inexistentes. */
    public static function hashFicticio(?bool $argonDisponible = null): string
    {
        return self::algoritmo($argonDisponible) === PASSWORD_BCRYPT ? self::HASH_FICTICIO_BCRYPT : self::HASH_FICTICIO;
    }

    public static function verificar(#[\SensitiveParameter] string $clave, string $hash): bool
    {
        return password_verify($clave, $hash);
    }

    /** Clave aleatoria de 16 caracteres (≈ 93 bits). */
    public static function generar(): string
    {
        $max = strlen(self::ALFABETO) - 1;
        $clave = '';
        for ($i = 0; $i < self::LARGO; $i++) {
            $clave .= self::ALFABETO[random_int(0, $max)];
        }
        return $clave;
    }
}
