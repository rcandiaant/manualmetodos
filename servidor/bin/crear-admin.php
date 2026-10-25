<?php

declare(strict_types=1);

// Crea un administrador e imprime su clave generada (se muestra una sola vez).
//
// Desarrollo (escribe en la base del .env / entorno):
//   docker compose run --rm php php bin/crear-admin.php "Nombre" correo@inia.cl [laboratorio]
//
// Producción (el hosting no tiene SSH): con un .env local que tenga las MISMAS
// CLAVE_CIFRADO y CLAVE_INDICE que producción, --sql imprime un INSERT para pegar en phpMyAdmin.
// No se conecta a ninguna base.
//   docker compose run --rm php php bin/crear-admin.php --sql "Nombre" correo@inia.cl [laboratorio]

use Manual\Acceso\Usuarios;
use Manual\Bd\Conexion;
use Manual\Config;
use Manual\Dominio\Rol;
use Manual\Seguridad\Cifrado;
use Manual\Seguridad\Claves;

require __DIR__ . '/../vendor/autoload.php';

$args = array_slice($argv, 1);
$sql = false;
if (($args[0] ?? '') === '--sql') {
    $sql = true;
    array_shift($args);
}
if (count($args) < 2 || count($args) > 3) {
    fwrite(STDERR, "Uso: php bin/crear-admin.php [--sql] <nombre> <correo> [laboratorio]\n");
    exit(2);
}
[$nombre, $correo] = $args;
$laboratorio = $args[2] ?? 'Administración';
$correo = trim($correo);
if (filter_var($correo, FILTER_VALIDATE_EMAIL) === false || trim($nombre) === '') {
    fwrite(STDERR, "Nombre vacío o correo inválido.\n");
    exit(2);
}

$config = Config::desdeEntorno(__DIR__ . '/../.env');
$cifrado = new Cifrado($config->claveCifrado, $config->claveIndice);
$clave = Claves::generar();
$hash = Claves::hash($clave);

if ($sql) {
    // Todo en hexadecimal: no depende de NO_BACKSLASH_ESCAPES ni del charset de la sesión de phpMyAdmin.
    $texto = fn (string $s): string => 'CONVERT(0x' . bin2hex($s) . ' USING utf8mb4)';
    printf(
        "INSERT INTO usuarios (nombre, laboratorio, correo_cifrado, correo_indice, clave_hash, roles, activo) VALUES (%s, %s, 0x%s, 0x%s, %s, %s, 1);\n",
        $texto($nombre),
        $texto($laboratorio),
        bin2hex($cifrado->cifrar($correo)),
        bin2hex($cifrado->indice($correo)),
        $texto($hash),
        $texto(Rol::ADMIN),
    );
} else {
    $id = (new Usuarios(Conexion::crear($config), $cifrado))->crear($nombre, $correo, $laboratorio, $hash, [Rol::ADMIN]);
    echo "Administrador creado (id $id).\n";
}
echo "Correo: $correo\nClave:  $clave\n";
