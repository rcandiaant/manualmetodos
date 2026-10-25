<?php

declare(strict_types=1);

namespace Manual\Pruebas\Api;

use Manual\Bd\Migrador;
use Manual\Pruebas\Soporte\BaseDePruebas;
use PHPUnit\Framework\TestCase;

final class MigracionTest extends TestCase
{
    use BaseDePruebas;

    private const TABLAS = [
        'auditoria', 'capitulos', 'comentarios', 'consulta', 'copias_laboratorio', 'intentos_login',
        'migraciones_aplicadas', 'revisiones_copia', 'sugerencias', 'usuarios', 'versiones_capitulo',
    ];

    private function usuario(string $indice = 'aa'): int
    {
        self::$bd->prepare('INSERT INTO usuarios (nombre, laboratorio, correo_cifrado, correo_indice, clave_hash, roles) VALUES (?,?,?,?,?,?)')
            ->execute(['N', 'Lab', 'x', str_pad($indice, 32, "\0"), 'h', 'laboratorio']);
        return (int) self::$bd->lastInsertId();
    }

    /** @return array{int,int} */
    private function capitulo(): array
    {
        self::$bd->exec("INSERT INTO capitulos (orden, slug, titulo) VALUES (1, 'c1', 'Cap')");
        $cap = (int) self::$bd->lastInsertId();
        self::$bd->exec("INSERT INTO versiones_capitulo (capitulo_id, tipo, tex_original, doc_json) VALUES ($cap, 'base', 't', '{}')");
        return [$cap, (int) self::$bd->lastInsertId()];
    }

    public function test_migracion_crea_todas_las_tablas(): void
    {
        $tablas = self::$bd->query('SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name')->fetchAll(\PDO::FETCH_COLUMN);
        $this->assertSame(self::TABLAS, $tablas);
        $malas = self::$bd->query("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND (table_collation <> 'utf8mb4_unicode_ci' OR engine <> 'InnoDB')")->fetchAll(\PDO::FETCH_COLUMN);
        $this->assertSame([], $malas);
    }

    public function test_migracion_es_idempotente(): void
    {
        $bd = self::recrearBaseVacia();
        $this->assertSame(['001_inicial.sql'], Migrador::aplicar($bd, self::directorioMigraciones()));
        $this->assertSame([], Migrador::aplicar($bd, self::directorioMigraciones()));
        $this->assertSame(1, (int) $bd->query('SELECT COUNT(*) FROM migraciones_aplicadas')->fetchColumn());
        self::$bd = $bd;
    }

    public function test_el_sql_se_puede_reimportar_a_mano(): void
    {
        // phpMyAdmin ejecuta el archivo entero aunque las tablas ya existan.
        $sql = file_get_contents(self::directorioMigraciones() . '/001_inicial.sql');
        foreach (Migrador::sentencias($sql) as $s) {
            self::$bd->exec($s);
        }
        $this->assertSame(1, (int) self::$bd->query("SELECT COUNT(*) FROM migraciones_aplicadas WHERE nombre = '001_inicial.sql'")->fetchColumn());
    }

    public function test_uid_de_sugerencia_es_unico_por_usuario_capitulo_version(): void
    {
        $u = $this->usuario();
        [$c, $v] = $this->capitulo();
        $ins = self::$bd->prepare("INSERT INTO sugerencias (usuario_id, capitulo_id, version_base_id, uid, bloque_id, tipo, datos) VALUES (?,?,?,?,'b','texto','{}')");
        $ins->execute([$u, $c, $v, 's1']);
        $ins->execute([$u, $c, $v, 's2']);
        $this->expectException(\PDOException::class);
        $this->expectExceptionCode(23000);
        $ins->execute([$u, $c, $v, 's1']);
    }

    public function test_correo_indice_es_unico(): void
    {
        $this->usuario('ab');
        $this->expectException(\PDOException::class);
        $this->expectExceptionCode(23000);
        $this->usuario('ab');
    }

    public function test_guarda_y_lee_unicode_sin_perdida(): void
    {
        $this->assertSame('latin1', self::$bd->query('SELECT @@character_set_database')->fetchColumn(), 'La base de pruebas debe ser latin1 por defecto para que esta prueba valga.');
        $texto = '≤ µ ñ “”';
        self::$bd->prepare('INSERT INTO capitulos (orden, slug, titulo) VALUES (1, ?, ?)')->execute(['uni', $texto]);
        $this->assertSame($texto, self::$bd->query("SELECT titulo FROM capitulos WHERE slug = 'uni'")->fetchColumn());
    }

    public function test_consulta_admite_una_sola_fila(): void
    {
        $this->expectException(\PDOException::class);
        self::$bd->exec('INSERT INTO consulta (id, motivo_obligatorio) VALUES (2, 0)');
    }
}
