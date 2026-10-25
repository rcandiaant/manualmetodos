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

    /** false si no existe o no es propio. */
    public function borrar(int $usuarioId, int $id): bool
    {
        $st = $this->bd->prepare('DELETE FROM comentarios WHERE usuario_id = ? AND id = ?');
        $st->execute([$usuarioId, $id]);
        return $st->rowCount() > 0;
    }
}
