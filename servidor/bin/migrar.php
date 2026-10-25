<?php

declare(strict_types=1);

// Uso (desarrollo): docker compose run --rm php php bin/migrar.php
// En el hosting no hay SSH: se importa migraciones/001_inicial.sql en phpMyAdmin.

use Manual\Bd\Conexion;
use Manual\Bd\Migrador;
use Manual\Config;

require __DIR__ . '/../vendor/autoload.php';

$config = Config::desdeEntorno(__DIR__ . '/../.env');
$aplicadas = Migrador::aplicar(Conexion::crear($config), __DIR__ . '/../migraciones');
echo $aplicadas === [] ? "Nada que aplicar.\n" : 'Aplicadas: ' . implode(', ', $aplicadas) . "\n";
