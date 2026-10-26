<?php

declare(strict_types=1);

namespace Manual\Mantenimiento;

use Manual\Acceso\Auditoria;
use Manual\Reloj;

/**
 * Respaldo lógico de la base en un .sql.gz (bin/cron.php respaldo), en PHP puro:
 * el hosting no garantiza exec() ni mysqldump.
 *
 * Memoria acotada (512 MB en el hosting, varios procesos): las filas se leen con un cursor sin búfer
 * y se escriben una a una con gzwrite, sin cargar tablas enteras. Cada INSERT lleva a lo más
 * FILAS_POR_INSERT filas y se cierra antes si pasa BYTES_POR_INSERT (copias y versiones con LONGTEXT
 * grandes): así tampoco choca con max_allowed_packet al importar en phpMyAdmin.
 *
 * Formato: UTF-8 (SET NAMES utf8mb4), una sentencia de datos por línea. El texto va legible con escape
 * estilo mysqldump (independiente del NO_BACKSLASH_ESCAPES del servidor, porque el archivo fija su
 * propio sql_mode); las columnas binarias (correo_cifrado, correo_indice…) van en hexadecimal.
 * El archivo guarda y repone sql_mode, FOREIGN_KEY_CHECKS y time_zone de la sesión que lo importa.
 * Se restaura con phpMyAdmin > Importar (acepta .sql.gz): borra y recrea cada tabla.
 *
 * Alcance: solo tablas base (estructura y datos). No incluye vistas, triggers, rutinas ni eventos;
 * hoy el esquema no tiene ninguno. Si se agregan, hay que ampliar este respaldo.
 */
final class Respaldo
{
    public const FILAS_POR_INSERT = 100;
    public const BYTES_POR_INSERT = 1048576;
    /** Solo estos archivos cuentan para la rotación; nada más del directorio se toca. */
    public const PATRON = '/^respaldo-\d{8}-\d{6}\.sql\.gz$/';
    /** Restos de un respaldo interrumpido; se borran pasada EDAD_PARCIAL. */
    public const PATRON_PARCIAL = '/^respaldo-\d{8}-\d{6}\.sql\.gz\.parcial$/';
    public const EDAD_PARCIAL = 86400;
    private const BINARIOS = ['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob'];

    public function __construct(private readonly \PDO $bd, private readonly Reloj $reloj)
    {
    }

    /**
     * Escribe respaldo-AAAAMMDD-HHMMSS.sql.gz (hora UTC) en $directorio (siempre en 0700),
     * conserva los $conservar más recientes y devuelve la ruta del archivo nuevo.
     */
    public function ejecutar(string $directorio, int $conservar = 14): string
    {
        if ($conservar < 1) {
            throw new \InvalidArgumentException('Hay que conservar al menos un respaldo.');
        }
        $directorio = rtrim($directorio, '/\\');
        $this->prepararDirectorio($directorio);

        $ahora = $this->reloj->ahora()->setTimezone(new \DateTimeZone('UTC'));
        $parcialesBorrados = $this->borrarParcialesHuerfanos($directorio, $ahora);
        $ruta = $directorio . '/respaldo-' . $ahora->format('Ymd-His') . '.sql.gz';
        // Se escribe a un nombre temporal (no coincide con PATRON) y se renombra al terminar:
        // un respaldo a medias nunca reemplaza ni desplaza a uno bueno.
        $parcial = $ruta . '.parcial';
        $umask = umask(0077); // el parcial nace en 0600, no recién al cerrarlo
        try {
            $gz = gzopen($parcial, 'wb6');
        } finally {
            umask($umask);
        }
        if ($gz === false) {
            throw new \RuntimeException("No se pudo crear $parcial");
        }
        try {
            [$tablas, $filas] = $this->volcar($gz, $ahora);
            if (!gzclose($gz)) {
                throw new \RuntimeException("No se pudo cerrar $parcial");
            }
            $gz = null;
            chmod($parcial, 0600);
            if (!rename($parcial, $ruta)) {
                throw new \RuntimeException("No se pudo renombrar $parcial");
            }
        } catch (\Throwable $e) {
            if ($gz !== null) {
                gzclose($gz);
            }
            if (is_file($parcial)) {
                unlink($parcial);
            }
            throw $e;
        }

        $borrados = $this->rotar($directorio, $conservar);
        clearstatcache(true, $ruta);
        (new Auditoria($this->bd, $this->reloj))->registrar(null, 'cron_respaldo', 'base', null, [
            'archivo' => basename($ruta),
            'bytes' => (int) filesize($ruta),
            'tablas' => $tablas,
            'filas' => $filas,
            'borrados' => $borrados,
            'parciales' => $parcialesBorrados,
        ]);
        return $ruta;
    }

    private function prepararDirectorio(string $directorio): void
    {
        if (!is_dir($directorio) && !mkdir($directorio, 0700, true) && !is_dir($directorio)) {
            throw new \RuntimeException("No se pudo crear $directorio");
        }
        // Siempre: mkdir respeta el umask, y el directorio pudo crearse antes (FTP, despliegue) con 0755.
        if (!chmod($directorio, 0700)) {
            throw new \RuntimeException("No se pudo dejar $directorio en 0700");
        }
        // Ya está fuera de la raíz web; esto es una segunda barrera si alguien la publica por error.
        $htaccess = $directorio . '/.htaccess';
        if (!is_file($htaccess)) {
            file_put_contents($htaccess, "Require all denied\n");
        }
    }

    /**
     * Un proceso que muere a medias (límite de memoria o de tiempo del hosting) no alcanza a borrar su
     * .parcial. Se borran los de más de un día; los recientes podrían ser de otro respaldo en curso.
     */
    private function borrarParcialesHuerfanos(string $directorio, \DateTimeImmutable $ahora): int
    {
        $limite = $ahora->getTimestamp() - self::EDAD_PARCIAL;
        $borrados = 0;
        foreach (scandir($directorio) ?: [] as $f) {
            $ruta = "$directorio/$f";
            if (preg_match(self::PATRON_PARCIAL, $f) && is_file($ruta) && filemtime($ruta) < $limite && unlink($ruta)) {
                $borrados++;
            }
        }
        return $borrados;
    }

    /**
     * @param resource $gz
     * @return array{int,int} tablas y filas volcadas
     */
    private function volcar($gz, \DateTimeImmutable $ahora): array
    {
        $bd = $this->bd;
        // Vista coherente de todas las tablas (InnoDB) sin bloquear a la aplicación. Se abre antes de
        // leer la lista de tablas y columnas, para que también ella corresponda al mismo instante.
        $propia = !$bd->inTransaction();
        if ($propia) {
            $bd->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT');
        }
        try {
            $base = (string) $bd->query('SELECT DATABASE()')->fetchColumn();
            $tablas = $bd->query("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name")
                ->fetchAll(\PDO::FETCH_COLUMN);
            // Columnas generadas fuera (se recalculan al restaurar). Se filtra por la expresión y no por
            // `extra`: MySQL 8 marca DEFAULT CURRENT_TIMESTAMP como DEFAULT_GENERATED. NULL en MariaDB, '' en MySQL.
            $columnas = [];
            $st = $bd->query("SELECT table_name AS t, column_name AS c, data_type AS d FROM information_schema.columns WHERE table_schema = DATABASE() AND COALESCE(generation_expression, '') = '' ORDER BY table_name, ordinal_position");
            foreach ($st->fetchAll(\PDO::FETCH_ASSOC) as $c) {
                $columnas[$c['t']][] = [$c['c'], in_array(strtolower($c['d']), self::BINARIOS, true)];
            }

            $this->escribir($gz, implode("\n", [
                '-- Manual de métodos: respaldo lógico (bin/cron.php respaldo)',
                '-- Generado: ' . $ahora->format('Y-m-d\TH:i:s\Z') . ' | base: ' . str_replace(["\n", "\r"], '', $base),
                '-- Restaurar: phpMyAdmin > Importar este .sql.gz. Borra y recrea cada tabla.',
                'SET NAMES utf8mb4;',
                'SET @RESPALDO_FK=@@FOREIGN_KEY_CHECKS, @RESPALDO_MODO=@@SQL_MODE, @RESPALDO_TZ=@@TIME_ZONE;',
                'SET FOREIGN_KEY_CHECKS=0;',
                "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';",
                "SET TIME_ZONE='+00:00';",
                '',
            ]) . "\n");

            $total = 0;
            foreach ($tablas as $tabla) {
                $total += $this->volcarTabla($gz, (string) $tabla, $columnas[$tabla] ?? []);
            }
        } finally {
            if ($propia) {
                $bd->exec('COMMIT');
            }
        }

        $this->escribir($gz, implode("\n", [
            'SET FOREIGN_KEY_CHECKS=@RESPALDO_FK;',
            'SET SQL_MODE=@RESPALDO_MODO;',
            'SET TIME_ZONE=@RESPALDO_TZ;',
            sprintf('-- Fin del respaldo: %d tablas, %d filas.', count($tablas), $total),
        ]) . "\n");
        return [count($tablas), $total];
    }

    /**
     * @param resource $gz
     * @param list<array{string,bool}> $columnas nombre y si es binaria
     */
    private function volcarTabla($gz, string $tabla, array $columnas): int
    {
        $t = self::id($tabla);
        $crear = $this->bd->query("SHOW CREATE TABLE $t")->fetch(\PDO::FETCH_NUM)[1];
        $this->escribir($gz, "-- Tabla $t\nDROP TABLE IF EXISTS $t;\n$crear;\n");
        if ($columnas === []) {
            return 0;
        }

        $lista = implode(', ', array_map(fn (array $c) => self::id($c[0]), $columnas));
        $binarias = array_column($columnas, 1);
        $prefijo = "INSERT INTO $t ($lista) VALUES ";

        $anterior = $this->bd->getAttribute(\PDO::MYSQL_ATTR_USE_BUFFERED_QUERY);
        $this->bd->setAttribute(\PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
        $filas = 0;
        try {
            $st = $this->bd->query("SELECT $lista FROM $t");
            $enLote = 0;
            $bytes = 0;
            while (($f = $st->fetch(\PDO::FETCH_NUM)) !== false) {
                $valores = [];
                foreach ($f as $i => $v) {
                    $valores[] = self::valor($v, $binarias[$i]);
                }
                $tupla = '(' . implode(',', $valores) . ')';
                unset($valores, $f);
                if ($enLote > 0 && ($enLote >= self::FILAS_POR_INSERT || $bytes + strlen($tupla) > self::BYTES_POR_INSERT)) {
                    $this->escribir($gz, ";\n");
                    $enLote = 0;
                }
                if ($enLote === 0) {
                    $this->escribir($gz, $prefijo . $tupla);
                    $bytes = strlen($prefijo) + strlen($tupla);
                } else {
                    $this->escribir($gz, ',' . $tupla);
                    $bytes += strlen($tupla) + 1;
                }
                $enLote++;
                $filas++;
            }
            $st->closeCursor();
            if ($enLote > 0) {
                $this->escribir($gz, ";\n");
            }
        } finally {
            $this->bd->setAttribute(\PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, $anterior);
        }
        $this->escribir($gz, "\n");
        return $filas;
    }

    private static function valor(mixed $v, bool $binaria): string
    {
        if ($v === null) {
            return 'NULL';
        }
        if (is_int($v)) {
            return (string) $v;
        }
        if (is_float($v)) {
            return var_export($v, true);
        }
        $v = (string) $v;
        if ($binaria) {
            return $v === '' ? "''" : '0x' . bin2hex($v);
        }
        // Mismo escape que mysqldump; válido porque el archivo fija un sql_mode sin NO_BACKSLASH_ESCAPES.
        // Escapar \n y \r deja cada sentencia de datos en una sola línea.
        return "'" . strtr($v, ['\\' => '\\\\', "\0" => '\\0', "\n" => '\\n', "\r" => '\\r', "'" => "\\'", "\x1a" => '\\Z']) . "'";
    }

    private static function id(string $nombre): string
    {
        return '`' . str_replace('`', '``', $nombre) . '`';
    }

    /** @param resource $gz */
    private function escribir($gz, string $s): void
    {
        if ($s !== '' && gzwrite($gz, $s) !== strlen($s)) {
            throw new \RuntimeException('No se pudo escribir el respaldo (¿disco lleno?).');
        }
    }

    /** Borra los respaldos más antiguos y deja los $conservar más recientes. El nombre ordena por fecha. */
    private function rotar(string $directorio, int $conservar): int
    {
        $archivos = array_values(array_filter(scandir($directorio) ?: [], fn (string $f) => (bool) preg_match(self::PATRON, $f)));
        sort($archivos, SORT_STRING);
        $borrados = 0;
        foreach (array_slice($archivos, 0, max(0, count($archivos) - $conservar)) as $f) {
            if (unlink("$directorio/$f")) {
                $borrados++;
            }
        }
        return $borrados;
    }
}
