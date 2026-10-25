<?php

declare(strict_types=1);

namespace Manual\Acceso;

/** Capítulos y sus versiones. */
final class Capitulos
{
    public function __construct(private readonly \PDO $bd)
    {
    }

    /**
     * Crea el capítulo (o actualiza título y orden si el slug ya existe) y le añade una versión base.
     * La versión base vigente es la última de tipo `base`.
     * @return array{id:int,versionId:int}
     */
    public function subirBase(string $slug, string $titulo, int $orden, string $texOriginal, string $docJson, int $usuarioId): array
    {
        $this->bd->beginTransaction();
        try {
            $st = $this->bd->prepare('SELECT id FROM capitulos WHERE slug = ? FOR UPDATE');
            $st->execute([$slug]);
            $id = $st->fetchColumn();
            if ($id === false) {
                $this->bd->prepare('INSERT INTO capitulos (orden, slug, titulo) VALUES (?, ?, ?)')->execute([$orden, $slug, $titulo]);
                $id = (int) $this->bd->lastInsertId();
            } else {
                $id = (int) $id;
                $this->bd->prepare('UPDATE capitulos SET orden = ?, titulo = ? WHERE id = ?')->execute([$orden, $titulo, $id]);
            }
            $this->bd->prepare("INSERT INTO versiones_capitulo (capitulo_id, tipo, tex_original, doc_json, creado_por) VALUES (?, 'base', ?, ?, ?)")
                ->execute([$id, $texOriginal, $docJson, $usuarioId]);
            $versionId = (int) $this->bd->lastInsertId();
            $this->bd->commit();
        } catch (\Throwable $e) {
            if ($this->bd->inTransaction()) {
                $this->bd->rollBack();
            }
            throw $e;
        }
        return ['id' => $id, 'versionId' => $versionId];
    }
}
