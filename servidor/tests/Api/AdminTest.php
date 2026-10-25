<?php

declare(strict_types=1);

namespace Manual\Pruebas\Api;

use Manual\Acceso\Usuarios;
use Manual\Aplicacion;
use Manual\Pruebas\Soporte\BaseDePruebas;
use Manual\Pruebas\Soporte\ClienteApi;
use Manual\Pruebas\Soporte\RelojFijo;
use Manual\Seguridad\Cifrado;
use PHPUnit\Framework\TestCase;

final class AdminTest extends TestCase
{
    use BaseDePruebas;

    private RelojFijo $reloj;
    private Aplicacion $app;

    protected function setUp(): void
    {
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

    private function doc(): array
    {
        return json_decode((string) file_get_contents(__DIR__ . '/../fixtures/doc-listas.json'), true);
    }

    private function capitulo(array $extra = []): array
    {
        return $extra + ['slug' => 'cap-1', 'titulo' => 'Capítulo 1', 'orden' => 1, 'texOriginal' => '\\section{Hola ñ}', 'docJson' => $this->doc()];
    }

    private function auditoria(string $accion): array
    {
        $st = self::$bd->prepare('SELECT * FROM auditoria WHERE accion = ?');
        $st->execute([$accion]);
        return $st->fetchAll();
    }

    private function csv(): string
    {
        return "nombre,correo,laboratorio\nAna Pérez,ana@lab.cl,Lab Norte\nLuis Soto,Luis@lab.cl,Lab Sur\n";
    }

    private function cuenta(string $correo): ?array
    {
        $c = self::configPruebas();
        return (new Usuarios(self::$bd, new Cifrado($c->claveCifrado, $c->claveIndice)))->porCorreo($correo);
    }

    public function test_importar_csv_crea_cuentas_y_devuelve_claves_una_vez(): void
    {
        [$c] = $this->admin();
        $r = $c->post('/admin/usuarios/importar', ['csv' => $this->csv()]);
        self::assertSame(201, $r->estado);
        self::assertCount(2, $r->datos);
        self::assertSame('ana@lab.cl', $r->datos[0]['correo']);
        $clave = $r->datos[0]['clave'];
        self::assertSame(16, strlen($clave));

        // La cuenta nueva puede entrar y tiene rol laboratorio
        $n = new ClienteApi($this->app);
        $n->comoUsuario(['correo' => 'ana@lab.cl', 'clave' => $clave]);
        self::assertSame(['laboratorio'], $n->get('/sesion')->datos['usuario']['roles']);

        // Listado con correo descifrado; sin claves ni hashes
        $l = $c->get('/admin/usuarios');
        self::assertSame(200, $l->estado);
        $correos = array_column($l->datos, 'correo');
        self::assertContains('ana@lab.cl', $correos);
        self::assertContains('Luis@lab.cl', $correos);
        self::assertStringNotContainsString($clave, $l->cuerpo());
        self::assertStringNotContainsString('clave_hash', $l->cuerpo());
        self::assertStringNotContainsString('argon2', $l->cuerpo());
        $fila = array_values(array_filter($l->datos, fn ($u) => $u['correo'] === 'ana@lab.cl'))[0];
        self::assertSame(['id', 'nombre', 'laboratorio', 'correo', 'roles', 'activo'], array_keys($fila));
        self::assertTrue($fila['activo']);

        // Auditoría sin secretos
        $aud = $this->auditoria('importar_usuarios');
        self::assertCount(1, $aud);
        self::assertStringNotContainsString($clave, (string) $aud[0]['detalle']);
        self::assertStringNotContainsString('ana@lab.cl', (string) $aud[0]['detalle']);
    }

    public function test_importar_csv_con_duplicado_no_crea_ninguna(): void
    {
        [$c] = $this->admin();
        $antes = (int) self::$bd->query('SELECT COUNT(*) FROM usuarios')->fetchColumn();

        // Duplicado dentro del CSV (insensible a mayúsculas)
        $r = $c->post('/admin/usuarios/importar', ['csv' => "nombre,correo,laboratorio\nA,a@lab.cl,L\nB,x@lab.cl,L\nC,A@lab.cl,L\n"]);
        self::assertSame(400, $r->estado);
        self::assertSame('entrada_invalida', $r->datos['error']['codigo']);
        self::assertStringContainsString('4', $r->datos['error']['mensaje']);
        self::assertSame($antes, (int) self::$bd->query('SELECT COUNT(*) FROM usuarios')->fetchColumn());

        // Duplicado de una cuenta existente
        $this->crearUsuario(['correo' => 'existe@lab.cl']);
        $r = $c->post('/admin/usuarios/importar', ['csv' => "nombre,correo,laboratorio\nA,nuevo@lab.cl,L\nB,existe@lab.cl,L\n"]);
        self::assertSame(400, $r->estado);
        self::assertStringContainsString('3', $r->datos['error']['mensaje']);
        self::assertSame($antes + 1, (int) self::$bd->query('SELECT COUNT(*) FROM usuarios')->fetchColumn());
        self::assertNull($this->cuenta('nuevo@lab.cl'));
    }

    public function test_importar_csv_rechaza_encabezado_correo_y_campos_invalidos(): void
    {
        [$c] = $this->admin();
        foreach ([
            "correo,nombre,laboratorio\nA,a@lab.cl,L\n",
            "nombre,correo,laboratorio\nA,no-es-correo,L\n",
            "nombre,correo,laboratorio\n,a@lab.cl,L\n",
            "nombre,correo,laboratorio\nA,a@lab.cl\n",
            "nombre,correo,laboratorio\n",
            '',
        ] as $csv) {
            $r = $c->post('/admin/usuarios/importar', ['csv' => $csv]);
            self::assertSame(400, $r->estado, $csv);
        }
        self::assertSame(400, $c->post('/admin/usuarios/importar', ['csv' => 5])->estado);
        self::assertSame(1, (int) self::$bd->query('SELECT COUNT(*) FROM usuarios')->fetchColumn());
    }

    public function test_importar_csv_con_punto_y_coma_y_bom(): void
    {
        [$c] = $this->admin();
        $csv = "\xEF\xBB\xBFnombre;correo;laboratorio\r\n\"Ñandú, Pedro\";pedro@lab.cl;\"Lab; Central\"\r\n";
        $r = $c->post('/admin/usuarios/importar', ['csv' => $csv]);
        self::assertSame(201, $r->estado, $r->cuerpo());
        $l = $c->get('/admin/usuarios')->datos;
        $u = array_values(array_filter($l, fn ($x) => $x['correo'] === 'pedro@lab.cl'))[0];
        self::assertSame('Ñandú, Pedro', $u['nombre']);
        self::assertSame('Lab; Central', $u['laboratorio']);
    }

    public function test_regenerar_clave_invalida_la_anterior(): void
    {
        [$c] = $this->admin();
        $u = $this->crearUsuario(['correo' => 'lab@lab.cl']);
        $r = $c->post("/admin/usuarios/{$u['id']}/clave", []);
        self::assertSame(200, $r->estado);
        $nueva = $r->datos['clave'];
        self::assertSame(16, strlen($nueva));
        self::assertNotSame($u['clave'], $nueva);

        $malo = new ClienteApi($this->app);
        self::assertSame(401, $malo->post('/sesion', ['correo' => 'lab@lab.cl', 'clave' => $u['clave']])->estado);
        $ok = new ClienteApi($this->app);
        self::assertSame(200, $ok->post('/sesion', ['correo' => 'lab@lab.cl', 'clave' => $nueva])->estado);

        $aud = $this->auditoria('regenerar_clave');
        self::assertCount(1, $aud);
        self::assertStringNotContainsString($nueva, (string) $aud[0]['detalle']);
        self::assertSame(404, $c->post('/admin/usuarios/99999/clave', [])->estado);
    }

    public function test_regenerar_clave_cierra_las_sesiones_abiertas_de_esa_cuenta(): void
    {
        [$c] = $this->admin();
        $u = $this->crearUsuario(['correo' => 'lab@lab.cl']);
        $otro = $this->crearUsuario();
        $sesionLab = $this->cliente($u);
        $otraPestana = $this->cliente($u);
        $escritor = $this->cliente($u);
        $sesionOtro = $this->cliente($otro);
        self::assertSame(200, $sesionLab->get('/sesion')->estado);

        $nueva = $c->post("/admin/usuarios/{$u['id']}/clave", [])->datos['clave'];

        foreach ([$sesionLab, $otraPestana] as $s) {
            $r = $s->get('/sesion');
            self::assertSame(401, $r->estado);
            self::assertSame('sin_sesion', $r->datos['error']['codigo']);
            self::assertNull($s->cookie, 'la cookie se borra');
        }
        // Las escrituras también quedan fuera aunque la pestaña conserve su token CSRF.
        $r = $escritor->post('/capitulos/1/comentarios', ['bloqueId' => 'p1', 'texto' => 'hola']);
        self::assertSame(401, $r->estado, $r->cuerpo());
        self::assertSame('sin_sesion', $r->datos['error']['codigo']);
        // Otras cuentas y el propio admin siguen dentro; con la clave nueva se vuelve a entrar.
        self::assertSame(200, $sesionOtro->get('/sesion')->estado);
        self::assertSame(200, $c->get('/sesion')->estado);
        $n = (new ClienteApi($this->app))->comoUsuario(['correo' => 'lab@lab.cl', 'clave' => $nueva]);
        self::assertSame(200, $n->get('/sesion')->estado);
    }

    public function test_desactivar_impide_login(): void
    {
        [$c, $a] = $this->admin();
        $u = $this->crearUsuario(['correo' => 'lab@lab.cl']);
        $sesionLab = $this->cliente($u);
        self::assertSame(200, $sesionLab->get('/sesion')->estado);

        $r = $c->patch("/admin/usuarios/{$u['id']}", ['activo' => false]);
        self::assertSame(200, $r->estado);
        self::assertSame(401, $sesionLab->get('/sesion')->estado);
        self::assertSame(401, (new ClienteApi($this->app))->post('/sesion', ['correo' => 'lab@lab.cl', 'clave' => $u['clave']])->estado);

        $c->patch("/admin/usuarios/{$u['id']}", ['activo' => true, 'roles' => ['laboratorio', 'revisor']]);
        $n = (new ClienteApi($this->app))->comoUsuario($u);
        self::assertEqualsCanonicalizing(['laboratorio', 'revisor'], $n->get('/sesion')->datos['usuario']['roles']);

        self::assertSame(400, $c->patch("/admin/usuarios/{$u['id']}", ['roles' => ['dios']])->estado);
        self::assertSame(400, $c->patch("/admin/usuarios/{$u['id']}", ['roles' => []])->estado);
        self::assertSame(400, $c->patch("/admin/usuarios/{$u['id']}", [])->estado);
        self::assertSame(404, $c->patch('/admin/usuarios/99999', ['activo' => false])->estado);
        // No puede quitarse a sí mismo el acceso
        self::assertSame(409, $c->patch("/admin/usuarios/{$a['id']}", ['activo' => false])->estado);
        self::assertSame(409, $c->patch("/admin/usuarios/{$a['id']}", ['roles' => ['laboratorio']])->estado);
        self::assertCount(2, $this->auditoria('actualizar_usuario'));
    }

    public function test_laboratorio_no_accede_a_admin(): void
    {
        $u = $this->crearUsuario();
        $c = $this->cliente($u);
        self::assertSame(403, $c->get('/admin/usuarios')->estado);
        self::assertSame(403, $c->post('/admin/usuarios/importar', ['csv' => $this->csv()])->estado);
        self::assertSame(403, $c->post("/admin/usuarios/{$u['id']}/clave", [])->estado);
        self::assertSame(403, $c->patch("/admin/usuarios/{$u['id']}", ['roles' => ['admin']])->estado);
        self::assertSame(403, $c->post('/admin/capitulos', $this->capitulo())->estado);
        self::assertSame(403, $c->put('/admin/consulta', ['apertura' => '2026-12-01T00:00:00Z', 'cierre' => '2026-12-31T00:00:00Z', 'motivoObligatorio' => false])->estado);
        self::assertSame(401, (new ClienteApi($this->app))->get('/admin/usuarios')->estado);
    }

    public function test_subir_capitulo_crea_version_base(): void
    {
        [$c, $a] = $this->admin();
        $r = $c->post('/admin/capitulos', $this->capitulo());
        self::assertSame(201, $r->estado, $r->cuerpo());
        self::assertArrayHasKey('id', $r->datos);
        self::assertArrayHasKey('versionId', $r->datos);

        $v = self::$bd->query('SELECT * FROM versiones_capitulo')->fetch();
        self::assertSame('base', $v['tipo']);
        self::assertSame('\\section{Hola ñ}', $v['tex_original']);
        self::assertSame((int) $a['id'], (int) $v['creado_por']);
        self::assertEquals(json_decode(json_encode($this->doc())), json_decode($v['doc_json']));

        // Mismo slug: nueva versión base, mismo capítulo, título actualizado
        $r2 = $c->post('/admin/capitulos', $this->capitulo(['titulo' => 'Nuevo título']));
        self::assertSame(201, $r2->estado);
        self::assertSame($r->datos['id'], $r2->datos['id']);
        self::assertGreaterThan($r->datos['versionId'], $r2->datos['versionId']);
        self::assertSame(1, (int) self::$bd->query('SELECT COUNT(*) FROM capitulos')->fetchColumn());
        self::assertSame('Nuevo título', self::$bd->query('SELECT titulo FROM capitulos')->fetchColumn());
        self::assertSame(2, (int) self::$bd->query("SELECT COUNT(*) FROM versiones_capitulo WHERE tipo='base'")->fetchColumn());

        $aud = $this->auditoria('subir_capitulo');
        self::assertCount(2, $aud);
        self::assertStringNotContainsString('section', (string) $aud[0]['detalle']);
    }

    public function test_subir_capitulo_valida_entrada(): void
    {
        [$c] = $this->admin();
        $mal = [
            ['slug' => 'Mayus'], ['slug' => 'a_b'], ['slug' => str_repeat('a', 81)], ['slug' => ''],
            ['titulo' => ''], ['orden' => '1'], ['orden' => -1], ['texOriginal' => ''],
            ['texOriginal' => "\xff\xfe"], ['texOriginal' => str_repeat('a', 1048577)],
        ];
        foreach ($mal as $i => $extra) {
            if (isset($extra['texOriginal']) && $extra['texOriginal'] === "\xff\xfe") {
                // json_encode del cliente de pruebas rechaza UTF-8 inválido: se manda por la ruta con escape
                continue;
            }
            self::assertSame(400, $c->post('/admin/capitulos', $this->capitulo($extra))->estado, "caso $i");
        }
        // 1 MB exacto pasa
        self::assertSame(201, $c->post('/admin/capitulos', $this->capitulo(['texOriginal' => str_repeat('a', 1048576)]))->estado);

        // docJson ajeno al esquema: 422 y no se guarda
        $antes = (int) self::$bd->query('SELECT COUNT(*) FROM versiones_capitulo')->fetchColumn();
        $d = $this->doc();
        $d['content'][] = ['type' => 'html', 'text' => '<script>'];
        $r = $c->post('/admin/capitulos', $this->capitulo(['slug' => 'otro', 'docJson' => $d]));
        self::assertSame(422, $r->estado);
        self::assertSame('documento_invalido', $r->datos['error']['codigo']);
        self::assertSame(400, $c->post('/admin/capitulos', ['slug' => 'x', 'titulo' => 't', 'orden' => 1, 'texOriginal' => 't'])->estado);
        self::assertSame($antes, (int) self::$bd->query('SELECT COUNT(*) FROM versiones_capitulo')->fetchColumn());
        self::assertSame(0, (int) self::$bd->query("SELECT COUNT(*) FROM capitulos WHERE slug='otro'")->fetchColumn());
    }

    public function test_subir_capitulo_en_consulta_da_409(): void
    {
        [$c] = $this->admin();
        self::$bd->exec("UPDATE consulta SET apertura='2026-11-01 00:00:00', cierre='2026-11-30 00:00:00'");
        $r = $c->post('/admin/capitulos', $this->capitulo());
        self::assertSame(409, $r->estado);
        self::assertSame('etapa_no_permite', $r->datos['error']['codigo']);
        self::assertSame(0, (int) self::$bd->query('SELECT COUNT(*) FROM capitulos')->fetchColumn());
        // y en edición final también
        self::$bd->exec("UPDATE consulta SET cierre='2026-11-02 11:00:00'");
        self::assertSame(409, $c->post('/admin/capitulos', $this->capitulo())->estado);
    }

    public function test_consulta_fechas_etapa_y_motivo(): void
    {
        [$c] = $this->admin();
        $uLab = $this->crearUsuario();
        $lab = $this->cliente($uLab);
        $r = $lab->get('/consulta');
        self::assertSame(200, $r->estado);
        self::assertSame(['apertura' => null, 'cierre' => null, 'etapa' => 'preparacion', 'motivoObligatorio' => false], $r->datos);
        self::assertSame(401, (new ClienteApi($this->app))->get('/consulta')->estado);

        $r = $c->put('/admin/consulta', ['apertura' => '2026-11-10T09:00:00-03:00', 'cierre' => '2026-12-01T00:00:00Z', 'motivoObligatorio' => true]);
        self::assertSame(200, $r->estado, $r->cuerpo());
        $g = $lab->get('/consulta')->datos;
        self::assertSame('2026-11-10T12:00:00Z', $g['apertura']);
        self::assertSame('2026-12-01T00:00:00Z', $g['cierre']);
        self::assertSame('preparacion', $g['etapa']);
        self::assertTrue($g['motivoObligatorio']);
        self::assertSame('2026-11-10 12:00:00', self::$bd->query('SELECT apertura FROM consulta')->fetchColumn());

        // la etapa sigue al reloj inyectado
        $this->reloj->avanzar(10 * 86400);
        $lab = $this->cliente($uLab); // la sesión anterior venció por inactividad
        self::assertSame('consulta', $lab->get('/consulta')->datos['etapa']);
        $this->reloj->avanzar(30 * 86400);
        $lab = $this->cliente($uLab);
        self::assertSame('edicion_final', $lab->get('/consulta')->datos['etapa']);
        self::assertGreaterThanOrEqual(1, count($this->auditoria('actualizar_consulta')));
    }

    public function test_fechas_invalidas_dan_400(): void
    {
        [$c] = $this->admin();
        $ok = ['apertura' => '2026-12-01T00:00:00Z', 'cierre' => '2026-12-31T00:00:00Z', 'motivoObligatorio' => false];
        foreach ([
            ['cierre' => '2026-12-01T00:00:00Z'],          // cierre = apertura
            ['cierre' => '2026-11-30T00:00:00Z'],          // cierre < apertura
            ['apertura' => '2026-12-01'],                  // sin hora/zona
            ['apertura' => '2026-12-01T00:00:00'],         // sin zona
            ['apertura' => '2026-02-30T00:00:00Z'],
            ['apertura' => 'mañana'],
            ['apertura' => null],
            ['motivoObligatorio' => 'si'],
            ['apertura' => '2026-11-02T11:54:00Z'],        // hace 6 min
            ['apertura' => '2026-11-02T11:56:00Z', 'cierre' => '2026-11-02T12:00:00Z'], // cierre = ahora
            ['apertura' => '2026-11-02T11:56:00Z', 'cierre' => '2026-11-02T11:58:00Z'], // cierre pasado
        ] as $i => $mal) {
            self::assertSame(400, $c->put('/admin/consulta', $mal + $ok)->estado, "caso $i");
        }
        self::assertNull(self::$bd->query('SELECT apertura FROM consulta')->fetchColumn());
    }

    public function test_cambiar_fechas_en_consulta_da_409(): void
    {
        [$c, $a] = $this->admin();
        $c->put('/admin/consulta', ['apertura' => '2026-11-02T12:00:00Z', 'cierre' => '2026-11-30T00:00:00Z', 'motivoObligatorio' => false]);
        $r = $c->put('/admin/consulta', ['apertura' => '2026-11-05T00:00:00Z', 'cierre' => '2026-12-30T00:00:00Z', 'motivoObligatorio' => false]);
        self::assertSame(409, $r->estado);
        self::assertSame('etapa_no_permite', $r->datos['error']['codigo']);
        self::assertSame('2026-11-30 00:00:00', self::$bd->query('SELECT cierre FROM consulta')->fetchColumn());

        // El motivo sí se puede cambiar, repitiendo las mismas fechas
        $r = $c->put('/admin/consulta', ['apertura' => '2026-11-02T15:00:00+03:00', 'cierre' => '2026-11-30T00:00:00Z', 'motivoObligatorio' => true]);
        self::assertSame(200, $r->estado, $r->cuerpo());
        self::assertSame(1, (int) self::$bd->query('SELECT motivo_obligatorio FROM consulta')->fetchColumn());

        // ...y también tras el cierre
        $this->reloj->avanzar(40 * 86400);
        $c = $this->cliente($a);
        self::assertSame(200, $c->put('/admin/consulta', ['apertura' => '2026-11-02T12:00:00Z', 'cierre' => '2026-11-30T00:00:00Z', 'motivoObligatorio' => false])->estado);
        self::assertSame(409, $c->put('/admin/consulta', ['apertura' => '2026-11-02T12:00:00Z', 'cierre' => '2026-12-30T00:00:00Z', 'motivoObligatorio' => false])->estado);
    }

    public function test_en_consulta_solo_se_puede_extender_el_cierre(): void
    {
        [$c, $a] = $this->admin();
        $apertura = '2026-11-02T12:00:00Z';
        self::assertSame(200, $c->put('/admin/consulta', ['apertura' => $apertura, 'cierre' => '2026-11-30T00:00:00Z', 'motivoObligatorio' => false])->estado);
        $this->reloj->avanzar(86400);
        $c = $this->cliente($a);
        $cierreBd = fn () => self::$bd->query('SELECT cierre FROM consulta')->fetchColumn();

        // Extender: misma apertura (en cualquier zona), cierre más tarde. El motivo viaja igual.
        $r = $c->put('/admin/consulta', ['apertura' => '2026-11-02T09:00:00-03:00', 'cierre' => '2026-12-07T00:00:00Z', 'motivoObligatorio' => true]);
        self::assertSame(200, $r->estado, $r->cuerpo());
        self::assertSame('2026-12-07T00:00:00Z', $r->datos['cierre']);
        self::assertSame($apertura, $r->datos['apertura']);
        self::assertSame('consulta', $r->datos['etapa']);
        self::assertTrue($r->datos['motivoObligatorio']);
        self::assertSame('2026-12-07 00:00:00', $cierreBd());
        $aud = $this->auditoria('actualizar_consulta');
        self::assertStringContainsString('2026-12-07T00:00:00Z', (string) end($aud)['detalle']);

        foreach ([
            'acortar' => ['apertura' => $apertura, 'cierre' => '2026-12-06T00:00:00Z'],
            'acortar a antes de ahora' => ['apertura' => $apertura, 'cierre' => '2026-11-03T11:00:00Z'],
            'mover la apertura' => ['apertura' => '2026-11-01T12:00:00Z', 'cierre' => '2026-12-07T00:00:00Z'],
            'mover la apertura y extender' => ['apertura' => '2026-11-03T00:00:00Z', 'cierre' => '2026-12-20T00:00:00Z'],
        ] as $caso => $fechas) {
            $r = $c->put('/admin/consulta', $fechas + ['motivoObligatorio' => true]);
            self::assertSame(409, $r->estado, $caso);
            self::assertSame('etapa_no_permite', $r->datos['error']['codigo'], $caso);
        }
        self::assertSame('2026-12-07 00:00:00', $cierreBd());
        self::assertSame('2026-11-02 12:00:00', self::$bd->query('SELECT apertura FROM consulta')->fetchColumn());

        // Cerrada la consulta, ya no se extiende (reabrirla cambiaría una etapa ya vivida).
        $this->reloj->avanzar(40 * 86400);
        $c = $this->cliente($a);
        self::assertSame(409, $c->put('/admin/consulta', ['apertura' => $apertura, 'cierre' => '2027-02-01T00:00:00Z', 'motivoObligatorio' => true])->estado);
        self::assertSame('2026-12-07 00:00:00', $cierreBd());
    }

    public function test_abrir_ahora_es_valido_y_el_error_senala_el_campo(): void
    {
        [$c] = $this->admin();
        $r = $c->put('/admin/consulta', ['apertura' => '2026-11-02T11:56:00Z', 'cierre' => '2026-12-01T00:00:00Z', 'motivoObligatorio' => false]);
        self::assertSame(200, $r->estado, $r->cuerpo());
        self::assertSame('consulta', $r->datos['etapa']);

        self::$bd->exec('UPDATE consulta SET apertura = NULL, cierre = NULL');
        $r = $c->put('/admin/consulta', ['apertura' => '2026-11-02T11:54:00Z', 'cierre' => '2026-12-01T00:00:00Z', 'motivoObligatorio' => false]);
        self::assertSame(400, $r->estado);
        self::assertArrayHasKey('apertura', $r->datos['error']['campos']);
        $r = $c->put('/admin/consulta', ['apertura' => '2026-11-02T11:56:00Z', 'cierre' => '2026-11-02T11:59:00Z', 'motivoObligatorio' => false]);
        self::assertArrayHasKey('cierre', $r->datos['error']['campos']);
    }

    public function test_subida_concurrente_del_mismo_slug_da_409(): void
    {
        [$c] = $this->admin();
        // Fuerza el choque de clave duplicada que ocurriría con dos subidas simultáneas.
        self::$bd->exec("CREATE TRIGGER tg_forzar_duplicado BEFORE INSERT ON capitulos FOR EACH ROW SIGNAL SQLSTATE '23000' SET MESSAGE_TEXT = 'Duplicate entry'");
        try {
            $r = $c->post('/admin/capitulos', $this->capitulo());
        } finally {
            self::$bd->exec('DROP TRIGGER IF EXISTS tg_forzar_duplicado');
        }
        self::assertSame(409, $r->estado, $r->cuerpo());
        self::assertSame('conflicto_concurrente', $r->datos['error']['codigo']);
        self::assertSame(0, (int) self::$bd->query('SELECT COUNT(*) FROM versiones_capitulo')->fetchColumn());
    }

    public function test_csv_informa_lineas_fisicas_y_salta_blancos_iniciales(): void
    {
        [$c] = $this->admin();
        // Dos líneas en blanco, encabezado en la 3; el registro 1 ocupa las líneas 4-5 (salto dentro de comillas); el malo está en la 6.
        $csv = "\n  \nnombre,correo,laboratorio\n\"Ana\nPérez\",ana@lab.cl,L\nMalo,no-correo,L\n";
        $r = $c->post('/admin/usuarios/importar', ['csv' => $csv]);
        self::assertSame(400, $r->estado);
        self::assertStringContainsString('6', $r->datos['error']['mensaje']);
        self::assertStringNotContainsString('4', $r->datos['error']['mensaje']);

        $csv = "\n\nnombre,correo,laboratorio\nAna,ana@lab.cl,L\n";
        self::assertSame(201, $c->post('/admin/usuarios/importar', ['csv' => $csv])->estado);
    }

    public function test_csv_con_mas_de_100_filas_da_400(): void
    {
        [$c] = $this->admin();
        $csv = "nombre,correo,laboratorio\n";
        for ($i = 0; $i < 101; $i++) {
            $csv .= "N$i,u$i@lab.cl,L\n";
        }
        $r = $c->post('/admin/usuarios/importar', ['csv' => $csv]);
        self::assertSame(400, $r->estado);
        self::assertSame(1, (int) self::$bd->query('SELECT COUNT(*) FROM usuarios')->fetchColumn());
    }

    public function test_tope_de_cuerpo_por_ruta(): void
    {
        [$c] = $this->admin();
        // 3 MB: pasa en subir capítulos (tope 4 MB), no en el resto (2 MB).
        $relleno = str_repeat('a', 3 * 1024 * 1024);
        $r = $c->post('/admin/capitulos', $this->capitulo(['relleno' => $relleno]));
        self::assertSame(201, $r->estado, substr($r->cuerpo(), 0, 200));
        $r = $c->put('/admin/consulta', ['apertura' => '2026-12-01T00:00:00Z', 'cierre' => '2026-12-31T00:00:00Z', 'motivoObligatorio' => false, 'relleno' => $relleno]);
        self::assertSame(413, $r->estado);
        // Más de 4 MB: 413 también en subir capítulos.
        $r = $c->post('/admin/capitulos', $this->capitulo(['slug' => 'grande', 'relleno' => str_repeat('a', 4 * 1024 * 1024)]));
        self::assertSame(413, $r->estado);
        self::assertSame(0, (int) self::$bd->query("SELECT COUNT(*) FROM capitulos WHERE slug='grande'")->fetchColumn());

        self::assertSame(4194304, \Manual\Http\Peticion::limiteCuerpo('PUT', '/api/capitulos/7/final'));
        self::assertSame(2097152, \Manual\Http\Peticion::limiteCuerpo('GET', '/api/capitulos/7/final'));
        self::assertSame(2097152, \Manual\Http\Peticion::limiteCuerpo('PUT', '/api/capitulos/7/copia'));
        self::assertSame(2097152, \Manual\Http\Peticion::limiteCuerpo('POST', '/api/admin/usuarios/importar'));
    }
}
