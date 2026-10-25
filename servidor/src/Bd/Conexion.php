<?php

declare(strict_types=1);

namespace Manual\Bd;

use Manual\Config;

final class Conexion
{
    public static function crear(Config $config): \PDO
    {
        $dsn = $config->bdDsn;
        if (!str_contains($dsn, 'charset=')) {
            $dsn .= ';charset=utf8mb4';
        }
        return new \PDO($dsn, $config->bdUsuario, $config->bdClave, [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_EMULATE_PREPARES => false,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            \PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci, time_zone = '+00:00'",
        ]);
    }
}
