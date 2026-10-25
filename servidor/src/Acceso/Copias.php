<?php

declare(strict_types=1);

namespace Manual\Acceso;

/**
 * Copia de trabajo de un laboratorio por capítulo e instantáneas (revisiones_copia).
 * Capa de acceso filtrada por usuario: cada método recibe `int $usuarioId` primero y toda consulta
 * filtra por `usuario_id`.
 */
final class Copias
{
    /** Se guarda una instantánea si la última tiene más de 10 minutos (o no hay ninguna). */
    public const INTERVALO_INSTANTANEA = 600;
    /** Retención acotada (spec §6.6): solo las últimas N instantáneas por (usuario, capítulo). */
    public const MAX_INSTANTANEAS = 20;

    public function __construct(private readonly \PDO $bd, private readonly Sugerencias $sugerencias)
    {
    }

    /** @return array{versionBaseId:int,docJson:string,actualizado:\DateTimeImmutable}|null */
    public function leer(int $usuarioId, int $capituloId): ?array
    {
        $st = $this->bd->prepare('SELECT version_base_id, doc_json, actualizado FROM copias_laboratorio WHERE usuario_id = ? AND capitulo_id = ?');
        $st->execute([$usuarioId, $capituloId]);
        $f = $st->fetch();
        if ($f === false) {
            return null;
        }
        return [
            'versionBaseId' => (int) $f['version_base_id'],
            'docJson' => $f['doc_json'],
            'actualizado' => new \DateTimeImmutable($f['actualizado'], new \DateTimeZone('UTC')),
        ];
    }

    /**
     * En una transacción: upsert de la copia (que bloquea la fila y serializa guardados simultáneos
     * del mismo laboratorio y capítulo), reemplazo del conjunto de sugerencias e instantánea si toca.
     * Cualquier fallo deshace todo.
     *
     * @param list<array{uid:string,bloqueId:string,tipo:string,grupo:?string,datos:string,motivo:?string}> $sugerencias
     */
    public function guardar(int $usuarioId, int $capituloId, int $versionBaseId, string $docJson, array $sugerencias, \DateTimeImmutable $ahora): void
    {
        $ahora = $ahora->setTimezone(new \DateTimeZone('UTC'));
        $fecha = $ahora->format('Y-m-d H:i:s');
        $this->bd->beginTransaction();
        try {
            $this->bd->prepare(
                'INSERT INTO copias_laboratorio (usuario_id, capitulo_id, version_base_id, doc_json, actualizado) VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE version_base_id = ?, doc_json = ?, actualizado = ?'
            )->execute([$usuarioId, $capituloId, $versionBaseId, $docJson, $fecha, $versionBaseId, $docJson, $fecha]);

            $this->sugerencias->reemplazar($usuarioId, $capituloId, $versionBaseId, $sugerencias, $ahora);

            $st = $this->bd->prepare('SELECT MAX(creado) FROM revisiones_copia WHERE usuario_id = ? AND capitulo_id = ?');
            $st->execute([$usuarioId, $capituloId]);
            $ultima = $st->fetchColumn();
            $toca = !is_string($ultima)
                || $ahora->getTimestamp() - (new \DateTimeImmutable($ultima, new \DateTimeZone('UTC')))->getTimestamp() > self::INTERVALO_INSTANTANEA;
            if ($toca) {
                $this->bd->prepare('INSERT INTO revisiones_copia (usuario_id, capitulo_id, doc_json, creado) VALUES (?, ?, ?, ?)')
                    ->execute([$usuarioId, $capituloId, $docJson, $fecha]);
                // Se borran las más antiguas, en la misma transacción. La fila de la copia ya está
                // bloqueada por el upsert, así que no hay carreras entre guardados del mismo laboratorio.
                $st = $this->bd->prepare(
                    'SELECT id FROM revisiones_copia WHERE usuario_id = ? AND capitulo_id = ?
                     ORDER BY id DESC LIMIT 1 OFFSET ' . (self::MAX_INSTANTANEAS - 1)
                );
                $st->execute([$usuarioId, $capituloId]);
                $corte = $st->fetchColumn();
                if ($corte !== false) {
                    $this->bd->prepare('DELETE FROM revisiones_copia WHERE usuario_id = ? AND capitulo_id = ? AND id < ?')
                        ->execute([$usuarioId, $capituloId, (int) $corte]);
                }
            }
            $this->bd->commit();
        } catch (\Throwable $e) {
            if ($this->bd->inTransaction()) {
                $this->bd->rollBack();
            }
            throw $e;
        }
    }
}
