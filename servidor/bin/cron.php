<?php

declare(strict_types=1);

// Tareas de mantenimiento para los Cron Jobs de cPanel (sin SSH ni exec()).
//   php bin/cron.php limpieza   borra intentos de login viejos sin bloqueo vigente
//   php bin/cron.php respaldo   escribe var/respaldos/respaldo-AAAAMMDD-HHMMSS.sql.gz y conserva 14
//   php bin/cron.php todo       ambas
// Código de salida 0 si todo salió bien; distinto de 0 si algo falló. Una línea por acción.
// Desarrollo: docker compose exec -T php php bin/cron.php todo

// Solo por línea de comandos: si alguien lo alcanza por web (bin/ está fuera de la raíz), no hace nada.
// Pero no en silencio: en cPanel los wrappers ea-phpXX suelen ser php-cgi y con ellos el cron dejaría
// de respaldar sin que nadie lo note. El aviso va al error_log y a STDERR (llega en el correo del cron).
if (PHP_SAPI !== 'cli') {
    $aviso = 'cron.php debe ejecutarse con PHP CLI (SAPI=' . PHP_SAPI . ')';
    error_log($aviso);
    if (defined('STDERR')) {
        fwrite(STDERR, $aviso . "\n");
    } else {
        @file_put_contents('php://stderr', $aviso . "\n");
    }
    exit(1);
}

use Manual\Bd\Conexion;
use Manual\Config;
use Manual\Mantenimiento\Limpieza;
use Manual\Mantenimiento\Respaldo;
use Manual\RelojSistema;

require __DIR__ . '/../vendor/autoload.php';

$tarea = $argv[1] ?? '';
if (!in_array($tarea, ['limpieza', 'respaldo', 'todo'], true) || count($argv) > 2) {
    fwrite(STDERR, "Uso: php bin/cron.php limpieza|respaldo|todo\n");
    exit(2);
}

try {
    $bd = Conexion::crear(Config::desdeEntorno(__DIR__ . '/../.env'));
} catch (\Throwable $e) {
    fwrite(STDERR, 'ERROR conexión: ' . $e->getMessage() . "\n");
    exit(1);
}
$reloj = new RelojSistema();
$codigo = 0;

if ($tarea === 'limpieza' || $tarea === 'todo') {
    try {
        $r = (new Limpieza($bd, $reloj))->ejecutar();
        echo "limpieza: {$r['intentos']} intentos de login borrados\n";
    } catch (\Throwable $e) {
        fwrite(STDERR, 'ERROR limpieza: ' . $e->getMessage() . "\n");
        $codigo = 1;
    }
}

if ($tarea === 'respaldo' || $tarea === 'todo') {
    try {
        $ruta = (new Respaldo($bd, $reloj))->ejecutar(dirname(__DIR__) . '/var/respaldos');
        echo 'respaldo: ' . $ruta . ' (' . filesize($ruta) . " bytes)\n";
    } catch (\Throwable $e) {
        fwrite(STDERR, 'ERROR respaldo: ' . $e->getMessage() . "\n");
        $codigo = 1;
    }
}

exit($codigo);
