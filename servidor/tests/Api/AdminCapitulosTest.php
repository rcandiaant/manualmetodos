<?php

declare(strict_types=1);

namespace Manual\Pruebas\Api;

use Manual\Acceso\Capitulos;
use Manual\Aplicacion;
use Manual\Pruebas\Soporte\BaseDePruebas;
use Manual\Pruebas\Soporte\ClienteApi;
use Manual\Pruebas\Soporte\RelojFijo;
use PHPUnit\Framework\TestCase;

/** PATCH y DELETE /api/admin/capitulos/{id}: numeración, título y borrado de capítulos sin aportes. */
final class AdminCapitulosTest extends TestCase
{
    use BaseDePruebas;

    private RelojFijo $reloj;
    private Aplicacion $app;

    protected function setUp(): void
    {
        if (function_exists('apcu_clear_cache')) {
            apcu_clear_cache();
        }
        $this->reloj = new RelojFijo('2026-11-02 12:00:00');
        $this->app = $this->nuevaAplicacion($this->reloj);
    }

    private function cliente(array $u): ClienteApi
    {
        return (new ClienteApi($this->app))->comoUsuario($u);
    }

    /** @return array{0:ClienteApi,1:array} */
    private function admin(): array
    {
        $a = $this->crearUsuario(['roles' => ['admin'], 'nombre' => 'Admin']);
        return [$this->cliente($a), $a];
    }

    /** Sube un capítulo y devuelve `{id, versionId}`. */
    private function subir(ClienteApi $c, string $slug = 'cap-1', string $titulo = 'Capítulo 1', int $orden = 1): array
    {
        $doc = json_decode((string) file_get_contents(__DIR__ . '/../fixtures/doc-listas.json'), true);
        $r = $c->post('/admin/capitulos', ['slug' => $slug, 'titulo' => $titulo, 'orden' => $orden, 'texOriginal' => '\\section{Hola}', 'docJson' => $doc]);
        self::assertSame(201, $r->estado, $r->cuerpo());
        return $r->datos;
    }

    private function fila(int $id): array|false
    {
        $st = self::$bd->prepare('SELECT orden, titulo, slug FROM capitulos WHERE id = ?');
        $st->execute([$id]);
        return $st->fetch();
    }

    private function auditoria(string $accion): array
    {
        $st = self::$bd->prepare('SELECT * FROM auditoria WHERE accion = ? ORDER BY id');
        $st->execute([$accion]);
        return $st->fetchAll();
    }

    private function abrirConsulta(): void
    {
        self::$bd->exec("UPDATE consulta SET apertura='2026-11-01 00:00:00', cierre='2026-11-30 00:00:00'");
    }

    private function cerrarConsulta(): void
    {
        self::$bd->exec("UPDATE consulta SET apertura='2026-11-01 00:00:00', cierre='2026-11-02 11:00:00'");
    }

    // ---------------------------------------------------------------- PATCH

    public function test_editar_orden_y_titulo_en_cualquier_etapa(): void
    {
        [$c, $a] = $this->admin();
        $cap = $this->subir($c)['id'];
        $otro = $this->subir($c, 'cap-2', 'Otro', 5)['id'];
        self::assertSame([$cap, $otro], array_column($c->get('/capitulos')->datos, 'id'));

        $r = $c->patch("/admin/capitulos/$cap", ['orden' => 7]);
        self::assertSame(200, $r->estado, $r->cuerpo());
        self::assertSame(['id' => $cap], $r->datos);
        self::assertSame(['orden' => 7, 'titulo' => 'Capítulo 1', 'slug' => 'cap-1'], $this->filaTipada($cap));
        self::assertSame([$otro, $cap], array_column($c->get('/capitulos')->datos, 'id'));

        $this->abrirConsulta();
        $r = $c->patch("/admin/capitulos/$cap", ['titulo' => 'Cloruro total ñ']);
        self::assertSame(200, $r->estado, $r->cuerpo());
        self::assertSame(['orden' => 7, 'titulo' => 'Cloruro total ñ', 'slug' => 'cap-1'], $this->filaTipada($cap));

        $this->cerrarConsulta();
        $r = $c->patch("/admin/capitulos/$cap", ['orden' => 0, 'titulo' => 'Final', 'slug' => 'ignorado']);
        self::assertSame(200, $r->estado, $r->cuerpo());
        self::assertSame(['orden' => 0, 'titulo' => 'Final', 'slug' => 'cap-1'], $this->filaTipada($cap));

        // La versión base no cambia: el título y el orden son solo presentación.
        self::assertSame(2, (int) self::$bd->query('SELECT COUNT(*) FROM versiones_capitulo')->fetchColumn());

        // El listado sigue el nuevo orden (orden 0 < 5).
        self::assertSame([$cap, $otro], array_column($c->get('/capitulos')->datos, 'id'));

        $aud = $this->auditoria('editar_capitulo');
        self::assertCount(3, $aud);
        self::assertSame((string) $cap, $aud[0]['entidad_id']);
        self::assertSame('capitulo', $aud[0]['entidad']);
        self::assertSame((int) $a['id'], (int) $aud[0]['usuario_id']);
        self::assertSame(['orden' => ['antes' => 1, 'despues' => 7]], json_decode((string) $aud[0]['detalle'], true));
        self::assertSame(['titulo' => ['antes' => 'Capítulo 1', 'despues' => 'Cloruro total ñ']], json_decode((string) $aud[1]['detalle'], true));
        self::assertSame(['orden', 'titulo'], array_keys(json_decode((string) $aud[2]['detalle'], true)));
    }

    /** @return array{orden:int,titulo:string,slug:string} */
    private function filaTipada(int $id): array
    {
        $f = $this->fila($id);
        self::assertIsArray($f);
        return ['orden' => (int) $f['orden'], 'titulo' => $f['titulo'], 'slug' => $f['slug']];
    }

    public function test_editar_valida_entrada_y_404(): void
    {
        [$c] = $this->admin();
        $cap = $this->subir($c)['id'];
        $mal = [
            [], ['slug' => 'x'], ['orden' => '1'], ['orden' => 1.5], ['orden' => -1], ['orden' => 100001], ['orden' => null],
            ['titulo' => ''], ['titulo' => str_repeat('a', 256)], ['titulo' => 5], ['titulo' => null],
            ['orden' => 2, 'titulo' => ''],
        ];
        foreach ($mal as $i => $cuerpo) {
            $r = $c->patch("/admin/capitulos/$cap", $cuerpo);
            self::assertSame(400, $r->estado, "caso $i: " . $r->cuerpo());
            self::assertSame('entrada_invalida', $r->datos['error']['codigo']);
        }
        self::assertSame(['orden' => 1, 'titulo' => 'Capítulo 1', 'slug' => 'cap-1'], $this->filaTipada($cap));

        // Límites válidos
        self::assertSame(200, $c->patch("/admin/capitulos/$cap", ['orden' => 100000, 'titulo' => str_repeat('á', 255)])->estado);

        $r = $c->patch('/admin/capitulos/999', ['orden' => 2]);
        self::assertSame(404, $r->estado);
        self::assertSame('no_encontrado', $r->datos['error']['codigo']);
        self::assertCount(1, $this->auditoria('editar_capitulo'));
    }

    public function test_editar_y_borrar_exigen_admin(): void
    {
        [$c] = $this->admin();
        $cap = $this->subir($c)['id'];
        foreach ([['laboratorio'], ['revisor']] as $roles) {
            $otro = $this->cliente($this->crearUsuario(['roles' => $roles]));
            $r = $otro->patch("/admin/capitulos/$cap", ['orden' => 2]);
            self::assertSame(403, $r->estado);
            self::assertSame('sin_permiso', $r->datos['error']['codigo']);
            self::assertSame(403, $otro->delete("/admin/capitulos/$cap")->estado);
        }
        $anonimo = new ClienteApi($this->app);
        self::assertSame(401, $anonimo->patch("/admin/capitulos/$cap", ['orden' => 2])->estado);
        self::assertSame(401, $anonimo->delete("/admin/capitulos/$cap")->estado);
        self::assertSame(['orden' => 1, 'titulo' => 'Capítulo 1', 'slug' => 'cap-1'], $this->filaTipada($cap));
    }

    // ---------------------------------------------------------------- DELETE

    public function test_borrar_en_preparacion_quita_capitulo_y_versiones(): void
    {
        [$c, $a] = $this->admin();
        $v1 = $this->subir($c);
        $v2 = $this->subir($c, 'cap-1', 'Capítulo 1 bis');
        $cap = $v1['id'];
        $otro = $this->subir($c, 'cap-2', 'Otro', 2);

        // Deja el documento base en la caché.
        self::assertSame(200, $c->get("/capitulos/$cap/base")->estado);
        $clave = Capitulos::prefijoInstalacion(self::configPruebas()) . ':base:' . $v2['versionId'];
        $conApcu = function_exists('apcu_enabled') && apcu_enabled();
        if ($conApcu) {
            self::assertNotFalse(apcu_fetch($clave));
        }

        $r = $c->delete("/admin/capitulos/$cap");
        self::assertSame(204, $r->estado, $r->cuerpo());
        self::assertSame('', $r->cuerpo());
        self::assertFalse($this->fila($cap));
        self::assertSame(0, (int) self::$bd->query("SELECT COUNT(*) FROM versiones_capitulo WHERE capitulo_id = $cap")->fetchColumn());
        self::assertSame(404, $c->get("/capitulos/$cap/base")->estado);
        if ($conApcu) {
            self::assertFalse(apcu_fetch($clave), 'se invalida la caché del documento base');
        }

        // El otro capítulo queda intacto.
        self::assertSame([$otro['id']], array_column($c->get('/capitulos')->datos, 'id'));
        self::assertSame(200, $c->get("/capitulos/{$otro['id']}/base")->estado);

        $aud = $this->auditoria('borrar_capitulo');
        self::assertCount(1, $aud);
        self::assertSame('capitulo', $aud[0]['entidad']);
        self::assertSame((string) $cap, $aud[0]['entidad_id']);
        self::assertSame((int) $a['id'], (int) $aud[0]['usuario_id']);
        $detalle = json_decode((string) $aud[0]['detalle'], true);
        self::assertSame('cap-1', $detalle['slug']);
        self::assertSame('Capítulo 1 bis', $detalle['titulo']);
        self::assertSame([$v1['versionId'], $v2['versionId']], $detalle['versiones']);

        // Un segundo borrado ya no lo encuentra.
        self::assertSame(404, $c->delete("/admin/capitulos/$cap")->estado);
    }

    public function test_borrar_sin_aportes_en_cualquier_etapa(): void
    {
        [$c] = $this->admin();
        foreach (['abrirConsulta' => 'cap-a', 'cerrarConsulta' => 'cap-b'] as $paso => $slug) {
            $cap = $this->subir($c, $slug)['id'];
            $this->$paso();
            $r = $c->delete("/admin/capitulos/$cap");
            self::assertSame(204, $r->estado, "$paso: " . $r->cuerpo());
            self::assertFalse($this->fila($cap), $paso);
        }
        self::assertCount(2, $this->auditoria('borrar_capitulo'));
    }

    public function test_borrar_con_aportes_fuera_de_preparacion_sigue_dando_409(): void
    {
        [$c] = $this->admin();
        $s = $this->subir($c);
        $lab = $this->crearUsuario()['id'];
        self::$bd->exec("INSERT INTO comentarios (usuario_id, capitulo_id, bloque_id, rango, texto) VALUES ($lab, {$s['id']}, 'b1', '{}', 'hola')");
        foreach (['abrirConsulta', 'cerrarConsulta'] as $paso) {
            $this->$paso();
            $r = $c->delete("/admin/capitulos/{$s['id']}");
            self::assertSame(409, $r->estado, $paso);
            self::assertSame('operacion_no_permitida', $r->datos['error']['codigo']);
            self::assertStringContainsString('aportes', $r->datos['error']['mensaje']);
            self::assertIsArray($this->fila($s['id']));
        }
        self::assertCount(0, $this->auditoria('borrar_capitulo'));
    }

    // ---------------------------------------------------------------- POST (subir / reemplazar)

    public function test_subir_capitulo_nuevo_en_cualquier_etapa(): void
    {
        [$c] = $this->admin();
        $this->abrirConsulta();
        $a = $this->subir($c, 'en-consulta', 'En consulta', 2);
        $this->cerrarConsulta();
        $b = $this->subir($c, 'en-edicion', 'En edición final', 3);
        self::assertSame(['en-consulta', 'en-edicion'], array_column($c->get('/capitulos')->datos, 'slug'));
        self::assertNotSame($a['id'], $b['id']);
        self::assertCount(2, $this->auditoria('subir_capitulo'));
    }

    public function test_reemplazar_texto_sin_aportes_en_cualquier_etapa(): void
    {
        [$c] = $this->admin();
        $v1 = $this->subir($c);
        $this->abrirConsulta();
        $v2 = $this->subir($c, 'cap-1', 'Reemplazado en consulta');
        $this->cerrarConsulta();
        $v3 = $this->subir($c, 'cap-1', 'Reemplazado en edición final', 4);
        self::assertSame($v1['id'], $v2['id']);
        self::assertSame($v1['id'], $v3['id']);
        self::assertGreaterThan($v2['versionId'], $v3['versionId']);
        self::assertSame(['orden' => 4, 'titulo' => 'Reemplazado en edición final', 'slug' => 'cap-1'], $this->filaTipada($v1['id']));
        self::assertSame(3, (int) self::$bd->query("SELECT COUNT(*) FROM versiones_capitulo WHERE tipo = 'base'")->fetchColumn());
    }

    public function test_reemplazar_texto_con_aportes_da_409_y_dice_cuantos_laboratorios(): void
    {
        [$c] = $this->admin();
        $s = $this->subir($c);
        $cap = $s['id'];
        $ver = $s['versionId'];
        $lab1 = $this->crearUsuario()['id'];
        $lab2 = $this->crearUsuario()['id'];
        $doc = json_decode((string) file_get_contents(__DIR__ . '/../fixtures/doc-listas.json'), true);
        $reemplazo = ['slug' => 'cap-1', 'titulo' => 'Otro título', 'orden' => 9, 'texOriginal' => '\\section{Nuevo}', 'docJson' => $doc];

        // Cada tipo de aporte por separado bloquea el reemplazo, en cualquier etapa.
        $aportes = [
            'copias_laboratorio' => "INSERT INTO copias_laboratorio (usuario_id, capitulo_id, version_base_id, doc_json) VALUES ($lab1, $cap, $ver, '{}')",
            'revisiones_copia' => "INSERT INTO revisiones_copia (usuario_id, capitulo_id, doc_json) VALUES ($lab1, $cap, '{}')",
            'sugerencias' => "INSERT INTO sugerencias (usuario_id, capitulo_id, version_base_id, uid, bloque_id, tipo, datos) VALUES ($lab1, $cap, $ver, 'u1:a', 'b1', 'contenido', '{}')",
            'comentarios' => "INSERT INTO comentarios (usuario_id, capitulo_id, bloque_id, rango, texto) VALUES ($lab1, $cap, 'b1', '{}', 'hola')",
        ];
        foreach (['preparacion' => null, 'consulta' => 'abrirConsulta', 'edicion_final' => 'cerrarConsulta'] as $etapa => $paso) {
            if ($paso !== null) {
                $this->$paso();
            }
            foreach ($aportes as $tabla => $sql) {
                self::$bd->exec($sql);
                $r = $c->post('/admin/capitulos', $reemplazo);
                self::assertSame(409, $r->estado, "$etapa/$tabla: " . $r->cuerpo());
                self::assertSame('operacion_no_permitida', $r->datos['error']['codigo']);
                self::assertSame('1 laboratorio ya trabajó en este capítulo; no se puede reemplazar el texto.', $r->datos['error']['mensaje'], $tabla);
                self::$bd->exec("DELETE FROM $tabla");
            }
        }

        // Varios laboratorios con aportes de distinto tipo: cada uno cuenta una vez.
        self::$bd->exec($aportes['copias_laboratorio']);
        self::$bd->exec($aportes['comentarios']);
        self::$bd->exec("INSERT INTO comentarios (usuario_id, capitulo_id, bloque_id, rango, texto) VALUES ($lab2, $cap, 'b1', '{}', 'chao')");
        $r = $c->post('/admin/capitulos', $reemplazo);
        self::assertSame(409, $r->estado);
        self::assertSame('2 laboratorios ya trabajaron en este capítulo; no se puede reemplazar el texto.', $r->datos['error']['mensaje']);
        self::$bd->exec('DELETE FROM copias_laboratorio');
        self::$bd->exec('DELETE FROM comentarios');

        // Solo una versión final (ningún laboratorio): también bloquea.
        self::$bd->exec("INSERT INTO versiones_capitulo (capitulo_id, tipo, doc_json, tex_final) VALUES ($cap, 'final', '{}', 'x')");
        $r = $c->post('/admin/capitulos', $reemplazo);
        self::assertSame(409, $r->estado);
        self::assertSame('operacion_no_permitida', $r->datos['error']['codigo']);
        self::assertStringContainsString('versión final', $r->datos['error']['mensaje']);
        self::assertStringContainsString('no se puede reemplazar el texto', $r->datos['error']['mensaje']);

        // Nada cambió: ni versiones base, ni título u orden, ni auditoría de subida.
        self::assertSame(1, (int) self::$bd->query("SELECT COUNT(*) FROM versiones_capitulo WHERE tipo = 'base'")->fetchColumn());
        self::assertSame(['orden' => 1, 'titulo' => 'Capítulo 1', 'slug' => 'cap-1'], $this->filaTipada($cap));
        self::assertCount(1, $this->auditoria('subir_capitulo'));
    }

    public function test_borrar_con_aportes_da_409(): void
    {
        [$c] = $this->admin();
        $s = $this->subir($c);
        $cap = $s['id'];
        $ver = $s['versionId'];
        $lab = $this->crearUsuario()['id'];
        $aportes = [
            'copias_laboratorio' => ["INSERT INTO copias_laboratorio (usuario_id, capitulo_id, version_base_id, doc_json) VALUES ($lab, $cap, $ver, '{}')", 'copias_laboratorio'],
            'revisiones_copia' => ["INSERT INTO revisiones_copia (usuario_id, capitulo_id, doc_json) VALUES ($lab, $cap, '{}')", 'revisiones_copia'],
            'sugerencias' => ["INSERT INTO sugerencias (usuario_id, capitulo_id, version_base_id, uid, bloque_id, tipo, datos) VALUES ($lab, $cap, $ver, 'u1:a', 'b1', 'contenido', '{}')", 'sugerencias'],
            'comentarios' => ["INSERT INTO comentarios (usuario_id, capitulo_id, bloque_id, rango, texto) VALUES ($lab, $cap, 'b1', '{}', 'hola')", 'comentarios'],
            'final' => ["INSERT INTO versiones_capitulo (capitulo_id, tipo, doc_json, tex_final) VALUES ($cap, 'final', '{}', 'x')", null],
        ];
        foreach ($aportes as $nombre => [$sql, $tabla]) {
            self::$bd->exec($sql);
            $r = $c->delete("/admin/capitulos/$cap");
            self::assertSame(409, $r->estado, "$nombre: " . $r->cuerpo());
            self::assertSame('operacion_no_permitida', $r->datos['error']['codigo']);
            self::assertStringContainsString('aportes', $r->datos['error']['mensaje']);
            self::assertIsArray($this->fila($cap), $nombre);
            self::$bd->exec($tabla === null ? "DELETE FROM versiones_capitulo WHERE tipo = 'final'" : "DELETE FROM $tabla");
        }
        self::assertSame(1, (int) self::$bd->query('SELECT COUNT(*) FROM versiones_capitulo')->fetchColumn());
        self::assertCount(0, $this->auditoria('borrar_capitulo'));

        // Sin aportes ya se puede borrar.
        self::assertSame(204, $c->delete("/admin/capitulos/$cap")->estado);
    }

    public function test_borrar_con_choque_de_fk_da_409_y_no_borra_nada(): void
    {
        [$c] = $this->admin();
        $cap = $this->subir($c)['id'];
        // Simula la red de seguridad de la FK (un aporte colado): la BD rechaza el DELETE con 23000.
        self::$bd->exec("CREATE TRIGGER tg_forzar_fk BEFORE DELETE ON capitulos FOR EACH ROW SIGNAL SQLSTATE '23000' SET MESSAGE_TEXT = 'Cannot delete or update a parent row'");
        try {
            $r = $c->delete("/admin/capitulos/$cap");
        } finally {
            self::$bd->exec('DROP TRIGGER IF EXISTS tg_forzar_fk');
        }
        self::assertSame(409, $r->estado, $r->cuerpo());
        self::assertSame('conflicto_concurrente', $r->datos['error']['codigo']);
        self::assertIsArray($this->fila($cap));
        self::assertSame(1, (int) self::$bd->query('SELECT COUNT(*) FROM versiones_capitulo')->fetchColumn());
        self::assertCount(0, $this->auditoria('borrar_capitulo'));
    }

    public function test_borrar_inexistente_da_404(): void
    {
        [$c] = $this->admin();
        $r = $c->delete('/admin/capitulos/999');
        self::assertSame(404, $r->estado);
        self::assertSame('no_encontrado', $r->datos['error']['codigo']);
        self::assertCount(0, $this->auditoria('borrar_capitulo'));
    }
}
