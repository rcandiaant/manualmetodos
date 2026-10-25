<?php

declare(strict_types=1);

namespace Manual\Acceso;

use Manual\Reloj;

/** Registro de acciones relevantes en la tabla auditoria. No guarda claves ni correos en claro. */
final class Auditoria
{
    public function __construct(private readonly \PDO $bd, private readonly Reloj $reloj)
    {
    }

    /** @param array<string,mixed> $detalle */
    public function registrar(?int $usuarioId, string $accion, string $entidad, ?int $entidadId, array $detalle = []): void
    {
        $this->bd->prepare('INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, detalle, creado) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([
                $usuarioId,
                $accion,
                $entidad,
                $entidadId === null ? null : (string) $entidadId,
                $detalle === [] ? null : json_encode($detalle, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                $this->reloj->ahora()->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s'),
            ]);
    }
}
