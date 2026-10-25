<?php

declare(strict_types=1);

use Manual\Aplicacion;
use Manual\Config;
use Manual\Http\Peticion;
use Manual\RelojSistema;
use Manual\Seguridad\AlmacenSesionNativa;

ini_set('display_errors', '0');

// Único archivo que toca superglobales y cabeceras.
try {
    require __DIR__ . '/../vendor/autoload.php';
    $config = Config::desdeEntorno(__DIR__ . '/../.env');
    date_default_timezone_set($config->zonaHoraria);
    // Sesiones nativas en una carpeta propia fuera de la raíz web (ver AlmacenSesionNativa).
    $sesiones = new AlmacenSesionNativa($config->cookieSegura, dirname(__DIR__) . '/var/sesiones');
    (new Aplicacion($config, new RelojSistema(), $sesiones))->manejar(Peticion::desdeGlobales())->enviar();
} catch (\Throwable $e) {
    // Fallo de arranque o de envío: respuesta fija, sin detalle.
    if (!headers_sent()) {
        $https = ($_SERVER['HTTPS'] ?? '') !== '' && $_SERVER['HTTPS'] !== 'off';
        if (class_exists(Aplicacion::class)) {
            Aplicacion::errorFatal($e, $https)->enviar();
        } else {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
            echo '{"error":{"codigo":"error_interno","mensaje":"Error interno del servidor."}}';
        }
    }
}
