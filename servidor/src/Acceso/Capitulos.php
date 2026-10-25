<?php

declare(strict_types=1);

namespace Manual\Acceso;

use Manual\Config;

/**
 * Capítulos y sus versiones. Datos comunes a todos los usuarios (sin filtro por usuario).
 * El documento de una versión base es inmutable: se cachea en APCu con la clave `<prefijo>:base:<versionId>`.
 * El prefijo distingue instalaciones que compartan APCu (p. ej. pruebas y producción en el mismo pool).
 */
final class Capitulos
{
    private readonly bool $cache;

    /**
     * @param bool|null $cache null = usar APCu si está disponible y habilitado
     * @param string $prefijo de las claves de APCu; ver prefijoInstalacion()
     */
    public function __construct(private readonly \PDO $bd, ?bool $cache = null, private readonly string $prefijo = '')
    {
        $this->cache = $cache ?? (function_exists('apcu_enabled') && apcu_enabled());
    }

    /** Prefijo de caché propio de la instalación: hash del DSN (servidor y base) y del usuario de BD. */
    public static function prefijoInstalacion(Config $config): string
    {
        return substr(sha1($config->bdDsn . "\0" . $config->bdUsuario), 0, 16);
    }

    /** @return list<array{id:int,orden:int,slug:string,titulo:string}> */
    public function listar(): array
    {
        $filas = $this->bd->query('SELECT id, orden, slug, titulo FROM capitulos ORDER BY orden, id')->fetchAll();
        return array_map(fn (array $f): array => [
            'id' => (int) $f['id'], 'orden' => (int) $f['orden'], 'slug' => $f['slug'], 'titulo' => $f['titulo'],
        ], $filas);
    }

    /** Id de la versión base vigente (la última de tipo `base`), o null si el capítulo no existe. */
    public function versionBaseVigente(int $capituloId): ?int
    {
        $st = $this->bd->prepare("SELECT MAX(id) FROM versiones_capitulo WHERE capitulo_id = ? AND tipo = 'base'");
        $st->execute([$capituloId]);
        $id = $st->fetchColumn();
        return $id === false || $id === null ? null : (int) $id;
    }

    /** JSON del documento de una versión base: de APCu si está; si no, de la base (y se guarda en APCu). */
    public function docBase(int $versionId): ?string
    {
        $clave = "{$this->prefijo}:base:$versionId";
        $doc = $this->desdeCache($clave);
        if ($doc !== null) {
            return $doc;
        }
        $st = $this->bd->prepare("SELECT doc_json FROM versiones_capitulo WHERE id = ? AND tipo = 'base'");
        $st->execute([$versionId]);
        $doc = $st->fetchColumn();
        if (!is_string($doc)) {
            return null;
        }
        $this->aCache($clave, $doc);
        return $doc;
    }

    /** La ausencia o un fallo de APCu se tratan como caché vacía: se lee de la base. */
    private function desdeCache(string $clave): ?string
    {
        if (!$this->cache) {
            return null;
        }
        try {
            $v = apcu_fetch($clave, $ok);
            return $ok && is_string($v) ? $v : null;
        } catch (\Throwable) {
            return null;
        }
    }

    private function aCache(string $clave, string $valor): void
    {
        if (!$this->cache) {
            return;
        }
        try {
            apcu_store($clave, $valor);
        } catch (\Throwable) {
            // Sin caché se sigue leyendo de la base.
        }
    }

    /**
     * Inserta una versión `final` nueva (las anteriores se conservan). El tex va en `tex_final`;
     * `tex_original` queda NULL, que es solo de las versiones base.
     */
    public function guardarFinal(int $capituloId, string $docJson, string $tex, int $usuarioId): int
    {
        $this->bd->prepare("INSERT INTO versiones_capitulo (capitulo_id, tipo, tex_original, doc_json, tex_final, creado_por) VALUES (?, 'final', NULL, ?, ?, ?)")
            ->execute([$capituloId, $docJson, $tex, $usuarioId]);
        return (int) $this->bd->lastInsertId();
    }

    /** La última versión final del capítulo, o null. @return array{versionId:int,docJson:string,tex:string}|null */
    public function ultimaFinal(int $capituloId): ?array
    {
        $st = $this->bd->prepare("SELECT id, doc_json, tex_final FROM versiones_capitulo WHERE capitulo_id = ? AND tipo = 'final' ORDER BY id DESC LIMIT 1");
        $st->execute([$capituloId]);
        $f = $st->fetch();
        return $f === false ? null : ['versionId' => (int) $f['id'], 'docJson' => $f['doc_json'], 'tex' => (string) $f['tex_final']];
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
