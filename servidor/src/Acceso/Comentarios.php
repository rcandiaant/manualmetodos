<?php

declare(strict_types=1);

namespace Manual\Acceso;

/**
 * Comentarios de un laboratorio. Capa de acceso filtrada por usuario: cada método recibe
 * `int $usuarioId` primero y toda consulta filtra por `usuario_id`.
 */
final class Comentarios
{
    public function __construct(private readonly \PDO $bd)
    {
    }

    /** @return list<array{id:int,bloqueId:string,rango:array{desde:int,hasta:int},texto:string,estado:string,creado:?string}> */
    public function delCapitulo(int $usuarioId, int $capituloId): array
    {
        $st = $this->bd->prepare('SELECT id, bloque_id, rango, texto, estado, creado FROM comentarios WHERE usuario_id = ? AND capitulo_id = ? ORDER BY id');
        $st->execute([$usuarioId, $capituloId]);
        return array_map(fn (array $f): array => [
            'id' => (int) $f['id'],
            'bloqueId' => $f['bloque_id'],
            'rango' => json_decode($f['rango'], true, 4, JSON_THROW_ON_ERROR),
            'texto' => $f['texto'],
            'estado' => $f['estado'],
            'creado' => Consulta::iso(new \DateTimeImmutable($f['creado'], new \DateTimeZone('UTC'))),
        ], $st->fetchAll());
    }

    /** @return array<int,int> capituloId => cantidad de comentarios propios */
    public function conteoPorCapitulo(int $usuarioId): array
    {
        $st = $this->bd->prepare('SELECT capitulo_id, COUNT(*) AS n FROM comentarios WHERE usuario_id = ? GROUP BY capitulo_id');
        $st->execute([$usuarioId]);
        $res = [];
        foreach ($st->fetchAll() as $f) {
            $res[(int) $f['capitulo_id']] = (int) $f['n'];
        }
        return $res;
    }

    /** @param array{desde:int,hasta:int} $rango */
    public function crear(int $usuarioId, int $capituloId, string $bloqueId, array $rango, string $texto, \DateTimeImmutable $ahora): int
    {
        $this->bd->prepare('INSERT INTO comentarios (usuario_id, capitulo_id, bloque_id, rango, texto, creado) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([
                $usuarioId, $capituloId, $bloqueId,
                json_encode(['desde' => $rango['desde'], 'hasta' => $rango['hasta']], JSON_THROW_ON_ERROR),
                $texto,
                $ahora->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s'),
            ]);
        return (int) $this->bd->lastInsertId();
    }

    /** false si no existe o no es propio. */
    public function editarTexto(int $usuarioId, int $id, string $texto): bool
    {
        // rowCount() de MySQL cuenta filas cambiadas, no encontradas: se comprueba la existencia aparte.
        $st = $this->bd->prepare('SELECT id FROM comentarios WHERE usuario_id = ? AND id = ?');
        $st->execute([$usuarioId, $id]);
        if ($st->fetchColumn() === false) {
            return false;
        }
        $this->bd->prepare('UPDATE comentarios SET texto = ? WHERE usuario_id = ? AND id = ?')->execute([$texto, $usuarioId, $id]);
        return true;
    }

    /** Comentarios propios con su resolución (lo que el laboratorio ve en edicion_final). */
    public function propiosConResolucion(int $usuarioId, int $capituloId): array
    {
        $st = $this->bd->prepare('SELECT id, bloque_id, rango, texto, estado, nota_resolucion, creado FROM comentarios WHERE usuario_id = ? AND capitulo_id = ? ORDER BY id');
        $st->execute([$usuarioId, $capituloId]);
        return array_map(fn (array $f): array => [
            'id' => (int) $f['id'],
            'bloqueId' => $f['bloque_id'],
            'rango' => json_decode($f['rango'], true, 4, JSON_THROW_ON_ERROR),
            'texto' => $f['texto'],
            'estado' => $f['estado'],
            'notaResolucion' => $f['nota_resolucion'],
            'creado' => Consulta::iso(Consulta::desdeSql($f['creado'])),
        ], $st->fetchAll());
    }

    // ------------------------------------------------------------------
    // Acceso del revisor: SIN filtro por usuario. Solo se llama tras exigirRol('revisor').
    // ------------------------------------------------------------------

    /** Todos los comentarios del capítulo, con laboratorio y usuarioId. */
    public function todosDelCapitulo(int $capituloId): array
    {
        $st = $this->bd->prepare(
            'SELECT c.id, c.usuario_id, c.bloque_id, c.rango, c.texto, c.estado, c.nota_resolucion, c.resuelto_por, c.resuelto_en, c.creado, u.laboratorio
             FROM comentarios c JOIN usuarios u ON u.id = c.usuario_id WHERE c.capitulo_id = ? ORDER BY c.id'
        );
        $st->execute([$capituloId]);
        return array_map(fn (array $f): array => [
            'id' => (int) $f['id'],
            'usuarioId' => (int) $f['usuario_id'],
            'laboratorio' => $f['laboratorio'],
            'bloqueId' => $f['bloque_id'],
            'rango' => json_decode($f['rango'], true, 4, JSON_THROW_ON_ERROR),
            'texto' => $f['texto'],
            'estado' => $f['estado'],
            'notaResolucion' => $f['nota_resolucion'],
            'resueltoPor' => $f['resuelto_por'] === null ? null : (int) $f['resuelto_por'],
            'resueltoEn' => Consulta::iso(Consulta::desdeSql($f['resuelto_en'])),
            'creado' => Consulta::iso(Consulta::desdeSql($f['creado'])),
        ], $st->fetchAll());
    }

    /** @return array<int,array{total:int,abiertos:int}> capituloId => totales de todos los laboratorios */
    public function resumenPorCapitulo(): array
    {
        $filas = $this->bd->query(
            "SELECT capitulo_id, COUNT(*) AS n, SUM(estado = 'abierto') AS a FROM comentarios GROUP BY capitulo_id"
        )->fetchAll();
        $res = [];
        foreach ($filas as $f) {
            $res[(int) $f['capitulo_id']] = ['total' => (int) $f['n'], 'abiertos' => (int) $f['a']];
        }
        return $res;
    }

    /**
     * Resuelve o reabre un comentario (cualquiera). Una sola transacción con la auditoría.
     * `abierto` borra quién y cuándo resolvió.
     * @param callable(array{capituloId:int,estado:string}): void $auditar
     * @return bool false si el comentario no existe
     */
    public function resolver(int $id, string $estado, ?string $nota, int $revisorId, \DateTimeImmutable $ahora, callable $auditar): bool
    {
        $this->bd->beginTransaction();
        try {
            $st = $this->bd->prepare('SELECT capitulo_id, estado FROM comentarios WHERE id = ? FOR UPDATE');
            $st->execute([$id]);
            $f = $st->fetch();
            if ($f === false) {
                $this->bd->rollBack();
                return false;
            }
            $abierto = $estado === 'abierto';
            $this->bd->prepare('UPDATE comentarios SET estado = ?, nota_resolucion = ?, resuelto_por = ?, resuelto_en = ? WHERE id = ?')
                ->execute([
                    $estado, $nota,
                    $abierto ? null : $revisorId,
                    $abierto ? null : $ahora->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s'),
                    $id,
                ]);
            $auditar(['capituloId' => (int) $f['capitulo_id'], 'estado' => $f['estado']]);
            $this->bd->commit();
            return true;
        } catch (\Throwable $e) {
            if ($this->bd->inTransaction()) {
                $this->bd->rollBack();
            }
            throw $e;
        }
    }

    /** false si no existe o no es propio. */
    public function borrar(int $usuarioId, int $id): bool
    {
        $st = $this->bd->prepare('DELETE FROM comentarios WHERE usuario_id = ? AND id = ?');
        $st->execute([$usuarioId, $id]);
        return $st->rowCount() > 0;
    }
}
