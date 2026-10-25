<?php

declare(strict_types=1);

namespace Manual\Acceso;

/**
 * Sugerencias de un laboratorio. Capa de acceso filtrada por usuario (sustituto de RLS):
 * cada método recibe `int $usuarioId` primero y toda consulta filtra por `usuario_id`.
 */
final class Sugerencias
{
    public function __construct(private readonly \PDO $bd)
    {
    }

    /**
     * Clave de autor estable del laboratorio: `u<usuarioId>`. Los ids de sugerencia del cliente
     * (`<autor>:<bloqueId>:<sufijo>`) deben empezar por ella seguida de `:`.
     */
    public static function claveAutor(int $usuarioId): string
    {
        return 'u' . $usuarioId;
    }

    /**
     * Las sugerencias propias de un capítulo sobre una versión base, en orden de creación.
     * Cada una es el objeto validado que guardó el cliente más `autor`, `motivo` (si hay) y `estado`.
     * @return list<\stdClass>
     */
    public function delCapitulo(int $usuarioId, int $capituloId, int $versionBaseId): array
    {
        $st = $this->bd->prepare(
            'SELECT datos, motivo, estado FROM sugerencias
             WHERE usuario_id = ? AND capitulo_id = ? AND version_base_id = ? ORDER BY id'
        );
        $st->execute([$usuarioId, $capituloId, $versionBaseId]);
        $res = [];
        foreach ($st->fetchAll() as $f) {
            // Como objetos: un `{}` de los nodos vuelve como `{}`, no como `[]`.
            $s = json_decode($f['datos'], false, 512, JSON_THROW_ON_ERROR);
            $s->autor = self::claveAutor($usuarioId);
            if ($f['motivo'] !== null) {
                $s->motivo = $f['motivo'];
            }
            $s->estado = $f['estado'];
            $res[] = $s;
        }
        return $res;
    }

    /** @return array<int,int> capituloId => cantidad de sugerencias propias */
    public function conteoPorCapitulo(int $usuarioId): array
    {
        $st = $this->bd->prepare('SELECT capitulo_id, COUNT(*) AS n FROM sugerencias WHERE usuario_id = ? GROUP BY capitulo_id');
        $st->execute([$usuarioId]);
        $res = [];
        foreach ($st->fetchAll() as $f) {
            $res[(int) $f['capitulo_id']] = (int) $f['n'];
        }
        return $res;
    }

    /**
     * Reemplaza el conjunto de sugerencias propias del capítulo. Debe llamarse dentro de una transacción
     * (la abre Copias::guardar). Borra las que no vienen (y las de otras versiones base), actualiza los
     * datos de las que siguen conservando `motivo` y `estado`, e inserta las nuevas con su `motivo`.
     *
     * @param list<array{uid:string,bloqueId:string,tipo:string,grupo:?string,datos:string,motivo:?string}> $nuevas
     */
    public function reemplazar(int $usuarioId, int $capituloId, int $versionBaseId, array $nuevas, \DateTimeImmutable $ahora): void
    {
        if (!$this->bd->inTransaction()) {
            throw new \LogicException('Sugerencias::reemplazar exige una transacción abierta.');
        }
        $st = $this->bd->prepare('SELECT id, uid, version_base_id FROM sugerencias WHERE usuario_id = ? AND capitulo_id = ? FOR UPDATE');
        $st->execute([$usuarioId, $capituloId]);
        $existentes = [];
        $borrar = [];
        foreach ($st->fetchAll() as $f) {
            if ((int) $f['version_base_id'] === $versionBaseId) {
                $existentes[$f['uid']] = (int) $f['id'];
            } else {
                $borrar[] = (int) $f['id'];
            }
        }
        $vienen = array_flip(array_column($nuevas, 'uid'));
        foreach ($existentes as $uid => $id) {
            if (!isset($vienen[$uid])) {
                $borrar[] = $id;
            }
        }
        foreach (array_chunk($borrar, 500) as $lote) {
            $marcas = implode(',', array_fill(0, count($lote), '?'));
            $this->bd->prepare("DELETE FROM sugerencias WHERE usuario_id = ? AND id IN ($marcas)")->execute([$usuarioId, ...$lote]);
        }

        $actualizar = $this->bd->prepare('UPDATE sugerencias SET bloque_id = ?, tipo = ?, grupo = ?, datos = ? WHERE usuario_id = ? AND id = ?');
        $insertar = $this->bd->prepare(
            'INSERT INTO sugerencias (usuario_id, capitulo_id, version_base_id, uid, bloque_id, tipo, grupo, datos, motivo, creado)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $creado = $ahora->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        foreach ($nuevas as $s) {
            if (isset($existentes[$s['uid']])) {
                $actualizar->execute([$s['bloqueId'], $s['tipo'], $s['grupo'], $s['datos'], $usuarioId, $existentes[$s['uid']]]);
            } else {
                $insertar->execute([$usuarioId, $capituloId, $versionBaseId, $s['uid'], $s['bloqueId'], $s['tipo'], $s['grupo'], $s['datos'], $s['motivo'], $creado]);
            }
        }
    }

    /**
     * Sugerencias propias con su resolución (lo que el laboratorio ve en edicion_final).
     * @return list<\stdClass>
     */
    public function propiasConResolucion(int $usuarioId, int $capituloId): array
    {
        $st = $this->bd->prepare(
            'SELECT datos, motivo, estado, nota_resolucion FROM sugerencias
             WHERE usuario_id = ? AND capitulo_id = ? ORDER BY id'
        );
        $st->execute([$usuarioId, $capituloId]);
        $res = [];
        foreach ($st->fetchAll() as $f) {
            $s = json_decode($f['datos'], false, 512, JSON_THROW_ON_ERROR);
            $s->autor = self::claveAutor($usuarioId);
            if ($f['motivo'] !== null) {
                $s->motivo = $f['motivo'];
            }
            $s->estado = $f['estado'];
            $s->notaResolucion = $f['nota_resolucion'];
            $res[] = $s;
        }
        return $res;
    }

    // ------------------------------------------------------------------
    // Acceso del revisor: SIN filtro por usuario. Solo se llama tras exigirRol('revisor').
    // ------------------------------------------------------------------

    /**
     * Todas las sugerencias del capítulo, de todos los laboratorios.
     * `sugerenciaId` es el id de la fila (el de PATCH /sugerencias/{id}); `id` sigue siendo el uid del cliente.
     * @return list<\stdClass>
     */
    public function todasDelCapitulo(int $capituloId): array
    {
        $st = $this->bd->prepare(
            'SELECT s.id AS fila, s.usuario_id, s.version_base_id, s.datos, s.motivo, s.estado, s.nota_resolucion,
                    s.derivada_reunion, s.resuelto_por, s.resuelto_en, u.laboratorio
             FROM sugerencias s JOIN usuarios u ON u.id = s.usuario_id
             WHERE s.capitulo_id = ? ORDER BY s.id'
        );
        $st->execute([$capituloId]);
        $res = [];
        foreach ($st->fetchAll() as $f) {
            $s = json_decode($f['datos'], false, 512, JSON_THROW_ON_ERROR);
            $s->autor = self::claveAutor((int) $f['usuario_id']);
            if ($f['motivo'] !== null) {
                $s->motivo = $f['motivo'];
            }
            $s->sugerenciaId = (int) $f['fila'];
            $s->usuarioId = (int) $f['usuario_id'];
            $s->laboratorio = $f['laboratorio'];
            $s->versionId = (int) $f['version_base_id'];
            $s->estado = $f['estado'];
            $s->notaResolucion = $f['nota_resolucion'];
            $s->derivadaReunion = (bool) $f['derivada_reunion'];
            $s->resueltoPor = $f['resuelto_por'] === null ? null : (int) $f['resuelto_por'];
            $s->resueltoEn = Consulta::iso(Consulta::desdeSql($f['resuelto_en']));
            $res[] = $s;
        }
        return $res;
    }

    /** @return array<int,array{total:int,pendientes:int}> capituloId => totales de todos los laboratorios */
    public function resumenPorCapitulo(): array
    {
        $filas = $this->bd->query(
            "SELECT capitulo_id, COUNT(*) AS n, SUM(estado = 'pendiente') AS p FROM sugerencias GROUP BY capitulo_id"
        )->fetchAll();
        $res = [];
        foreach ($filas as $f) {
            $res[(int) $f['capitulo_id']] = ['total' => (int) $f['n'], 'pendientes' => (int) $f['p']];
        }
        return $res;
    }

    /**
     * Resuelve una sugerencia (cualquiera). Una sola transacción: bloquea la fila, la actualiza y llama
     * a `$auditar` con los datos previos antes de confirmar. `pendiente` borra quién y cuándo resolvió.
     * @param callable(array{capituloId:int,estado:string,derivadaReunion:bool}): void $auditar
     * @return bool false si la sugerencia no existe
     */
    public function resolver(int $id, string $estado, ?string $nota, bool $derivada, int $revisorId, \DateTimeImmutable $ahora, callable $auditar): bool
    {
        $this->bd->beginTransaction();
        try {
            $st = $this->bd->prepare('SELECT capitulo_id, estado, derivada_reunion FROM sugerencias WHERE id = ? FOR UPDATE');
            $st->execute([$id]);
            $f = $st->fetch();
            if ($f === false) {
                $this->bd->rollBack();
                return false;
            }
            $pendiente = $estado === 'pendiente';
            $this->bd->prepare(
                'UPDATE sugerencias SET estado = ?, nota_resolucion = ?, derivada_reunion = ?, resuelto_por = ?, resuelto_en = ? WHERE id = ?'
            )->execute([
                $estado, $nota, $derivada ? 1 : 0,
                $pendiente ? null : $revisorId,
                $pendiente ? null : $ahora->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s'),
                $id,
            ]);
            $auditar(['capituloId' => (int) $f['capitulo_id'], 'estado' => $f['estado'], 'derivadaReunion' => (bool) $f['derivada_reunion']]);
            $this->bd->commit();
            return true;
        } catch (\Throwable $e) {
            if ($this->bd->inTransaction()) {
                $this->bd->rollBack();
            }
            throw $e;
        }
    }

    /** Fija el motivo de una sugerencia propia (vacío = sin motivo). false si no existe o no es propia. */
    public function actualizarMotivo(int $usuarioId, int $capituloId, int $versionBaseId, string $uid, string $motivo): bool
    {
        $st = $this->bd->prepare('SELECT id FROM sugerencias WHERE usuario_id = ? AND capitulo_id = ? AND version_base_id = ? AND uid = ?');
        $st->execute([$usuarioId, $capituloId, $versionBaseId, $uid]);
        $id = $st->fetchColumn();
        if ($id === false) {
            return false;
        }
        $this->bd->prepare('UPDATE sugerencias SET motivo = ? WHERE usuario_id = ? AND id = ?')
            ->execute([$motivo === '' ? null : $motivo, $usuarioId, (int) $id]);
        return true;
    }
}
