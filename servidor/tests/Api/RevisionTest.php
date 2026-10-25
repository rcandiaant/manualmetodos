<?php

declare(strict_types=1);

namespace Manual\Pruebas\Api;

use Manual\Pruebas\Soporte\BaseDePruebas;
use Manual\Pruebas\Soporte\EscenarioRevision;
use PHPUnit\Framework\TestCase;

final class RevisionTest extends TestCase
{
    use BaseDePruebas;
    use EscenarioRevision;

    protected function setUp(): void
    {
        $this->montar();
    }

    /** @return list<array<string,mixed>> */
    private function auditoria(string $accion): array
    {
        $st = self::$bd->prepare('SELECT * FROM auditoria WHERE accion = ? ORDER BY id');
        $st->execute([$accion]);
        return $st->fetchAll();
    }

    private function fila(string $tabla, int $id): array
    {
        return self::$bd->query("SELECT * FROM $tabla WHERE id = $id")->fetch();
    }

    // ---------------------------------------------------------------- aportes

    public function test_revisor_ve_aportes_de_todos_con_laboratorio(): void
    {
        foreach (['consulta', 'edicion_final'] as $etapa) {
            if ($etapa === 'edicion_final') {
                $this->cerrarConsulta();
            }
            $r = $this->revisor->get("/capitulos/{$this->cap}/aportes");
            self::assertSame(200, $r->estado, $etapa . $r->cuerpo());
            $d = json_decode($r->cuerpo(), true);
            self::assertCount(2, $d['sugerencias']);
            self::assertCount(2, $d['comentarios']);

            $s = $d['sugerencias'];
            self::assertSame($this->labU['id'], $s[0]['usuarioId']);
            self::assertSame('Laboratorio Norte', $s[0]['laboratorio']);
            self::assertSame($this->sugIds[0], $s[0]['sugerenciaId']);
            self::assertSame('u' . $this->labU['id'] . ':f1-p1:a', $s[0]['id']);
            self::assertSame('pendiente', $s[0]['estado']);
            self::assertFalse($s[0]['derivadaReunion']);
            self::assertNull($s[0]['notaResolucion']);
            self::assertSame('Laboratorio Sur', $s[1]['laboratorio']);
            self::assertSame($this->lab2U['id'], $s[1]['usuarioId']);

            $c = $d['comentarios'];
            self::assertSame($this->comIds[0], $c[0]['id']);
            self::assertSame('Laboratorio Norte', $c[0]['laboratorio']);
            self::assertSame($this->labU['id'], $c[0]['usuarioId']);
            self::assertSame('Comentario a', $c[0]['texto']);
            self::assertSame('Laboratorio Sur', $c[1]['laboratorio']);
        }
    }

    public function test_aportes_exige_revisor_etapa_y_capitulo(): void
    {
        self::assertSame(403, $this->lab->get("/capitulos/{$this->cap}/aportes")->estado);
        self::assertSame(403, $this->admin->get("/capitulos/{$this->cap}/aportes")->estado);
        self::assertSame(404, $this->revisor->get('/capitulos/9999/aportes')->estado);
        // Antes de la apertura no hay aportes que ver.
        self::$bd->exec("UPDATE consulta SET apertura = '2026-12-01 00:00:00', cierre = '2026-12-20 00:00:00'");
        $r = $this->revisor->get("/capitulos/{$this->cap}/aportes");
        self::assertSame(409, $r->estado);
        self::assertSame('etapa_no_permite', $r->datos['error']['codigo']);
    }

    public function test_listado_de_capitulos_da_totales_al_revisor_y_no_al_laboratorio(): void
    {
        $d = json_decode($this->revisor->get('/capitulos')->cuerpo(), true);
        self::assertSame(2, $d[0]['totalSugerencias']);
        self::assertSame(2, $d[0]['totalComentarios']);
        self::assertSame(4, $d[0]['pendientes']);
        // El revisor no es laboratorio: sus conteos propios son 0.
        self::assertSame(0, $d[0]['misCambios']);

        $this->cerrarConsulta();
        $this->revisor->patch("/sugerencias/{$this->sugIds[0]}", ['estado' => 'aceptada']);
        $this->revisor->patch("/comentarios/{$this->comIds[1]}/resolucion", ['estado' => 'resuelto']);
        $d = json_decode($this->revisor->get('/capitulos')->cuerpo(), true);
        self::assertSame(2, $d[0]['pendientes']);

        $d = json_decode($this->lab->get('/capitulos')->cuerpo(), true);
        self::assertArrayNotHasKey('totalSugerencias', $d[0]);
        self::assertArrayNotHasKey('totalComentarios', $d[0]);
        self::assertArrayNotHasKey('pendientes', $d[0]);
        self::assertSame(1, $d[0]['misCambios']);
    }

    // ---------------------------------------------------------------- resolver sugerencias

    public function test_resolver_sugerencia_registra_quien_y_cuando(): void
    {
        $this->cerrarConsulta();
        $revisorId = (int) self::$bd->query("SELECT id FROM usuarios WHERE laboratorio = 'Comité revisor'")->fetchColumn();
        $id = $this->sugIds[0];

        $r = $this->revisor->patch("/sugerencias/$id", ['estado' => 'aceptada', 'notaResolucion' => 'Buen aporte', 'derivadaReunion' => true]);
        self::assertSame(200, $r->estado, $r->cuerpo());
        $f = $this->fila('sugerencias', $id);
        self::assertSame('aceptada', $f['estado']);
        self::assertSame('Buen aporte', $f['nota_resolucion']);
        self::assertSame('1', (string) $f['derivada_reunion']);
        self::assertSame($revisorId, (int) $f['resuelto_por']);
        self::assertSame('2026-11-02 12:00:00', $f['resuelto_en']);
        // La otra sugerencia no cambia.
        self::assertSame('pendiente', $this->fila('sugerencias', $this->sugIds[1])['estado']);

        $this->reloj->avanzar(3600);
        $r = $this->revisor->patch("/sugerencias/$id", ['estado' => 'modificada']);
        self::assertSame(200, $r->estado, $r->cuerpo());
        $f = $this->fila('sugerencias', $id);
        self::assertSame('modificada', $f['estado']);
        self::assertNull($f['nota_resolucion']);
        self::assertSame('0', (string) $f['derivada_reunion']);
        self::assertSame('2026-11-02 13:00:00', $f['resuelto_en']);

        $aud = $this->auditoria('resolver_sugerencia');
        self::assertCount(2, $aud);
        self::assertSame((string) $revisorId, (string) $aud[0]['usuario_id']);
        self::assertSame((string) $id, $aud[0]['entidad_id']);
        self::assertSame('sugerencia', $aud[0]['entidad']);
        $d0 = json_decode($aud[0]['detalle'], true);
        self::assertSame('pendiente', $d0['anterior']);
        self::assertSame('aceptada', $d0['nuevo']);
        self::assertTrue($d0['derivadaReunion']);
        $d1 = json_decode($aud[1]['detalle'], true);
        self::assertSame('aceptada', $d1['anterior']);
        self::assertSame('modificada', $d1['nuevo']);
        self::assertTrue($d1['derivadaAnterior']);

        // Reabrir limpia quién y cuándo.
        self::assertSame(200, $this->revisor->patch("/sugerencias/$id", ['estado' => 'pendiente'])->estado);
        $f = $this->fila('sugerencias', $id);
        self::assertNull($f['resuelto_por']);
        self::assertNull($f['resuelto_en']);
    }

    public function test_resolver_en_consulta_da_409(): void
    {
        $antes = $this->fila('sugerencias', $this->sugIds[0]);
        $r = $this->revisor->patch("/sugerencias/{$this->sugIds[0]}", ['estado' => 'aceptada']);
        self::assertSame(409, $r->estado);
        self::assertSame('etapa_no_permite', $r->datos['error']['codigo']);
        self::assertSame($antes, $this->fila('sugerencias', $this->sugIds[0]));
        $r = $this->revisor->patch("/comentarios/{$this->comIds[0]}/resolucion", ['estado' => 'resuelto']);
        self::assertSame(409, $r->estado);
        self::assertSame([], $this->auditoria('resolver_sugerencia'));
        self::assertSame([], $this->auditoria('resolver_comentario'));
    }

    public function test_estado_invalido_da_400(): void
    {
        $this->cerrarConsulta();
        $id = $this->sugIds[0];
        $antes = $this->fila('sugerencias', $id);
        $casos = [
            ['campo' => 'estado', 'cuerpo' => ['estado' => 'aprobada']],
            ['campo' => 'estado', 'cuerpo' => []],
            ['campo' => 'estado', 'cuerpo' => ['estado' => 'abierto']],
            ['campo' => 'estado', 'cuerpo' => ['estado' => 3]],
            ['campo' => 'notaResolucion', 'cuerpo' => ['estado' => 'aceptada', 'notaResolucion' => str_repeat('a', 2001)]],
            ['campo' => 'notaResolucion', 'cuerpo' => ['estado' => 'aceptada', 'notaResolucion' => 5]],
            ['campo' => 'derivadaReunion', 'cuerpo' => ['estado' => 'aceptada', 'derivadaReunion' => 'si']],
        ];
        foreach ($casos as $caso) {
            $r = $this->revisor->patch("/sugerencias/$id", $caso['cuerpo']);
            self::assertSame(400, $r->estado, json_encode($caso));
            self::assertSame('entrada_invalida', $r->datos['error']['codigo']);
            self::assertArrayHasKey($caso['campo'], $r->datos['error']['campos']);
        }
        self::assertSame($antes, $this->fila('sugerencias', $id));
        // 2000 caracteres es el máximo.
        $r = $this->revisor->patch("/sugerencias/$id", ['estado' => 'rechazada', 'notaResolucion' => str_repeat('é', 2000)]);
        self::assertSame(200, $r->estado, $r->cuerpo());

        // Un comentario no acepta los estados de sugerencia.
        foreach (['aceptada', 'pendiente', 'cerrado'] as $estado) {
            $r = $this->revisor->patch("/comentarios/{$this->comIds[0]}/resolucion", ['estado' => $estado]);
            self::assertSame(400, $r->estado, $estado);
            self::assertArrayHasKey('estado', $r->datos['error']['campos']);
        }
    }

    public function test_resolver_inexistente_da_404_y_ids_no_numericos_tambien(): void
    {
        $this->cerrarConsulta();
        self::assertSame(404, $this->revisor->patch('/sugerencias/99999', ['estado' => 'aceptada'])->estado);
        self::assertSame(404, $this->revisor->patch('/comentarios/99999/resolucion', ['estado' => 'resuelto'])->estado);
        self::assertSame(404, $this->revisor->patch('/sugerencias/abc', ['estado' => 'aceptada'])->estado);
    }

    public function test_resolver_ignora_campos_ajenos_del_cuerpo(): void
    {
        $this->cerrarConsulta();
        $id = $this->sugIds[0];
        $r = $this->revisor->patch("/sugerencias/$id", ['estado' => 'aceptada', 'usuario_id' => 999, 'resuelto_por' => 999, 'motivo' => 'x', 'datos' => '{}']);
        self::assertSame(200, $r->estado, $r->cuerpo());
        $f = $this->fila('sugerencias', $id);
        self::assertSame((string) $this->labU['id'], (string) $f['usuario_id']);
        self::assertNotSame('999', (string) $f['resuelto_por']);
        self::assertNull($f['motivo']);
    }

    public function test_laboratorio_no_puede_resolver(): void
    {
        $this->cerrarConsulta();
        $antes = $this->fila('sugerencias', $this->sugIds[0]);
        // Ni su propia sugerencia ni la ajena.
        foreach ($this->sugIds as $id) {
            $r = $this->lab->patch("/sugerencias/$id", ['estado' => 'aceptada']);
            self::assertSame(403, $r->estado);
            self::assertSame('sin_permiso', $r->datos['error']['codigo']);
        }
        foreach ($this->comIds as $id) {
            self::assertSame(403, $this->lab->patch("/comentarios/$id/resolucion", ['estado' => 'resuelto'])->estado);
        }
        self::assertSame(403, $this->admin->patch("/sugerencias/{$this->sugIds[0]}", ['estado' => 'aceptada'])->estado);
        self::assertSame(403, $this->lab->put("/capitulos/{$this->cap}/final", ['docJson' => $this->docFinal(), 'tex' => 'x'])->estado);
        self::assertSame(403, $this->lab->get("/capitulos/{$this->cap}/final")->estado);
        self::assertSame($antes, $this->fila('sugerencias', $this->sugIds[0]));
        self::assertSame(0, (int) self::$bd->query("SELECT COUNT(*) FROM versiones_capitulo WHERE tipo = 'final'")->fetchColumn());
    }

    // ---------------------------------------------------------------- resolver comentarios

    public function test_resolver_comentario(): void
    {
        $this->cerrarConsulta();
        $revisorId = (int) self::$bd->query("SELECT id FROM usuarios WHERE laboratorio = 'Comité revisor'")->fetchColumn();
        $id = $this->comIds[1];
        $r = $this->revisor->patch("/comentarios/$id/resolucion", ['estado' => 'resuelto', 'notaResolucion' => 'Incorporado', 'texto' => 'manipulado', 'usuario_id' => 1]);
        self::assertSame(200, $r->estado, $r->cuerpo());
        $f = $this->fila('comentarios', $id);
        self::assertSame('resuelto', $f['estado']);
        self::assertSame('Incorporado', $f['nota_resolucion']);
        self::assertSame($revisorId, (int) $f['resuelto_por']);
        self::assertSame('2026-11-02 12:00:00', $f['resuelto_en']);
        self::assertSame('Comentario b', $f['texto']);
        self::assertSame((string) $this->lab2U['id'], (string) $f['usuario_id']);
        self::assertSame('abierto', $this->fila('comentarios', $this->comIds[0])['estado']);

        $aud = $this->auditoria('resolver_comentario');
        self::assertCount(1, $aud);
        $d = json_decode($aud[0]['detalle'], true);
        self::assertSame('abierto', $d['anterior']);
        self::assertSame('resuelto', $d['nuevo']);
        self::assertSame((string) $id, $aud[0]['entidad_id']);

        // Reabrir limpia quién y cuándo.
        self::assertSame(200, $this->revisor->patch("/comentarios/$id/resolucion", ['estado' => 'abierto'])->estado);
        $f = $this->fila('comentarios', $id);
        self::assertSame('abierto', $f['estado']);
        self::assertNull($f['resuelto_por']);
        self::assertNull($f['resuelto_en']);
        self::assertSame('abierto', json_decode($this->auditoria('resolver_comentario')[1]['detalle'], true)['nuevo']);

        // Lo ve el revisor en aportes.
        $this->revisor->patch("/comentarios/$id/resolucion", ['estado' => 'resuelto', 'notaResolucion' => 'ok']);
        $c = json_decode($this->revisor->get("/capitulos/{$this->cap}/aportes")->cuerpo(), true)['comentarios'][1];
        self::assertSame('resuelto', $c['estado']);
        self::assertSame('ok', $c['notaResolucion']);
        self::assertSame('2026-11-02T12:00:00Z', $c['resueltoEn']);
    }

    // ---------------------------------------------------------------- mis aportes

    public function test_laboratorio_ve_mis_aportes_solo_en_edicion_final(): void
    {
        $r = $this->lab->get("/capitulos/{$this->cap}/mis-aportes");
        self::assertSame(409, $r->estado);
        self::assertSame('etapa_no_permite', $r->datos['error']['codigo']);

        $this->cerrarConsulta();
        $this->revisor->patch("/sugerencias/{$this->sugIds[0]}", ['estado' => 'aceptada', 'notaResolucion' => 'Sí']);
        $this->revisor->patch("/sugerencias/{$this->sugIds[1]}", ['estado' => 'rechazada', 'notaResolucion' => 'No', 'derivadaReunion' => true]);
        $this->revisor->patch("/comentarios/{$this->comIds[0]}/resolucion", ['estado' => 'resuelto', 'notaResolucion' => 'Visto']);

        $r = $this->lab->get("/capitulos/{$this->cap}/mis-aportes");
        self::assertSame(200, $r->estado, $r->cuerpo());
        $d = json_decode($r->cuerpo(), true);
        self::assertCount(1, $d['sugerencias']);
        self::assertSame('aceptada', $d['sugerencias'][0]['estado']);
        self::assertSame('Sí', $d['sugerencias'][0]['notaResolucion']);
        self::assertFalse($d['sugerencias'][0]['derivadaReunion']);
        self::assertSame('u' . $this->labU['id'] . ':f1-p1:a', $d['sugerencias'][0]['id']);
        self::assertCount(1, $d['comentarios']);
        self::assertSame($this->comIds[0], $d['comentarios'][0]['id']);
        self::assertSame('resuelto', $d['comentarios'][0]['estado']);
        self::assertSame('Visto', $d['comentarios'][0]['notaResolucion']);
        // Sin datos de otros laboratorios ni de quién resolvió.
        self::assertStringNotContainsString('Laboratorio Sur', $r->cuerpo());
        self::assertStringNotContainsString('Comentario b', $r->cuerpo());
        self::assertArrayNotHasKey('resueltoPor', $d['sugerencias'][0]);
        self::assertArrayNotHasKey('laboratorio', $d['sugerencias'][0]);

        $d2 = json_decode($this->lab2->get("/capitulos/{$this->cap}/mis-aportes")->cuerpo(), true);
        self::assertSame('rechazada', $d2['sugerencias'][0]['estado']);
        self::assertTrue($d2['sugerencias'][0]['derivadaReunion'], 'el laboratorio ve que su aporte se derivó a reunión');
        self::assertSame('abierto', $d2['comentarios'][0]['estado']);

        self::assertSame(403, $this->revisor->get("/capitulos/{$this->cap}/mis-aportes")->estado);
        self::assertSame(404, $this->lab->get('/capitulos/9999/mis-aportes')->estado);
    }

    // ---------------------------------------------------------------- versión final

    public function test_guardar_version_final_crea_nueva_version(): void
    {
        self::assertSame(404, $this->revisor->get("/capitulos/{$this->cap}/final")->estado);
        $this->cerrarConsulta();

        $r1 = $this->revisor->put("/capitulos/{$this->cap}/final", ['docJson' => $this->docFinal(), 'tex' => '\\section{Final 1}']);
        self::assertSame(200, $r1->estado, $r1->cuerpo());
        $v1 = $r1->datos['versionId'];
        $r2 = $this->revisor->put("/capitulos/{$this->cap}/final", ['docJson' => $this->docFinal(), 'tex' => "\\section{Final 2 ñ}"]);
        self::assertSame(200, $r2->estado, $r2->cuerpo());
        $v2 = $r2->datos['versionId'];
        self::assertGreaterThan($v1, $v2);

        $filas = self::$bd->query("SELECT * FROM versiones_capitulo WHERE tipo = 'final' ORDER BY id")->fetchAll();
        self::assertCount(2, $filas);
        self::assertSame('\\section{Final 1}', $filas[0]['tex_final']);
        self::assertNull($filas[0]['tex_original']);
        self::assertNull($filas[1]['tex_original']);
        self::assertSame("\\section{Final 2 ñ}", $filas[1]['tex_final']);
        self::assertSame((string) $this->cap, (string) $filas[1]['capitulo_id']);
        self::assertNotNull($filas[1]['creado_por']);

        $g = $this->revisor->get("/capitulos/{$this->cap}/final");
        self::assertSame(200, $g->estado, $g->cuerpo());
        $d = json_decode($g->cuerpo(), true);
        self::assertSame($v2, $d['versionId']);
        self::assertSame("\\section{Final 2 ñ}", $d['tex']);
        self::assertSame('versión final', $d['docJson']['content'][0]['content'][0]['text']);

        // La base vigente no cambia: una final no es base.
        self::assertSame($this->ver, $this->lab->get("/capitulos/{$this->cap}/base")->datos['versionId']);
        self::assertCount(2, $this->auditoria('guardar_final'));
        // GET final vale en cualquier etapa, y 404 en capítulo inexistente.
        self::assertSame(404, $this->revisor->get('/capitulos/9999/final')->estado);
    }

    public function test_guardar_final_valida_documento_y_tex(): void
    {
        $this->cerrarConsulta();
        $url = "/capitulos/{$this->cap}/final";
        $malo = ['type' => 'doc', 'content' => [['type' => 'html', 'content' => []]]];
        $r = $this->revisor->put($url, ['docJson' => $malo, 'tex' => 'x']);
        self::assertSame(422, $r->estado, $r->cuerpo());
        self::assertSame('documento_invalido', $r->datos['error']['codigo']);
        foreach ([
            ['docJson' => $this->docFinal()],
            ['docJson' => $this->docFinal(), 'tex' => ''],
            ['docJson' => $this->docFinal(), 'tex' => 5],
            ['docJson' => $this->docFinal(), 'tex' => str_repeat('a', 1048577)],
            ['docJson' => 'texto', 'tex' => 'x'],
        ] as $cuerpo) {
            $r = $this->revisor->put($url, $cuerpo);
            self::assertSame(400, $r->estado, substr(json_encode($cuerpo), 0, 80));
        }
        // 1 MB exacto vale.
        self::assertSame(200, $this->revisor->put($url, ['docJson' => $this->docFinal(), 'tex' => str_repeat('a', 1048576)])->estado);
        // UTF-8 inválido en el cuerpo crudo.
        $r = $this->app->manejar(new \Manual\Http\Peticion('PUT', "/api$url", [
            'content-type' => 'application/json', 'x-csrf-token' => (string) $this->revisor->csrf,
            'cookie' => $this->revisor->nombreCookie . '=' . $this->revisor->cookie,
        ], '{"docJson":{"type":"doc","content":[]},"tex":"a' . "\xC3\x28" . '"}', '127.0.0.1'));
        // json_decode rechaza UTF-8 inválido antes de validar: siempre 400 entrada_invalida.
        self::assertSame(400, $r->estado, $r->cuerpo());
        self::assertSame('entrada_invalida', $r->datos['error']['codigo']);
        self::assertSame(1, (int) self::$bd->query("SELECT COUNT(*) FROM versiones_capitulo WHERE tipo = 'final'")->fetchColumn());
        self::assertSame(404, $this->revisor->put('/capitulos/9999/final', ['docJson' => $this->docFinal(), 'tex' => 'x'])->estado);
    }
}
