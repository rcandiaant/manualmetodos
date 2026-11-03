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

    /**
     * Cambia el orden y/o el título (null = no cambiar). Son solo presentación: no tocan las versiones.
     * Lee y escribe en una transacción con la fila bloqueada (FOR UPDATE).
     * @return array{id:int,orden:int,slug:string,titulo:string}|null los valores anteriores, o null si no existe
     */
    public function actualizar(int $id, ?int $orden, ?string $titulo): ?array
    {
        $this->bd->beginTransaction();
        try {
            $st = $this->bd->prepare('SELECT id, orden, slug, titulo FROM capitulos WHERE id = ? FOR UPDATE');
            $st->execute([$id]);
            $f = $st->fetch();
            if ($f === false) {
                $this->bd->rollBack();
                return null;
            }
            $sets = [];
            $valores = [];
            if ($orden !== null) {
                $sets[] = 'orden = ?';
                $valores[] = $orden;
            }
            if ($titulo !== null) {
                $sets[] = 'titulo = ?';
                $valores[] = $titulo;
            }
            if ($sets !== []) {
                $valores[] = $id;
                $this->bd->prepare('UPDATE capitulos SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($valores);
            }
            $this->bd->commit();
        } catch (\Throwable $e) {
            if ($this->bd->inTransaction()) {
                $this->bd->rollBack();
            }
            throw $e;
        }
        return ['id' => (int) $f['id'], 'orden' => (int) $f['orden'], 'slug' => $f['slug'], 'titulo' => $f['titulo']];
    }

    /**
     * Borra un capítulo sin aportes: sus filas de versiones_capitulo y luego la de capitulos, en una transacción.
     * La fila del capítulo se bloquea (FOR UPDATE) antes de contar los aportes: un INSERT concurrente en una tabla
     * hija espera ese bloqueo por la FK, así que no puede colarse un aporte entre la comprobación y el borrado.
     * Tras confirmar, invalida en APCu los documentos base de las versiones borradas.
     * @return array{estado:'borrado',capitulo:array{id:int,orden:int,slug:string,titulo:string},versiones:list<int>}
     *       |array{estado:'no_existe'}|array{estado:'con_aportes'}
     */
    public function borrarSinAportes(int $id): array
    {
        $this->bd->beginTransaction();
        try {
            $st = $this->bd->prepare('SELECT id, orden, slug, titulo FROM capitulos WHERE id = ? FOR UPDATE');
            $st->execute([$id]);
            $f = $st->fetch();
            if ($f === false) {
                $this->bd->rollBack();
                return ['estado' => 'no_existe'];
            }
            if ($this->tieneAportes($id)) {
                $this->bd->rollBack();
                return ['estado' => 'con_aportes'];
            }
            $st = $this->bd->prepare('SELECT id FROM versiones_capitulo WHERE capitulo_id = ? ORDER BY id');
            $st->execute([$id]);
            $versiones = array_map('intval', $st->fetchAll(\PDO::FETCH_COLUMN));
            // Primero las versiones (FK fk_versiones_capitulo), después el capítulo.
            $this->bd->prepare('DELETE FROM versiones_capitulo WHERE capitulo_id = ?')->execute([$id]);
            $this->bd->prepare('DELETE FROM capitulos WHERE id = ?')->execute([$id]);
            $this->bd->commit();
        } catch (\Throwable $e) {
            if ($this->bd->inTransaction()) {
                $this->bd->rollBack();
            }
            throw $e;
        }
        foreach ($versiones as $v) {
            $this->quitarDeCache("{$this->prefijo}:base:$v");
        }
        return [
            'estado' => 'borrado',
            'capitulo' => ['id' => (int) $f['id'], 'orden' => (int) $f['orden'], 'slug' => $f['slug'], 'titulo' => $f['titulo']],
            'versiones' => $versiones,
        ];
    }

    /** Aportes: copias, instantáneas, sugerencias o comentarios de algún laboratorio, o una versión final. */
    private function tieneAportes(int $id): bool
    {
        $st = $this->bd->prepare(
            'SELECT EXISTS(SELECT 1 FROM copias_laboratorio WHERE capitulo_id = ?)'
            . ' OR EXISTS(SELECT 1 FROM revisiones_copia WHERE capitulo_id = ?)'
            . ' OR EXISTS(SELECT 1 FROM sugerencias WHERE capitulo_id = ?)'
            . ' OR EXISTS(SELECT 1 FROM comentarios WHERE capitulo_id = ?)'
            . " OR EXISTS(SELECT 1 FROM versiones_capitulo WHERE capitulo_id = ? AND tipo = 'final')"
        );
        $st->execute([$id, $id, $id, $id, $id]);
        return (bool) $st->fetchColumn();
    }

    /** Cuántos laboratorios (usuarios distintos) tienen copias, instantáneas, sugerencias o comentarios en el capítulo. */
    private function laboratoriosConAportes(int $id): int
    {
        $st = $this->bd->prepare(
            'SELECT COUNT(*) FROM (SELECT usuario_id FROM copias_laboratorio WHERE capitulo_id = ?'
            . ' UNION SELECT usuario_id FROM revisiones_copia WHERE capitulo_id = ?'
            . ' UNION SELECT usuario_id FROM sugerencias WHERE capitulo_id = ?'
            . ' UNION SELECT usuario_id FROM comentarios WHERE capitulo_id = ?) AS t'
        );
        $st->execute([$id, $id, $id, $id]);
        return (int) $st->fetchColumn();
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

    private function quitarDeCache(string $clave): void
    {
        if (!$this->cache) {
            return;
        }
        try {
            apcu_delete($clave);
        } catch (\Throwable) {
            // Una clave huérfana no se vuelve a leer: el capítulo y sus versiones ya no existen.
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
     * Reemplazar el texto de un capítulo existente solo se permite si no tiene aportes (ver tieneAportes):
     * la fila se bloquea (FOR UPDATE) antes de comprobarlo, igual que en borrarSinAportes.
     * @return array{estado:'subido',id:int,versionId:int}|array{estado:'con_aportes',laboratorios:int}
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
                if ($this->tieneAportes($id)) {
                    $laboratorios = $this->laboratoriosConAportes($id);
                    $this->bd->rollBack();
                    return ['estado' => 'con_aportes', 'laboratorios' => $laboratorios];
                }
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
        return ['estado' => 'subido', 'id' => $id, 'versionId' => $versionId];
    }
}
