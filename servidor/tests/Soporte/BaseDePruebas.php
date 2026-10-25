<?php

declare(strict_types=1);

namespace Manual\Pruebas\Soporte;

use Manual\Bd\Conexion;
use Manual\Bd\Migrador;
use Manual\Config;
use PHPUnit\Framework\Attributes\Before;
use PHPUnit\Framework\Attributes\BeforeClass;

/**
 * Recrea la base de pruebas antes de cada clase y la vacía antes de cada test.
 * La base se crea con charset por defecto latin1 a propósito (como el hosting y el CI):
 * lo que debe importar es el charset declarado en cada tabla.
 */
trait BaseDePruebas
{
    protected static \PDO $bd;

    /** DSN completo desde BD_PRUEBAS_DSN, o armado con BD_HOST y BD_NOMBRE_PRUEBAS. */
    public static function dsnPruebas(): string
    {
        $dsn = getenv('BD_PRUEBAS_DSN');
        if (is_string($dsn) && $dsn !== '') {
            return $dsn;
        }
        $host = getenv('BD_HOST') ?: '127.0.0.1';
        $nombre = getenv('BD_NOMBRE_PRUEBAS') ?: 'manual_pruebas';
        return "mysql:host=$host;dbname=$nombre;charset=utf8mb4";
    }

    public static function configPruebas(): Config
    {
        return Config::desdeArreglo([
            'BD_DSN' => self::dsnPruebas(),
            'BD_USUARIO' => getenv('BD_USUARIO') ?: '',
            'BD_CLAVE' => getenv('BD_CLAVE') ?: '',
            'CLAVE_CIFRADO' => base64_encode(str_repeat('a', 32)),
            'CLAVE_INDICE' => base64_encode(str_repeat('b', 32)),
        ]);
    }

    /** Borra y vuelve a crear la base de pruebas (vacía, sin migrar, latin1) y devuelve la conexión a ella. */
    public static function recrearBaseVacia(): \PDO
    {
        $config = self::configPruebas();
        if (!preg_match('/dbname=([A-Za-z0-9_]+)/', $config->bdDsn, $m)) {
            throw new \RuntimeException('El DSN de pruebas debe indicar dbname.');
        }
        $nombre = $m[1];
        if (!str_ends_with($nombre, '_pruebas')) {
            throw new \RuntimeException("Por seguridad la base de pruebas debe terminar en _pruebas (es $nombre).");
        }
        $dsnServidor = preg_replace('/dbname=[^;]*;?/', '', $config->bdDsn);
        $admin = new \PDO($dsnServidor, $config->bdUsuario, $config->bdClave, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);
        $admin->exec("DROP DATABASE IF EXISTS `$nombre`");
        $admin->exec("CREATE DATABASE `$nombre` CHARACTER SET latin1");
        return Conexion::crear($config);
    }

    public static function directorioMigraciones(): string
    {
        return dirname(__DIR__, 2) . '/migraciones';
    }

    #[BeforeClass]
    public static function prepararBaseDePruebas(): void
    {
        self::$bd = self::recrearBaseVacia();
        Migrador::aplicar(self::$bd, self::directorioMigraciones());
    }

    #[Before]
    protected function vaciarBaseDePruebas(): void
    {
        $bd = self::$bd;
        $tablas = $bd->query("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> 'migraciones_aplicadas'")->fetchAll(\PDO::FETCH_COLUMN);
        $bd->exec('SET FOREIGN_KEY_CHECKS = 0');
        foreach ($tablas as $t) {
            $bd->exec("TRUNCATE TABLE `$t`");
        }
        $bd->exec('SET FOREIGN_KEY_CHECKS = 1');
        $bd->exec('INSERT INTO consulta (id, motivo_obligatorio) VALUES (1, 0)');
    }
}
