<?php

declare(strict_types=1);

namespace Manual;

final class Config
{
    private function __construct(
        public readonly string $bdDsn,
        public readonly string $bdUsuario,
        public readonly string $bdClave,
        public readonly string $claveCifrado,
        public readonly string $claveIndice,
        public readonly bool $cookieSegura,
        public readonly string $zonaHoraria,
    ) {
    }

    /**
     * Lee un archivo .env (fuera de public/). Las variables de entorno del proceso
     * rellenan lo que el archivo no define. Un archivo ausente no es error.
     */
    public static function desdeEntorno(string $rutaEnv): self
    {
        $valores = [];
        if (is_file($rutaEnv) && is_readable($rutaEnv)) {
            foreach (file($rutaEnv, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $linea) {
                $linea = trim($linea);
                if ($linea === '' || $linea[0] === '#' || !str_contains($linea, '=')) {
                    continue;
                }
                [$clave, $valor] = explode('=', $linea, 2);
                $valor = trim($valor);
                if (strlen($valor) >= 2 && ($valor[0] === '"' || $valor[0] === "'") && $valor[-1] === $valor[0]) {
                    $valor = substr($valor, 1, -1);
                }
                $valores[trim($clave)] = $valor;
            }
        }
        foreach (['BD_DSN', 'BD_HOST', 'BD_NOMBRE', 'BD_USUARIO', 'BD_CLAVE', 'CLAVE_CIFRADO', 'CLAVE_INDICE', 'COOKIE_SEGURA', 'ZONA_HORARIA'] as $k) {
            if (!isset($valores[$k]) && ($e = getenv($k)) !== false) {
                $valores[$k] = $e;
            }
        }
        return self::desdeArreglo($valores);
    }

    /** @param array<string,string> $v */
    public static function desdeArreglo(array $v): self
    {
        $dsn = $v['BD_DSN'] ?? '';
        if ($dsn === '' && isset($v['BD_HOST'], $v['BD_NOMBRE'])) {
            $dsn = "mysql:host={$v['BD_HOST']};dbname={$v['BD_NOMBRE']};charset=utf8mb4";
        }
        return new self(
            $dsn,
            $v['BD_USUARIO'] ?? '',
            $v['BD_CLAVE'] ?? '',
            self::clave($v, 'CLAVE_CIFRADO'),
            self::clave($v, 'CLAVE_INDICE'),
            ($v['COOKIE_SEGURA'] ?? '0') === '1',
            ($v['ZONA_HORARIA'] ?? '') !== '' ? $v['ZONA_HORARIA'] : 'America/Santiago',
        );
    }

    /**
     * Devuelve los 32 bytes decodificados. Cierra por defecto: falta o no mide 32 bytes lanza excepción.
     * @param array<string,string> $v
     */
    private static function clave(array $v, string $nombre): string
    {
        $b64 = $v[$nombre] ?? '';
        $bytes = base64_decode($b64, true);
        if ($bytes === false || strlen($bytes) !== 32) {
            throw new \InvalidArgumentException("$nombre debe ser 32 bytes en base64.");
        }
        return $bytes;
    }
}
