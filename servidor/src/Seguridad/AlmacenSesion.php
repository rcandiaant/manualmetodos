<?php

declare(strict_types=1);

namespace Manual\Seguridad;

/**
 * Dónde viven los datos de sesión. En producción, sesiones nativas de PHP (AlmacenSesionNativa);
 * en pruebas, un almacén en memoria. La cookie no la emite el almacén sino Sesion, por Respuesta.
 */
interface AlmacenSesion
{
    /** @return array<string,mixed>|null datos de la sesión, o null si no existe (o el id no es válido) */
    public function cargar(string $id): ?array;

    /**
     * Guarda los datos de una sesión existente.
     * @param array<string,mixed> $datos
     * @throws \LogicException si la sesión no existe: nunca se adopta un id que no generó el servidor
     */
    public function guardar(string $id, array $datos): void;

    /** Crea una sesión vacía con id nuevo y destruye la anterior si había (session_regenerate_id(true)). */
    public function regenerar(?string $idActual): string;

    public function destruir(string $id): void;
}
