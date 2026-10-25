<?php

declare(strict_types=1);

namespace Manual\Pruebas\Api;

use Manual\Http\Respuesta;
use Manual\Pruebas\Soporte\BaseDePruebas;
use Manual\Pruebas\Soporte\ClienteApi;
use Manual\Pruebas\Soporte\EscenarioRevision;
use PHPUnit\Framework\TestCase;

/**
 * Revisión de seguridad transversal: aislamiento entre laboratorios, campos prohibidos,
 * columnas sensibles en las respuestas e inyección SQL.
 * En el escenario, `lab` es el laboratorio A (víctima) y `lab2` el B (atacante).
 */
final class AislamientoTest extends TestCase
{
    use BaseDePruebas;
    use EscenarioRevision;

    private const SECRETO = 'SECRETO-DE-A';

    protected function setUp(): void
    {
        $this->montar();
    }

    private function autorA(): string
    {
        return 'u' . $this->labU['id'];
    }

    /** A re-guarda su copia con una marca reconocible en el documento, la sugerencia y un comentario. */
    private function marcarDatosDeA(): void
    {
        $autor = $this->autorA();
        $doc = ['type' => 'doc', 'content' => [
            ['type' => 'parrafo', 'attrs' => ['bid' => 'p1'], 'content' => [['type' => 'text', 'text' => self::SECRETO]]],
        ]];
        $r = $this->lab->put("/capitulos/{$this->cap}/copia", [
            'versionId' => $this->ver,
            'docJson' => $doc,
            'sugerencias' => [[
                'id' => "$autor:f1-p1:a", 'bloqueId' => 'f1-p1', 'autor' => $autor,
                'base' => ['desde' => 0, 'hasta' => 4], 'copia' => ['desde' => 0, 'hasta' => 5],
                'original' => [['type' => 'text', 'text' => 'hola']],
                'propuesta' => [['type' => 'text', 'text' => self::SECRETO]],
                'tipo' => 'contenido', 'motivo' => self::SECRETO,
            ]],
        ]);
        self::assertSame(200, $r->estado, $r->cuerpo());
        $r = $this->lab->patch("/comentarios/{$this->comIds[0]}", ['texto' => self::SECRETO]);
        self::assertSame(200, $r->estado, $r->cuerpo());
    }

    /** Huella de las filas de A en las tablas por laboratorio. */
    private function huellaDeA(): string
    {
        $id = (int) $this->labU['id'];
        $partes = [];
        foreach (['copias_laboratorio', 'sugerencias', 'comentarios', 'revisiones_copia'] as $t) {
            $partes[$t] = self::$bd->query("SELECT * FROM $t WHERE usuario_id = $id ORDER BY 1, 2")->fetchAll();
        }
        return sha1(serialize($partes));
    }

    private static function sinDatosDeA(Respuesta $r, string $autorA, string $contexto): void
    {
        $cuerpo = $r->cuerpo();
        self::assertStringNotContainsString(self::SECRETO, $cuerpo, $contexto);
        self::assertStringNotContainsString("\"$autorA:", $cuerpo, $contexto);
        self::assertStringNotContainsString("\"$autorA\"", $cuerpo, $contexto);
        self::assertStringNotContainsString('Laboratorio Norte', $cuerpo, $contexto);
    }

    public function test_aislamiento_entre_laboratorios_en_todos_los_endpoints(): void
    {
        $this->marcarDatosDeA();
        $autorA = $this->autorA();
        $uidA = "$autorA:f1-p1:a";
        $comA = $this->comIds[0];
        $sugA = $this->sugIds[0];
        $cap = $this->cap;
        $huella = $this->huellaDeA();

        // --- Etapa consulta: lecturas con {id} devuelven solo lo propio de B.
        foreach (["/capitulos/$cap/copia", "/capitulos/$cap/comentarios", '/capitulos'] as $ruta) {
            $r = $this->lab2->get($ruta);
            self::assertSame(200, $r->estado, $ruta);
            self::sinDatosDeA($r, $autorA, $ruta);
        }
        $copia = json_decode($this->lab2->get("/capitulos/$cap/copia")->cuerpo(), true);
        self::assertCount(1, $copia['sugerencias']);
        self::assertStringStartsWith('u' . $this->lab2U['id'] . ':', $copia['sugerencias'][0]['id']);
        $coms = $this->lab2->get("/capitulos/$cap/comentarios")->datos;
        self::assertSame([$this->comIds[1]], array_column($coms, 'id'));

        // --- Escrituras sobre ids de A: 404, igual que un id inexistente.
        $intentos = [
            ['PATCH', "/capitulos/$cap/sugerencias/$uidA", ['motivo' => 'robado']],
            ['PATCH', "/capitulos/$cap/sugerencias/" . rawurlencode($uidA), ['motivo' => 'robado']],
            ['PATCH', "/comentarios/$comA", ['texto' => 'robado']],
            ['DELETE', "/comentarios/$comA", null],
        ];
        foreach ($intentos as [$m, $ruta, $cuerpo]) {
            $r = $this->lab2->enviar($m, $ruta, $cuerpo);
            self::assertSame(404, $r->estado, "$m $ruta " . $r->cuerpo());
            self::assertSame('no_encontrado', $r->datos['error']['codigo']);
            self::sinDatosDeA($r, $autorA, "$m $ruta");
        }
        // Mismo resultado que un recurso que no existe: no se distingue.
        self::assertSame(404, $this->lab2->patch('/comentarios/999999', ['texto' => 'x'])->estado);
        self::assertSame(404, $this->lab2->patch("/capitulos/$cap/sugerencias/u999999:x:y", ['motivo' => 'x'])->estado);

        // B no puede crear sugerencias a nombre de A.
        $r = $this->lab2->put("/capitulos/$cap/copia", [
            'versionId' => $this->ver,
            'docJson' => $this->docCopia(),
            'sugerencias' => [[
                'id' => "$autorA:f1-p1:z", 'bloqueId' => 'f1-p1', 'autor' => $autorA,
                'base' => ['desde' => 0, 'hasta' => 4], 'copia' => ['desde' => 0, 'hasta' => 5],
                'original' => [['type' => 'text', 'text' => 'hola']],
                'propuesta' => [['type' => 'text', 'text' => 'falsa']],
                'tipo' => 'contenido',
            ]],
        ]);
        self::assertSame(400, $r->estado, $r->cuerpo());
        // Reemplazar su conjunto (vacío) no toca el de A.
        $r = $this->lab2->put("/capitulos/$cap/copia", ['versionId' => $this->ver, 'docJson' => $this->docCopia(), 'sugerencias' => []]);
        self::assertSame(200, $r->estado, $r->cuerpo());

        // Rutas del revisor y del admin: 403 para un laboratorio.
        foreach ([
            ['GET', "/capitulos/$cap/aportes", null],
            ['GET', "/capitulos/$cap/final", null],
            ['PUT', "/capitulos/$cap/final", ['docJson' => $this->docFinal(), 'tex' => 'x']],
            ['PATCH', "/sugerencias/$sugA", ['estado' => 'rechazada']],
            ['PATCH', "/comentarios/$comA/resolucion", ['estado' => 'resuelto']],
            ['GET', '/admin/usuarios', null],
            ['POST', "/admin/usuarios/{$this->labU['id']}/clave", null],
            ['PATCH', "/admin/usuarios/{$this->labU['id']}", ['activo' => false]],
        ] as [$m, $ruta, $cuerpo]) {
            $r = $this->lab2->enviar($m, $ruta, $cuerpo);
            self::assertSame(403, $r->estado, "$m $ruta " . $r->cuerpo());
            self::sinDatosDeA($r, $autorA, "$m $ruta");
        }

        // --- Etapa edicion_final: mis-aportes solo trae lo propio.
        $this->cerrarConsulta();
        $r = $this->lab2->get("/capitulos/$cap/mis-aportes");
        self::assertSame(200, $r->estado, $r->cuerpo());
        self::sinDatosDeA($r, $autorA, 'mis-aportes');
        $d = json_decode($r->cuerpo(), true);
        self::assertSame([], $d['sugerencias']);
        self::assertSame([$this->comIds[1]], array_column($d['comentarios'], 'id'));
        foreach ([
            ['PATCH', "/sugerencias/$sugA", ['estado' => 'rechazada']],
            ['PATCH', "/comentarios/$comA/resolucion", ['estado' => 'resuelto']],
        ] as [$m, $ruta, $cuerpo]) {
            self::assertSame(403, $this->lab2->enviar($m, $ruta, $cuerpo)->estado, "$m $ruta");
        }

        // Ningún intento cambió los datos de A, y A sigue viendo los suyos.
        self::assertSame($huella, $this->huellaDeA());
        $r = $this->lab->get("/capitulos/$cap/mis-aportes");
        self::assertStringContainsString(self::SECRETO, $r->cuerpo());
    }

    public function test_campos_prohibidos_se_ignoran(): void
    {
        $idA = (int) $this->labU['id'];
        $idB = (int) $this->lab2U['id'];
        $autorB = 'u' . $idB;
        $prohibidos = [
            'usuario_id' => $idA, 'usuarioId' => $idA, 'estado' => 'aceptada', 'resuelto_por' => $idA,
            'resueltoPor' => $idA, 'roles' => ['admin', 'revisor'], 'autor' => 'u' . $idA,
        ];

        // PUT copia: los campos prohibidos van en el cuerpo y en cada sugerencia.
        $r = $this->lab2->put("/capitulos/{$this->cap}/copia", $prohibidos + [
            'versionId' => $this->ver,
            'docJson' => $this->docCopia(),
            'sugerencias' => [[
                'id' => "$autorB:f1-p1:n", 'bloqueId' => 'f1-p1',
                'base' => ['desde' => 0, 'hasta' => 4], 'copia' => ['desde' => 0, 'hasta' => 5],
                'original' => [['type' => 'text', 'text' => 'hola']],
                'propuesta' => [['type' => 'text', 'text' => 'nueva']],
                'tipo' => 'contenido',
            ] + $prohibidos],
        ]);
        self::assertSame(200, $r->estado, $r->cuerpo());
        $fila = self::$bd->query("SELECT * FROM sugerencias WHERE uid = '$autorB:f1-p1:n'")->fetch();
        self::assertSame($idB, (int) $fila['usuario_id']);
        self::assertSame('pendiente', $fila['estado']);
        self::assertNull($fila['resuelto_por']);
        foreach (['usuario_id', 'usuarioId', 'estado', 'resuelto_por', 'resueltoPor', 'roles', 'autor'] as $k) {
            self::assertArrayNotHasKey($k, json_decode($fila['datos'], true), $k);
        }
        $copiaA = self::$bd->query("SELECT COUNT(*) FROM copias_laboratorio WHERE usuario_id = $idA")->fetchColumn();
        self::assertSame(1, (int) $copiaA, 'la copia de A sigue siendo una sola');
        $sug = json_decode($this->lab2->get("/capitulos/{$this->cap}/copia")->cuerpo(), true)['sugerencias'][0];
        self::assertSame($autorB, $sug['autor']);
        self::assertSame('pendiente', $sug['estado']);

        // PATCH motivo.
        $r = $this->lab2->patch("/capitulos/{$this->cap}/sugerencias/$autorB:f1-p1:n", $prohibidos + ['motivo' => 'porque sí']);
        self::assertSame(200, $r->estado, $r->cuerpo());
        $fila = self::$bd->query("SELECT * FROM sugerencias WHERE uid = '$autorB:f1-p1:n'")->fetch();
        self::assertSame([$idB, 'pendiente', null], [(int) $fila['usuario_id'], $fila['estado'], $fila['resuelto_por']]);

        // Comentarios: crear y editar.
        $r = $this->lab2->post("/capitulos/{$this->cap}/comentarios", $prohibidos + [
            'bloqueId' => 'f1-p1', 'rango' => ['desde' => 0, 'hasta' => 1], 'texto' => 'nuevo',
        ]);
        self::assertSame(201, $r->estado, $r->cuerpo());
        $idCom = $r->datos['id'];
        $r = $this->lab2->patch("/comentarios/$idCom", $prohibidos + ['estado' => 'resuelto', 'texto' => 'editado']);
        self::assertSame(200, $r->estado, $r->cuerpo());
        $c = self::$bd->query("SELECT * FROM comentarios WHERE id = $idCom")->fetch();
        self::assertSame([$idB, 'abierto', null, 'editado'], [(int) $c['usuario_id'], $c['estado'], $c['resuelto_por'], $c['texto']]);

        // Login con roles en el cuerpo: los roles salen de la base.
        $cliente = new ClienteApi($this->app);
        $r = $cliente->post('/sesion', $prohibidos + [
            'correo' => $this->lab2U['correo'], 'clave' => $this->lab2U['clave'], 'sitio_web' => '',
        ]);
        self::assertSame(200, $r->estado, $r->cuerpo());
        self::assertSame(['laboratorio'], $r->datos['usuario']['roles']);
        self::assertSame($idB, $r->datos['usuario']['id']);
        self::assertSame(403, $cliente->get('/admin/usuarios')->estado);

        // Revisor: resolver no acepta otro resuelto_por ni cambia el dueño.
        $this->cerrarConsulta();
        $r = $this->revisor->patch("/sugerencias/{$this->sugIds[0]}", ['estado' => 'rechazada'] + $prohibidos);
        self::assertSame(200, $r->estado, $r->cuerpo());
        $fila = self::$bd->query("SELECT * FROM sugerencias WHERE id = {$this->sugIds[0]}")->fetch();
        self::assertSame('rechazada', $fila['estado']);
        self::assertSame($idA, (int) $fila['usuario_id']);
        self::assertNotSame($idA, (int) $fila['resuelto_por']);
    }

    public function test_respuestas_no_filtran_columnas(): void
    {
        $prohibidas = ['clave_hash', 'correo_cifrado', 'correo_indice', 'claveHash', 'correoCifrado', 'correoIndice', '$argon2id$', '$2y$'];
        $respuestas = [];
        $anotar = function (string $quien, string $m, string $ruta, ?array $cuerpo = null) use (&$respuestas): void {
            $cliente = $this->{$quien};
            $respuestas["$quien $m $ruta"] = $cliente->enviar($m, $ruta, $cuerpo);
        };
        $cap = $this->cap;

        foreach (['admin', 'revisor', 'lab', 'lab2'] as $quien) {
            foreach (['/sesion', '/consulta', '/capitulos', "/capitulos/$cap/base", "/capitulos/$cap/copia", "/capitulos/$cap/comentarios", "/capitulos/$cap/aportes", '/admin/usuarios'] as $ruta) {
                $anotar($quien, 'GET', $ruta);
            }
        }
        $anotar('admin', 'POST', '/admin/usuarios/importar', ['csv' => "nombre,correo,laboratorio\nNuevo,nuevo@lab.cl,Lab Nuevo"]);
        $anotar('admin', 'POST', "/admin/usuarios/{$this->labU['id']}/clave");
        $anotar('admin', 'PATCH', "/admin/usuarios/{$this->labU['id']}", ['roles' => ['laboratorio']]);
        $anotar('lab', 'PATCH', "/capitulos/$cap/sugerencias/u{$this->labU['id']}:f1-p1:a", ['motivo' => 'x']);
        $this->cerrarConsulta();
        $anotar('revisor', 'PATCH', "/sugerencias/{$this->sugIds[0]}", ['estado' => 'aceptada']);
        $anotar('revisor', 'PUT', "/capitulos/$cap/final", ['docJson' => $this->docFinal(), 'tex' => 'x']);
        foreach (['revisor', 'lab', 'lab2'] as $quien) {
            $anotar($quien, 'GET', "/capitulos/$cap/aportes");
            $anotar($quien, 'GET', "/capitulos/$cap/mis-aportes");
            $anotar($quien, 'GET', "/capitulos/$cap/final");
        }
        // Login (éxito y fallo).
        $nuevo = new ClienteApi($this->app);
        $respuestas['login ok'] = $nuevo->post('/sesion', ['correo' => $this->lab2U['correo'], 'clave' => $this->lab2U['clave'], 'sitio_web' => '']);
        $respuestas['login mal'] = (new ClienteApi($this->app))->post('/sesion', ['correo' => $this->lab2U['correo'], 'clave' => 'mala', 'sitio_web' => '']);

        self::assertSame(200, $respuestas['admin GET /admin/usuarios']->estado);
        self::assertSame(201, $respuestas['admin POST /admin/usuarios/importar']->estado);
        foreach ($respuestas as $quien => $r) {
            self::assertLessThan(500, $r->estado, $quien);
            $cuerpo = $r->cuerpo();
            foreach ($prohibidas as $p) {
                self::assertStringNotContainsString($p, $cuerpo, "$quien filtra $p");
            }
            foreach ($r->cabeceras as $v) {
                foreach ($prohibidas as $p) {
                    self::assertStringNotContainsString($p, (string) $v, "$quien filtra $p en cabeceras");
                }
            }
        }
    }

    public function test_inyeccion_sql_en_slug_y_textos(): void
    {
        $inyeccion = "' OR 1=1 --";
        $cap = $this->cap;
        $autor = 'u' . $this->labU['id'];

        // Comentario y motivo: se guardan literales y solo afectan la fila propia.
        $r = $this->lab->post("/capitulos/$cap/comentarios", ['bloqueId' => 'f1-p1', 'rango' => ['desde' => 0, 'hasta' => 1], 'texto' => $inyeccion]);
        self::assertSame(201, $r->estado, $r->cuerpo());
        $idCom = $r->datos['id'];
        self::assertSame($inyeccion, self::$bd->query("SELECT texto FROM comentarios WHERE id = $idCom")->fetchColumn());
        $r = $this->lab->patch("/comentarios/$idCom", ['texto' => "x$inyeccion"]);
        self::assertSame(200, $r->estado);
        self::assertSame(['Comentario b'], self::$bd->query("SELECT texto FROM comentarios WHERE usuario_id = {$this->lab2U['id']}")->fetchAll(\PDO::FETCH_COLUMN));

        $r = $this->lab->patch("/capitulos/$cap/sugerencias/$autor:f1-p1:a", ['motivo' => $inyeccion]);
        self::assertSame(200, $r->estado, $r->cuerpo());
        self::assertSame($inyeccion, self::$bd->query("SELECT motivo FROM sugerencias WHERE id = {$this->sugIds[0]}")->fetchColumn());
        self::assertNull(self::$bd->query("SELECT motivo FROM sugerencias WHERE id = {$this->sugIds[1]}")->fetchColumn());
        $sug = json_decode($this->lab->get("/capitulos/$cap/copia")->cuerpo(), true)['sugerencias'][0];
        self::assertSame($inyeccion, $sug['motivo']);

        // bloqueId con inyección en un comentario y en una sugerencia.
        $r = $this->lab->post("/capitulos/$cap/comentarios", ['bloqueId' => $inyeccion, 'rango' => ['desde' => 0, 'hasta' => 1], 'texto' => 'y']);
        self::assertSame(201, $r->estado, $r->cuerpo());
        self::assertSame($inyeccion, self::$bd->query("SELECT bloque_id FROM comentarios WHERE id = {$r->datos['id']}")->fetchColumn());

        // Slug: el formato lo rechaza (400), en el cuerpo y como {id} en la ruta (404).
        $doc = json_decode((string) file_get_contents(__DIR__ . '/../fixtures/doc-listas.json'), true);
        $this->abrirPreparacion();
        $r = $this->admin->post('/admin/capitulos', ['slug' => $inyeccion, 'titulo' => 't', 'orden' => 2, 'texOriginal' => 'x', 'docJson' => $doc]);
        self::assertSame(400, $r->estado, $r->cuerpo());
        self::assertArrayHasKey('slug', $r->datos['error']['campos']);
        // Título con inyección: literal.
        $r = $this->admin->post('/admin/capitulos', ['slug' => 'cap-2', 'titulo' => $inyeccion, 'orden' => 2, 'texOriginal' => $inyeccion, 'docJson' => $doc]);
        self::assertSame(201, $r->estado, $r->cuerpo());
        self::assertSame($inyeccion, self::$bd->query("SELECT titulo FROM capitulos WHERE slug = 'cap-2'")->fetchColumn());
        self::assertSame(2, (int) self::$bd->query('SELECT COUNT(*) FROM capitulos')->fetchColumn());
        foreach (['/capitulos/' . rawurlencode($inyeccion) . '/base', '/capitulos/1%20OR%201=1/base', '/comentarios/1%27%20OR%201=1--'] as $ruta) {
            self::assertSame(404, $this->lab->get($ruta)->estado, $ruta);
        }

        // Login: un correo con inyección es un fallo normal (401), no entra.
        $r = (new ClienteApi($this->app))->post('/sesion', ['correo' => $inyeccion, 'clave' => $inyeccion, 'sitio_web' => '']);
        self::assertSame(401, $r->estado);
        self::assertSame('credenciales_invalidas', $r->datos['error']['codigo']);

        // CSV: nombre y laboratorio con inyección se guardan literales.
        $r = $this->admin->post('/admin/usuarios/importar', ['csv' => "nombre,correo,laboratorio\n\"$inyeccion\",sql@lab.cl,\"$inyeccion\""]);
        self::assertSame(201, $r->estado, $r->cuerpo());
        $usuarios = $this->admin->get('/admin/usuarios')->datos;
        $nuevo = array_values(array_filter($usuarios, fn (array $u): bool => $u['correo'] === 'sql@lab.cl'));
        self::assertSame([$inyeccion, $inyeccion], [$nuevo[0]['nombre'], $nuevo[0]['laboratorio']]);
    }

    /** Vuelve a preparación (sin apertura) para poder subir capítulos. */
    private function abrirPreparacion(): void
    {
        self::$bd->exec('UPDATE consulta SET apertura = NULL, cierre = NULL');
    }
}
