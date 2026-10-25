<?php

declare(strict_types=1);

namespace Manual\Pruebas\Api;

use Manual\Acceso\Capitulos;
use Manual\Aplicacion;
use Manual\Pruebas\Soporte\BaseDePruebas;
use Manual\Pruebas\Soporte\ClienteApi;
use Manual\Pruebas\Soporte\RelojFijo;
use PHPUnit\Framework\TestCase;

final class LaboratorioTest extends TestCase
{
    use BaseDePruebas;

    private RelojFijo $reloj;
    private Aplicacion $app;

    protected function setUp(): void
    {
        // Los ids se repiten entre tests (TRUNCATE): la caché de la base no debe sobrevivir.
        if (function_exists('apcu_clear_cache')) {
            apcu_clear_cache();
        }
        $this->reloj = new RelojFijo('2026-11-02 12:00:00');
        $this->app = $this->nuevaAplicacion($this->reloj);
    }

    // ---------------------------------------------------------------- soporte

    private function cliente(array $u): ClienteApi
    {
        return (new ClienteApi($this->app))->comoUsuario($u);
    }

    /** @return array{0:ClienteApi,1:array,2:string} cliente, usuario y clave de autor */
    private function lab(): array
    {
        $u = $this->crearUsuario(['roles' => ['laboratorio']]);
        return [$this->cliente($u), $u, 'u' . $u['id']];
    }

    private function admin(): ClienteApi
    {
        static $n = 0;
        $n++;
        return $this->cliente($this->crearUsuario(['roles' => ['admin'], 'correo' => "admin$n-" . uniqid() . '@lab.cl']));
    }

    private function doc(string $fixture = 'doc-listas'): array
    {
        return json_decode((string) file_get_contents(__DIR__ . "/../fixtures/$fixture.json"), true);
    }

    private function docModificado(string $texto): array
    {
        return ['type' => 'doc', 'content' => [
            ['type' => 'parrafo', 'attrs' => ['bid' => 'p1'], 'content' => [['type' => 'text', 'text' => $texto]]],
        ]];
    }

    /** Sube un capítulo (en preparación) y devuelve [capituloId, versionId]. */
    private function subirCapitulo(ClienteApi $admin, string $slug = 'cap-1', ?array $doc = null): array
    {
        $r = $admin->post('/admin/capitulos', [
            'slug' => $slug, 'titulo' => "Capítulo $slug", 'orden' => 1,
            'texOriginal' => '\\section{Hola}', 'docJson' => $doc ?? $this->doc(),
        ]);
        self::assertSame(201, $r->estado, $r->cuerpo());
        return [$r->datos['id'], $r->datos['versionId']];
    }

    private function abrirConsulta(ClienteApi $admin, bool $motivo = false): void
    {
        $r = $admin->put('/admin/consulta', [
            'apertura' => $this->reloj->ahora()->format('Y-m-d\TH:i:s\Z'),
            'cierre' => $this->reloj->ahora()->modify('+10 days')->format('Y-m-d\TH:i:s\Z'),
            'motivoObligatorio' => $motivo,
        ]);
        self::assertSame(200, $r->estado, $r->cuerpo());
    }

    /** Capítulo subido y consulta abierta. @return array{0:int,1:int,2:ClienteApi} */
    private function escenario(): array
    {
        $admin = $this->admin();
        [$cap, $ver] = $this->subirCapitulo($admin);
        $this->abrirConsulta($admin);
        return [$cap, $ver, $admin];
    }

    private function sug(string $autor, string $n, array $extra = []): array
    {
        return $extra + [
            'id' => "$autor:f1-p1:$n",
            'bloqueId' => 'f1-p1',
            'autor' => 'mentira',
            'base' => ['desde' => 0, 'hasta' => 4],
            'copia' => ['desde' => 0, 'hasta' => 5],
            'original' => [['type' => 'text', 'text' => 'hola']],
            'propuesta' => [['type' => 'text', 'text' => "hola $n"]],
            'tipo' => 'contenido',
        ];
    }

    private function guardar(ClienteApi $c, int $cap, int $ver, array $sugs, ?array $doc = null): \Manual\Http\Respuesta
    {
        return $c->put("/capitulos/$cap/copia", ['versionId' => $ver, 'docJson' => $doc ?? $this->docModificado('copia'), 'sugerencias' => $sugs]);
    }

    /** GET de la copia tal como la lee el cliente (JSON decodificado). */
    private function copia(ClienteApi $c, int $cap): array
    {
        $r = $c->get("/capitulos/$cap/copia");
        self::assertSame(200, $r->estado, $r->cuerpo());
        return json_decode($r->cuerpo(), true);
    }

    private function contar(string $tabla): int
    {
        return (int) self::$bd->query("SELECT COUNT(*) FROM $tabla")->fetchColumn();
    }

    // ---------------------------------------------------------------- base

    public function test_base_devuelve_etag_y_304(): void
    {
        [$cap, $ver] = $this->escenario();
        [$c] = $this->lab();

        $r = $c->get("/capitulos/$cap/base");
        self::assertSame(200, $r->estado, $r->cuerpo());
        self::assertSame("\"v$ver\"", $r->cabeceras['ETag']);
        self::assertSame('private, max-age=0, must-revalidate', $r->cabeceras['Cache-Control']);
        self::assertSame($ver, $r->datos['versionId']);
        // El documento vuelve igual a lo subido, con los objetos vacíos como objetos.
        $esperado = json_encode(json_decode((string) file_get_contents(__DIR__ . '/../fixtures/doc-listas.json')), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        self::assertStringContainsString('"docJson":' . $esperado, $r->cuerpo());

        foreach (["\"v$ver\"", "W/\"v$ver\"", "\"v999\", \"v$ver\""] as $etag) {
            $r = $c->enviar('GET', "/capitulos/$cap/base", null, ['if-none-match' => $etag]);
            self::assertSame(304, $r->estado, $etag);
            self::assertSame('', $r->cuerpo());
            self::assertSame("\"v$ver\"", $r->cabeceras['ETag']);
        }
        $r = $c->enviar('GET', "/capitulos/$cap/base", null, ['if-none-match' => '"v999"']);
        self::assertSame(200, $r->estado);

        // Inexistente: 404. Sin sesión: 401.
        self::assertSame(404, $c->get('/capitulos/999/base')->estado);
        self::assertSame(401, (new ClienteApi($this->app))->get("/capitulos/$cap/base")->estado);
    }

    public function test_base_se_cachea_en_apcu_y_sin_apcu_lee_la_base(): void
    {
        [$cap, $ver] = $this->escenario();
        [$c] = $this->lab();
        self::assertSame(200, $c->get("/capitulos/$cap/base")->estado);

        // Se altera la fila (nunca pasa en producción: la versión base es inmutable).
        self::$bd->prepare('UPDATE versiones_capitulo SET doc_json = ? WHERE id = ?')
            ->execute([json_encode($this->docModificado('alterado')), $ver]);

        // Sin caché, se lee la base.
        $sinCache = new Capitulos(self::$bd, false);
        self::assertStringContainsString('alterado', $sinCache->docBase($ver));

        if (function_exists('apcu_enabled') && apcu_enabled()) {
            self::assertNotFalse(apcu_fetch(Capitulos::prefijoInstalacion(self::configPruebas()) . ":base:$ver"));
            self::assertFalse(apcu_fetch("base:$ver"), 'la clave lleva el prefijo de la instalación');
            self::assertStringNotContainsString('alterado', $c->get("/capitulos/$cap/base")->cuerpo());
        } else {
            self::assertStringContainsString('alterado', $c->get("/capitulos/$cap/base")->cuerpo());
        }
    }

    // ---------------------------------------------------------------- listado

    public function test_listar_capitulos_con_mis_conteos(): void
    {
        [$cap, $ver] = $this->escenario();
        [$c, , $autor] = $this->lab();
        [$otro, , $autorOtro] = $this->lab();
        self::assertSame(200, $this->guardar($c, $cap, $ver, [$this->sug($autor, 'a'), $this->sug($autor, 'b')])->estado);
        self::assertSame(201, $c->post("/capitulos/$cap/comentarios", ['bloqueId' => 'f1-p1', 'rango' => ['desde' => 0, 'hasta' => 3], 'texto' => 'Ojo'])->estado);
        self::assertSame(200, $this->guardar($otro, $cap, $ver, [$this->sug($autorOtro, 'a')])->estado);

        $r = $c->get('/capitulos');
        self::assertSame(200, $r->estado);
        self::assertSame([['id' => $cap, 'orden' => 1, 'slug' => 'cap-1', 'titulo' => 'Capítulo cap-1', 'misCambios' => 2, 'misComentarios' => 1]], $r->datos);
        self::assertSame(1, $otro->get('/capitulos')->datos[0]['misCambios']);
        self::assertSame(0, $otro->get('/capitulos')->datos[0]['misComentarios']);
    }

    // ---------------------------------------------------------------- copia

    public function test_copia_inicial_es_null(): void
    {
        [$cap] = $this->escenario();
        [$c] = $this->lab();
        $r = $c->get("/capitulos/$cap/copia");
        self::assertSame(200, $r->estado);
        self::assertSame(['docJson' => null], $r->datos);

        self::assertSame(404, $c->get('/capitulos/999/copia')->estado);
        $revisor = $this->cliente($this->crearUsuario(['roles' => ['revisor']]));
        self::assertSame(403, $revisor->get("/capitulos/$cap/copia")->estado);
    }

    public function test_guardar_y_leer_copia_con_sugerencias(): void
    {
        [$cap, $ver] = $this->escenario();
        [$c, $u, $autor] = $this->lab();

        $s1 = $this->sug($autor, 'a', ['motivo' => 'Errata', 'usuario_id' => 999, 'estado' => 'aceptada']);
        $s2 = $this->sug($autor, 'b', ['grupo' => 'g1', 'orden' => 2]);
        $r = $c->put("/capitulos/$cap/copia", ['versionId' => $ver, 'docJson' => $this->docModificado('mi copia'), 'sugerencias' => [$s1, $s2], 'usuario_id' => 999]);
        self::assertSame(200, $r->estado, $r->cuerpo());
        self::assertSame(['actualizado' => '2026-11-02T12:00:00Z'], $r->datos);

        $r = $c->get("/capitulos/$cap/copia");
        $d = json_decode($r->cuerpo(), true);
        self::assertSame(200, $r->estado);
        self::assertSame($this->docModificado('mi copia'), $d['docJson']);
        self::assertSame('2026-11-02T12:00:00Z', $d['actualizado']);
        self::assertSame($ver, $d['versionId']);
        $sugs = $d['sugerencias'];
        self::assertCount(2, $sugs);
        self::assertSame("$autor:f1-p1:a", $sugs[0]['id']);
        self::assertSame($autor, $sugs[0]['autor'], 'el autor lo pone el servidor');
        self::assertSame('Errata', $sugs[0]['motivo']);
        self::assertSame('pendiente', $sugs[0]['estado'], 'el estado del cuerpo se ignora');
        self::assertSame([['type' => 'text', 'text' => 'hola a']], $sugs[0]['propuesta']);
        self::assertSame(['desde' => 0, 'hasta' => 5], $sugs[0]['copia']);
        self::assertSame('g1', $sugs[1]['grupo']);
        self::assertSame(2, $sugs[1]['orden']);
        self::assertArrayNotHasKey('motivo', $sugs[1]);

        // En la base: todo a nombre del usuario de la sesión.
        $filas = self::$bd->query('SELECT usuario_id, estado FROM sugerencias')->fetchAll();
        self::assertSame([$u['id'], $u['id']], array_map('intval', array_column($filas, 'usuario_id')));
        self::assertSame(1, $this->contar('copias_laboratorio'));

        // Otro laboratorio no ve nada de esto.
        [$otro] = $this->lab();
        self::assertSame(['docJson' => null], $this->copia($otro, $cap));
    }

    public function test_id_de_sugerencia_debe_llevar_mi_clave_de_autor(): void
    {
        [$cap, $ver] = $this->escenario();
        [$c, $u, $autor] = $this->lab();
        $otraClave = 'u' . ($u['id'] + 1);

        foreach (["$otraClave:f1-p1:a", 'f1-p1:a', "{$autor}f1-p1:a", "x$autor:f1-p1:a", "$autor:f1.p1:a", "$autor:f1-p1:a b", "$autor:"] as $id) {
            $r = $this->guardar($c, $cap, $ver, [$this->sug($autor, 'ok'), $this->sug($autor, 'z', ['id' => $id])]);
            self::assertSame(400, $r->estado, $id);
            self::assertSame('entrada_invalida', $r->datos['error']['codigo']);
            self::assertArrayHasKey('sugerencias[1].id', $r->datos['error']['campos']);
        }
        self::assertSame(0, $this->contar('copias_laboratorio'));
    }

    public function test_uid_duplicado_y_limite_de_sugerencias_dan_400(): void
    {
        [$cap, $ver] = $this->escenario();
        [$c, , $autor] = $this->lab();

        $r = $this->guardar($c, $cap, $ver, [$this->sug($autor, 'a'), $this->sug($autor, 'a')]);
        self::assertSame(400, $r->estado);
        self::assertArrayHasKey('sugerencias[1].id', $r->datos['error']['campos']);

        $muchas = [];
        for ($i = 0; $i <= 2000; $i++) {
            $muchas[] = $this->sug($autor, (string) $i);
        }
        $r = $this->guardar($c, $cap, $ver, $muchas);
        self::assertSame(400, $r->estado);
        self::assertArrayHasKey('sugerencias', $r->datos['error']['campos']);

        array_pop($muchas);
        $r = $this->guardar($c, $cap, $ver, $muchas);
        self::assertSame(200, $r->estado, $r->cuerpo());
        self::assertSame(2000, $this->contar('sugerencias'));

        foreach ([['sugerencias' => 'x'], ['sugerencias' => ['a' => 1]], ['docJson' => 'x'], ['versionId' => '1']] as $malo) {
            $cuerpo = $malo + ['versionId' => $ver, 'docJson' => $this->docModificado('x'), 'sugerencias' => []];
            self::assertSame(400, $c->put("/capitulos/$cap/copia", $cuerpo)->estado, json_encode($malo));
        }
    }

    public function test_documentos_invalidos_no_se_guardan(): void
    {
        [$cap, $ver] = $this->escenario();
        [$c, , $autor] = $this->lab();

        $html = ['type' => 'doc', 'content' => [['type' => 'html', 'text' => '<script>']]];
        self::assertSame(422, $this->guardar($c, $cap, $ver, [], $html)->estado);

        $sugMala = $this->sug($autor, 'a', ['propuesta' => [['type' => 'text', 'text' => 'x', 'onclick' => 'y']]]);
        self::assertSame(422, $this->guardar($c, $cap, $ver, [$sugMala])->estado);

        // Profundidad enorme: la decodificación la corta antes (400, no 422 ni 500).
        $profundo = '{"type":"text","text":"x"}';
        for ($i = 0; $i < 10000; $i++) {
            $profundo = '{"type":"parrafo","content":[' . $profundo . ']}';
        }
        $cuerpo = '{"versionId":' . $ver . ',"sugerencias":[],"docJson":{"type":"doc","content":[' . $profundo . ']}}';
        $r = $this->app->manejar(new \Manual\Http\Peticion('PUT', "/api/capitulos/$cap/copia", [
            'content-type' => 'application/json', 'cookie' => "{$c->nombreCookie}={$c->cookie}", 'x-csrf-token' => $c->csrf,
        ], $cuerpo, '127.0.0.1'));
        self::assertSame(400, $r->estado);
        self::assertSame(0, $this->contar('copias_laboratorio'));
    }

    public function test_re_guardar_conserva_motivo_por_uid(): void
    {
        [$cap, $ver] = $this->escenario();
        [$c, , $autor] = $this->lab();
        self::assertSame(200, $this->guardar($c, $cap, $ver, [$this->sug($autor, 'a', ['motivo' => 'Original']), $this->sug($autor, 'b')])->estado);
        self::assertSame(200, $c->patch("/capitulos/$cap/sugerencias/" . "$autor:f1-p1:b", ['motivo' => 'Por PATCH'])->estado);
        self::$bd->exec("UPDATE sugerencias SET estado = 'aceptada' WHERE uid LIKE '%:a'");

        $this->reloj->avanzar(60);
        $nueva = $this->sug($autor, 'a', ['propuesta' => [['type' => 'text', 'text' => 'cambiada']], 'motivo' => 'Otro']);
        self::assertSame(200, $this->guardar($c, $cap, $ver, [$nueva, $this->sug($autor, 'b')])->estado);

        $sugs = $this->copia($c, $cap)['sugerencias'];
        self::assertSame('Original', $sugs[0]['motivo']);
        self::assertSame('aceptada', $sugs[0]['estado']);
        self::assertSame([['type' => 'text', 'text' => 'cambiada']], $sugs[0]['propuesta'], 'los datos sí se actualizan');
        self::assertSame('Por PATCH', $sugs[1]['motivo']);
    }

    public function test_re_guardar_elimina_sugerencias_que_ya_no_vienen(): void
    {
        [$cap, $ver] = $this->escenario();
        [$c, , $autor] = $this->lab();
        [$otro, , $autorOtro] = $this->lab();
        self::assertSame(200, $this->guardar($otro, $cap, $ver, [$this->sug($autorOtro, 'a')])->estado);
        self::assertSame(200, $this->guardar($c, $cap, $ver, [$this->sug($autor, 'a'), $this->sug($autor, 'b'), $this->sug($autor, 'c')])->estado);

        self::assertSame(200, $this->guardar($c, $cap, $ver, [$this->sug($autor, 'b'), $this->sug($autor, 'd')])->estado);
        $ids = array_column($this->copia($c, $cap)['sugerencias'], 'id');
        self::assertSame(["$autor:f1-p1:b", "$autor:f1-p1:d"], $ids);
        self::assertCount(1, $this->copia($otro, $cap)['sugerencias'], 'las del otro laboratorio siguen');

        self::assertSame(200, $this->guardar($c, $cap, $ver, [])->estado);
        self::assertSame([], $this->copia($c, $cap)['sugerencias']);
        self::assertSame(1, $this->contar('sugerencias'));
    }

    public function test_version_obsoleta_da_409(): void
    {
        $admin = $this->admin();
        [$cap, $v1] = $this->subirCapitulo($admin);
        [, $v2] = $this->subirCapitulo($admin, 'cap-1', $this->docModificado('segunda'));
        $this->abrirConsulta($admin);
        [$c, , $autor] = $this->lab();

        $r = $this->guardar($c, $cap, $v1, [$this->sug($autor, 'a')]);
        self::assertSame(409, $r->estado);
        self::assertSame('version_obsoleta', $r->datos['error']['codigo']);
        self::assertSame(409, $this->guardar($c, $cap, 99999, [])->estado);
        self::assertSame(0, $this->contar('copias_laboratorio'));
        self::assertSame(0, $this->contar('sugerencias'));

        self::assertSame($v2, $c->get("/capitulos/$cap/base")->datos['versionId']);
        self::assertSame(200, $this->guardar($c, $cap, $v2, [$this->sug($autor, 'a')])->estado);
    }

    public function test_guardado_de_copia_es_atomico(): void
    {
        [$cap, $ver] = $this->escenario();
        [$c, , $autor] = $this->lab();
        self::assertSame(200, $this->guardar($c, $cap, $ver, [$this->sug($autor, 'a', ['motivo' => 'm']), $this->sug($autor, 'b')], $this->docModificado('v1'))->estado);
        $antes = $c->get("/capitulos/$cap/copia")->cuerpo();

        // Una sugerencia inválida en medio: nada cambia.
        $this->reloj->avanzar(60);
        $mala = $this->sug($autor, 'x');
        unset($mala['bloqueId']);
        $r = $this->guardar($c, $cap, $ver, [$this->sug($autor, 'c'), $mala, $this->sug($autor, 'd')], $this->docModificado('v2'));
        self::assertSame(400, $r->estado);
        self::assertArrayHasKey('sugerencias[1].bloqueId', $r->datos['error']['campos']);
        self::assertSame($antes, $c->get("/capitulos/$cap/copia")->cuerpo());

        // Un fallo de la base en medio de la transacción: rollback completo.
        // El 500 deja una línea en error_log: se redirige a un archivo para no ensuciar la salida.
        $log = tempnam(sys_get_temp_dir(), 'log');
        $logAnterior = ini_set('error_log', $log);
        self::$bd->exec("CREATE TRIGGER t_boom BEFORE INSERT ON sugerencias FOR EACH ROW BEGIN IF NEW.uid LIKE '%:boom' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'boom'; END IF; END");
        try {
            $r = $this->guardar($c, $cap, $ver, [$this->sug($autor, 'c'), $this->sug($autor, 'boom')], $this->docModificado('v3'));
            self::assertSame(500, $r->estado);
        } finally {
            self::$bd->exec('DROP TRIGGER IF EXISTS t_boom');
            ini_set('error_log', (string) $logAnterior);
        }
        self::assertStringContainsString('boom', (string) file_get_contents($log));
        unlink($log);
        self::assertSame($antes, $c->get("/capitulos/$cap/copia")->cuerpo());
        self::assertSame(1, $this->contar('revisiones_copia'));
    }

    public function test_instantanea_cada_10_minutos(): void
    {
        [$cap, $ver] = $this->escenario();
        [$c] = $this->lab();
        $revisiones = fn () => self::$bd->query('SELECT doc_json, creado FROM revisiones_copia ORDER BY id')->fetchAll();

        self::assertSame(200, $this->guardar($c, $cap, $ver, [], $this->docModificado('t0'))->estado);
        self::assertCount(1, $revisiones());

        $this->reloj->avanzar(5 * 60);
        self::assertSame(200, $this->guardar($c, $cap, $ver, [], $this->docModificado('t5'))->estado);
        self::assertCount(1, $revisiones());

        $this->reloj->avanzar(5 * 60); // justo 10 min: todavía no
        self::assertSame(200, $this->guardar($c, $cap, $ver, [], $this->docModificado('t10'))->estado);
        self::assertCount(1, $revisiones());

        $this->reloj->avanzar(60);
        self::assertSame(200, $this->guardar($c, $cap, $ver, [], $this->docModificado('t11'))->estado);
        $r = $revisiones();
        self::assertCount(2, $r);
        self::assertStringContainsString('t0', $r[0]['doc_json']);
        self::assertStringContainsString('t11', $r[1]['doc_json']);
        self::assertSame('2026-11-02 12:11:00', $r[1]['creado']);
        self::assertSame('2026-11-02T12:11:00Z', $this->copia($c, $cap)['actualizado']);

        // Las de otro laboratorio no cuentan para el mío.
        [$otro] = $this->lab();
        self::assertSame(200, $this->guardar($otro, $cap, $ver, [])->estado);
        self::assertCount(3, $revisiones());
    }

    public function test_uids_que_solo_difieren_en_mayusculas_coexisten(): void
    {
        [$cap, $ver] = $this->escenario();
        [$c, , $autor] = $this->lab();
        $r = $this->guardar($c, $cap, $ver, [$this->sug($autor, 'a'), $this->sug($autor, 'A'), $this->sug($autor, 'x', ['bloqueId' => 'F1-P1'])]);
        self::assertSame(200, $r->estado, $r->cuerpo());
        self::assertSame(3, $this->contar('sugerencias'));

        self::assertSame(200, $c->patch("/capitulos/$cap/sugerencias/$autor:f1-p1:A", ['motivo' => 'mayúscula'])->estado);
        $sugs = $this->copia($c, $cap)['sugerencias'];
        self::assertSame(["$autor:f1-p1:a", "$autor:f1-p1:A", "$autor:f1-p1:x"], array_column($sugs, 'id'));
        self::assertArrayNotHasKey('motivo', $sugs[0]);
        self::assertSame('mayúscula', $sugs[1]['motivo']);
        self::assertSame('F1-P1', $sugs[2]['bloqueId']);

        // Re-guardar solo la minúscula borra exactamente la mayúscula.
        self::assertSame(200, $this->guardar($c, $cap, $ver, [$this->sug($autor, 'a')])->estado);
        self::assertSame(["$autor:f1-p1:a"], array_column($this->copia($c, $cap)['sugerencias'], 'id'));

        // Comentarios: bloqueId conserva mayúsculas.
        self::assertSame(201, $c->post("/capitulos/$cap/comentarios", ['bloqueId' => 'B1', 'rango' => ['desde' => 0, 'hasta' => 1], 'texto' => 'x'])->estado);
        self::assertSame(1, (int) self::$bd->query("SELECT COUNT(*) FROM comentarios WHERE bloque_id = 'B1'")->fetchColumn());
        self::assertSame(0, (int) self::$bd->query("SELECT COUNT(*) FROM comentarios WHERE bloque_id = 'b1'")->fetchColumn());
    }

    public function test_uid_codificado_en_la_ruta_funciona(): void
    {
        [$cap, $ver] = $this->escenario();
        [$c, , $autor] = $this->lab();
        self::assertSame(200, $this->guardar($c, $cap, $ver, [$this->sug($autor, '+0')])->estado);

        // Como lo codifica encodeURIComponent: ':' → %3A, '+' → %2B.
        $codificado = rawurlencode("$autor:f1-p1:+0");
        self::assertStringContainsString('%3A', $codificado);
        $r = $c->patch("/capitulos/$cap/sugerencias/$codificado", ['motivo' => 'codificado']);
        self::assertSame(200, $r->estado, $r->cuerpo());
        self::assertSame("$autor:f1-p1:+0", $r->datos['id']);
        self::assertSame('codificado', $this->copia($c, $cap)['sugerencias'][0]['motivo']);
        self::assertSame(404, $c->patch("/capitulos/$cap/sugerencias/$autor%3Af1-p1%3A%200", ['motivo' => 'x'])->estado);
    }

    // ---------------------------------------------------------------- comentarios

    public function test_crear_editar_borrar_comentario_propio(): void
    {
        [$cap] = $this->escenario();
        [$c, $u] = $this->lab();
        [$otro] = $this->lab();

        $r = $c->post("/capitulos/$cap/comentarios", ['bloqueId' => 'f1-p1', 'rango' => ['desde' => 2, 'hasta' => 7], 'texto' => 'Revisar unidades', 'usuario_id' => 999, 'estado' => 'resuelto']);
        self::assertSame(201, $r->estado, $r->cuerpo());
        $id = $r->datos['id'];
        self::assertIsInt($id);
        self::assertSame($u['id'], (int) self::$bd->query("SELECT usuario_id FROM comentarios WHERE id = $id")->fetchColumn());

        $lista = $c->get("/capitulos/$cap/comentarios");
        self::assertSame(200, $lista->estado);
        self::assertSame([['id' => $id, 'bloqueId' => 'f1-p1', 'rango' => ['desde' => 2, 'hasta' => 7], 'texto' => 'Revisar unidades', 'estado' => 'abierto', 'creado' => '2026-11-02T12:00:00Z']], $lista->datos);

        // Ajeno: 404 y sin cambios.
        self::assertSame([], $otro->get("/capitulos/$cap/comentarios")->datos);
        self::assertSame(404, $otro->patch("/comentarios/$id", ['texto' => 'hackeado'])->estado);
        self::assertSame(404, $otro->delete("/comentarios/$id")->estado);
        self::assertSame(404, $c->patch('/comentarios/99999', ['texto' => 'x'])->estado);

        self::assertSame(200, $c->patch("/comentarios/$id", ['texto' => 'Revisar unidades (mg/L)', 'estado' => 'resuelto'])->estado);
        $fila = $c->get("/capitulos/$cap/comentarios")->datos[0];
        self::assertSame('Revisar unidades (mg/L)', $fila['texto']);
        self::assertSame('abierto', $fila['estado']);

        self::assertSame(204, $c->delete("/comentarios/$id")->estado);
        self::assertSame([], $c->get("/capitulos/$cap/comentarios")->datos);
        self::assertSame(404, $c->delete("/comentarios/$id")->estado);
    }

    public function test_comentario_valida_texto_y_rango(): void
    {
        [$cap] = $this->escenario();
        [$c] = $this->lab();
        $bueno = ['bloqueId' => 'f1-p1', 'rango' => ['desde' => 0, 'hasta' => 1], 'texto' => 'ok'];
        $casos = [
            'texto' => [['texto' => ''], ['texto' => str_repeat('a', 4001)], ['texto' => 5]],
            'rango' => [['rango' => ['desde' => 3, 'hasta' => 1]], ['rango' => ['desde' => -1, 'hasta' => 1]], ['rango' => ['desde' => 0, 'hasta' => 10_000_001]], ['rango' => [0, 1]], ['rango' => 'x'], ['rango' => ['desde' => 0]]],
            'bloqueId' => [['bloqueId' => ''], ['bloqueId' => str_repeat('b', 191)]],
        ];
        foreach ($casos as $campo => $lista) {
            foreach ($lista as $malo) {
                $r = $c->post("/capitulos/$cap/comentarios", $malo + $bueno);
                self::assertSame(400, $r->estado, json_encode($malo));
                self::assertArrayHasKey($campo, $r->datos['error']['campos']);
            }
        }
        self::assertSame(201, $c->post("/capitulos/$cap/comentarios", ['texto' => str_repeat('ñ', 4000)] + $bueno)->estado);
        self::assertSame(404, $c->post('/capitulos/999/comentarios', $bueno)->estado);
        $id = $c->get("/capitulos/$cap/comentarios")->datos[0]['id'];
        self::assertSame(400, $c->patch("/comentarios/$id", ['texto' => ''])->estado);
    }

    // ---------------------------------------------------------------- motivo y etapa

    public function test_motivo_obligatorio_se_exige_si_la_consulta_lo_pide(): void
    {
        [$cap, $ver, $admin] = $this->escenario();
        $this->abrirConsulta($admin, true); // mismas fechas: solo cambia el motivo
        [$c, , $autor] = $this->lab();
        [$otro] = $this->lab();

        self::assertTrue($c->get('/consulta')->datos['motivoObligatorio']);

        self::assertSame(200, $this->guardar($c, $cap, $ver, [$this->sug($autor, 'a')])->estado);
        $uid = "$autor:f1-p1:a";
        $r = $c->patch("/capitulos/$cap/sugerencias/$uid", ['motivo' => 'Corrige la unidad']);
        self::assertSame(200, $r->estado, $r->cuerpo());
        self::assertSame('Corrige la unidad', $this->copia($c, $cap)['sugerencias'][0]['motivo']);

        self::assertSame(400, $c->patch("/capitulos/$cap/sugerencias/$uid", ['motivo' => str_repeat('a', 2001)])->estado);
        self::assertSame(400, $c->patch("/capitulos/$cap/sugerencias/$uid", ['motivo' => 3])->estado);
        self::assertSame(404, $c->patch("/capitulos/$cap/sugerencias/" . "$autor:f1-p1:zz", ['motivo' => 'x'])->estado);
        self::assertSame(404, $otro->patch("/capitulos/$cap/sugerencias/$uid", ['motivo' => 'ajeno'])->estado);
        self::assertSame(404, $c->patch("/capitulos/999/sugerencias/$uid", ['motivo' => 'x'])->estado);
        self::assertSame('Corrige la unidad', $this->copia($c, $cap)['sugerencias'][0]['motivo']);
    }

    public function test_escrituras_fuera_de_la_consulta_dan_409(): void
    {
        $admin = $this->admin();
        [$cap, $ver] = $this->subirCapitulo($admin);
        [$c, $u, $autor] = $this->lab();

        // Preparación: se puede leer la base, no escribir.
        self::assertSame(200, $c->get("/capitulos/$cap/base")->estado);
        $r = $this->guardar($c, $cap, $ver, [$this->sug($autor, 'a')]);
        self::assertSame(409, $r->estado);
        self::assertSame('etapa_no_permite', $r->datos['error']['codigo']);
        self::assertSame(409, $c->post("/capitulos/$cap/comentarios", ['bloqueId' => 'b', 'rango' => ['desde' => 0, 'hasta' => 1], 'texto' => 'x'])->estado);

        // Consulta abierta y luego cerrada.
        $this->abrirConsulta($admin);
        self::assertSame(200, $this->guardar($c, $cap, $ver, [$this->sug($autor, 'a')])->estado);
        $id = $c->post("/capitulos/$cap/comentarios", ['bloqueId' => 'b', 'rango' => ['desde' => 0, 'hasta' => 1], 'texto' => 'x'])->datos['id'];
        $this->reloj->avanzar(11 * 86400);
        $c = $this->cliente($u); // la sesión venció por inactividad

        self::assertSame(409, $this->guardar($c, $cap, $ver, [])->estado);
        self::assertSame(409, $c->patch("/capitulos/$cap/sugerencias/" . "$autor:f1-p1:a", ['motivo' => 'x'])->estado);
        self::assertSame(409, $c->patch("/comentarios/$id", ['texto' => 'y'])->estado);
        self::assertSame(409, $c->delete("/comentarios/$id")->estado);
        self::assertSame(1, $this->contar('sugerencias'));
        self::assertSame(1, $this->contar('comentarios'));
        // Las lecturas siguen disponibles.
        self::assertSame(200, $c->get("/capitulos/$cap/copia")->estado);
        self::assertSame(200, $c->get("/capitulos/$cap/comentarios")->estado);
    }
}
