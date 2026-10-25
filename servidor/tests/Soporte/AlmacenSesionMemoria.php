<?php

declare(strict_types=1);

namespace Manual\Pruebas\Soporte;

use Manual\Seguridad\AlmacenSesion;

/** Almacén de sesiones en memoria para pruebas en el mismo proceso. */
final class AlmacenSesionMemoria implements AlmacenSesion
{
    /** @var array<string,array<string,mixed>> */
    public array $sesiones = [];

    /** Se ejecuta una sola vez, después del próximo cargar(): simula otra petición concurrente. */
    public ?\Closure $alCargar = null;

    public function cargar(string $id): ?array
    {
        $datos = $this->sesiones[$id] ?? null;
        if ($this->alCargar !== null) {
            $f = $this->alCargar;
            $this->alCargar = null;
            $f();
        }
        return $datos;
    }

    public function guardar(string $id, array $datos): void
    {
        if (!array_key_exists($id, $this->sesiones)) {
            throw new \LogicException('Solo se guarda en sesiones creadas por regenerar().');
        }
        $this->sesiones[$id] = $datos;
    }

    public function regenerar(?string $idActual): string
    {
        if ($idActual !== null) {
            unset($this->sesiones[$idActual]);
        }
        $nuevo = bin2hex(random_bytes(16));
        $this->sesiones[$nuevo] = [];
        return $nuevo;
    }

    public function destruir(string $id): void
    {
        unset($this->sesiones[$id]);
    }
}
