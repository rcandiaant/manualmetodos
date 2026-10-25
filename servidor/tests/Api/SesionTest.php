<?php

declare(strict_types=1);

namespace Manual\Pruebas\Api;

use Manual\Aplicacion;
use Manual\Config;
use Manual\Http\Respuesta;
use Manual\Pruebas\Soporte\AlmacenSesionMemoria;
use Manual\Pruebas\Soporte\BaseDePruebas;
use Manual\Pruebas\Soporte\ClienteApi;
use Manual\Pruebas\Soporte\RelojFijo;
use Manual\Seguridad\LimiteIntentos;
use PHPUnit\Framework\TestCase;

final class SesionTest extends TestCase
{
    use BaseDePruebas;

    private RelojFijo $reloj;
    private AlmacenSesionMemoria $sesiones;
    private Aplicacion $app;

    protected function setUp(): void
    {
        $this->reloj = new RelojFijo();
        $this->sesiones = new AlmacenSesionMemoria();
        $this->app = $this->nuevaAplicacion($this->reloj, $this->sesiones);
    }

    private function cliente(string $ip = '127.0.0.1'): ClienteApi
    {
        $c = new ClienteApi($this->app);
        $c->ip = $ip;
        return $c;
    }

    private function login(ClienteApi $c, string $correo, string $clave, string $sitioWeb = ''): Respuesta
    {
        return $c->post('/api/sesion', ['correo' => $correo, 'clave' => $clave, 'sitio_web' => $sitioWeb]);
    }

    private function assertError(int $estado, string $codigo, Respuesta $r): void
    {
        $this->assertSame($estado, $r->estado, (string) json_encode($r->datos));
        $this->assertSame($codigo, $r->datos['error']['codigo'] ?? null);
    }

    private function setCookie(Respuesta $r): ?string
    {
        foreach ($r->cabeceras as $n => $v) {
            if (strtolower((string) $n) === 'set-cookie') {
                return $v;
            }
        }
        return null;
    }

    public function test_login_correcto_devuelve_usuario_y_csrf(): void
    {
        $u = $this->crearUsuario(['nombre' => 'Ana Soto', 'correo' => 'Ana.Soto@lab.cl', 'laboratorio' => 'Lab Suelos', 'roles' => ['laboratorio', 'revisor']]);
        $c = $this->cliente();

        $r = $this->login($c, '  ana.soto@LAB.cl ', $u['clave']);

        $this->assertSame(200, $r->estado, (string) json_encode($r->datos));
        $this->assertSame(['id' => $u['id'], 'nombre' => 'Ana Soto', 'laboratorio' => 'Lab Suelos', 'roles' => ['laboratorio', 'revisor']], $r->datos['usuario']);
        $this->assertSame(['usuario', 'csrf'], array_keys($r->datos), 'DTO explícito: nada de correo ni hash');
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $r->datos['csrf']);

        $cookie = (string) $this->setCookie($r);
        $this->assertMatchesRegularExpression('/^mm_sesion=[A-Za-z0-9,-]{22,}; /', $cookie);
        $this->assertStringContainsString('; HttpOnly', $cookie);
        $this->assertStringContainsString('; SameSite=Strict', $cookie);
        $this->assertStringContainsString('; Path=/', $cookie);
        $this->assertStringNotContainsString('Secure', $cookie, 'COOKIE_SEGURA=0 en pruebas');

        $g = $c->get('/api/sesion');
        $this->assertSame(200, $g->estado);
        $this->assertSame($r->datos, $g->datos, 'GET /sesion devuelve el mismo usuario y el mismo token');

        $fila = self::$bd->query("SELECT usuario_id, accion FROM auditoria")->fetchAll();
        $this->assertSame([['usuario_id' => $u['id'], 'accion' => 'inicio_sesion']], $fila);
    }

    public function test_cookie_secure_con_cookie_segura(): void
    {
        $base = self::configPruebas();
        $config = Config::desdeArreglo([
            'BD_DSN' => $base->bdDsn, 'BD_USUARIO' => $base->bdUsuario, 'BD_CLAVE' => $base->bdClave,
            'CLAVE_CIFRADO' => base64_encode($base->claveCifrado), 'CLAVE_INDICE' => base64_encode($base->claveIndice),
            'COOKIE_SEGURA' => '1',
        ]);
        $u = $this->crearUsuario();
        $c = new ClienteApi(new Aplicacion($config, $this->reloj, new AlmacenSesionMemoria(), self::$bd));
        $r = $this->login($c, $u['correo'], $u['clave']);
        $this->assertSame(200, $r->estado);
        $cookie = (string) $this->setCookie($r);
        $this->assertStringStartsWith('__Host-mm_sesion=', $cookie, 'prefijo __Host-: un subdominio no puede plantarla');
        $this->assertStringContainsString('; Secure', $cookie);
        $this->assertStringContainsString('; Path=/', $cookie);
        $this->assertStringNotContainsString('Domain', $cookie);
        $this->assertSame(200, $c->get('/api/sesion')->estado, 'se lee con el mismo nombre');
        $salir = $c->delete('/api/sesion');
        $this->assertSame(204, $salir->estado);
        $this->assertStringStartsWith('__Host-mm_sesion=;', (string) $this->setCookie($salir));
    }

    public function test_muchos_logins_correctos_desde_la_misma_ip_no_bloquean(): void
    {
        for ($i = 0; $i < 8; $i++) {
            $u = $this->crearUsuario();
            $this->assertSame(200, $this->login($this->cliente('10.0.4.1'), $u['correo'], $u['clave'])->estado, "entrada $i");
        }
    }

    public function test_cuerpo_sin_content_type_json_da_415(): void
    {
        $u = $this->crearUsuario();
        $json = ['correo' => $u['correo'], 'clave' => $u['clave'], 'sitio_web' => ''];
        // Un formulario de otro sitio con enctype=text/plain puede armar JSON válido: se rechaza.
        foreach (['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx', null] as $tipo) {
            $r = $this->cliente()->enviar('POST', '/api/sesion', $json, ['content-type' => $tipo]);
            $this->assertError(415, 'tipo_no_soportado', $r);
        }
        $c = $this->cliente();
        $this->assertSame(200, $c->enviar('POST', '/api/sesion', $json, ['content-type' => 'Application/JSON; charset=utf-8'])->estado);
        $this->assertError(415, 'tipo_no_soportado', $c->enviar('DELETE', '/api/sesion', ['x' => 1], ['content-type' => 'text/plain']));
        $this->assertSame(204, $c->enviar('DELETE', '/api/sesion', null, ['content-type' => null])->estado, 'sin cuerpo no se exige tipo');
    }

    public function test_origen_ajeno_da_403(): void
    {
        $u = $this->crearUsuario();
        $json = ['correo' => $u['correo'], 'clave' => $u['clave'], 'sitio_web' => ''];
        $ajenos = [
            ['origin' => 'https://malo.example', 'host' => 'manual.inia.cl'],
            ['origin' => 'null', 'host' => 'manual.inia.cl'],
            ['origin' => 'https://manual.inia.cl.malo.example', 'host' => 'manual.inia.cl'],
            ['origin' => 'https://manual.inia.cl:8443', 'host' => 'manual.inia.cl'],
            ['origin' => 'https://manual.inia.cl'],
            ['sec-fetch-site' => 'cross-site', 'host' => 'manual.inia.cl'],
        ];
        foreach ($ajenos as $i => $cab) {
            $this->assertError(403, 'origen_invalido', $this->cliente()->enviar('POST', '/api/sesion', $json, $cab), "caso $i");
        }
        $c = $this->cliente();
        $this->assertSame(200, $c->enviar('POST', '/api/sesion', $json, ['origin' => 'https://Manual.inia.cl', 'host' => 'manual.inia.cl', 'sec-fetch-site' => 'same-origin'])->estado);
        $this->assertSame(200, $c->enviar('GET', '/api/sesion', [], ['origin' => 'https://malo.example'])->estado, 'GET no se restringe');
        $this->assertError(403, 'origen_invalido', $c->enviar('DELETE', '/api/sesion', [], ['origin' => 'https://malo.example', 'host' => 'localhost:8080']));
        $this->assertSame(204, $c->enviar('DELETE', '/api/sesion', [], ['origin' => 'http://localhost:8080', 'host' => 'localhost:8080'])->estado);
    }

    public function test_fallo_de_login_queda_auditado_sin_correo(): void
    {
        $this->login($this->cliente('10.0.5.1'), 'Secreto.Nombre@lab.cl', 'clave-que-no-debe-quedar');
        $filas = self::$bd->query('SELECT usuario_id, accion, detalle FROM auditoria')->fetchAll();
        $this->assertCount(1, $filas);
        $this->assertSame('login_fallido', $filas[0]['accion']);
        $this->assertNull($filas[0]['usuario_id']);
        $detalle = json_decode((string) $filas[0]['detalle'], true);
        $this->assertSame('10.0.5.1', $detalle['ip']);
        $this->assertMatchesRegularExpression('/^cuenta:[0-9a-f]{64}$/', $detalle['cuenta']);
        $this->assertStringNotContainsStringIgnoringCase('secreto', (string) $filas[0]['detalle']);
        $this->assertStringNotContainsString('clave-que-no-debe-quedar', (string) $filas[0]['detalle']);
    }

    public function test_logout_concurrente_no_da_500(): void
    {
        $c = $this->cliente()->comoUsuario($this->crearUsuario());
        // Otra pestaña cierra la sesión justo después de que esta petición la leyó.
        $this->sesiones->alCargar = function (): void {
            $this->sesiones->sesiones = [];
        };
        $this->assertError(401, 'sin_sesion', $c->get('/api/sesion'));
    }

    public function test_login_no_revela_si_el_correo_existe(): void
    {
        $u = $this->crearUsuario(['correo' => 'existe@lab.cl']);

        $inicio = hrtime(true);
        $inexistente = $this->login($this->cliente('10.0.0.1'), 'nadie@lab.cl', 'cualquier-clave');
        $msInexistente = (hrtime(true) - $inicio) / 1e6;
        $claveMala = $this->login($this->cliente('10.0.0.2'), 'existe@lab.cl', 'clave-equivocada');

        $this->assertError(401, 'credenciales_invalidas', $inexistente);
        $this->assertSame($inexistente->estado, $claveMala->estado);
        $this->assertSame($inexistente->datos, $claveMala->datos);
        $this->assertSame($inexistente->cabeceras, $claveMala->cabeceras);
        $this->assertNull($this->setCookie($inexistente));
        $this->assertSame([], $this->sesiones->sesiones, 'un fallo no crea sesión');
        $this->assertGreaterThan(30, $msInexistente, 'con correo inexistente igual se verifica un hash Argon2id');
        $this->assertSame(200, $this->login($this->cliente('10.0.0.3'), 'existe@lab.cl', $u['clave'])->estado);
    }

    public function test_honeypot_lleno_falla_igual(): void
    {
        $u = $this->crearUsuario();
        $malo = $this->login($this->cliente('10.0.0.9'), $u['correo'], 'clave-equivocada');

        $c = $this->cliente();
        $trampa = $this->login($c, $u['correo'], $u['clave'], 'http://spam.example');
        $this->assertError(401, 'credenciales_invalidas', $trampa);
        $this->assertSame($malo->datos, $trampa->datos);
        $this->assertSame($malo->cabeceras, $trampa->cabeceras);

        for ($i = 0; $i < 4; $i++) {
            $this->login($c, $u['correo'], $u['clave'], 'http://spam.example');
        }
        $this->assertError(429, 'demasiados_intentos', $this->login($c, $u['correo'], $u['clave']), 'el honeypot suma intentos');
    }

    public function test_cuenta_inactiva_no_entra(): void
    {
        $inactivo = $this->crearUsuario(['activo' => false]);
        $malo = $this->login($this->cliente('10.0.0.9'), 'nadie@lab.cl', 'x');

        $r = $this->login($this->cliente(), $inactivo['correo'], $inactivo['clave']);
        $this->assertError(401, 'credenciales_invalidas', $r);
        $this->assertSame($malo->datos, $r->datos);
        $this->assertNull($this->setCookie($r));

        // Desactivar a alguien con sesión abierta la corta en la petición siguiente.
        $activo = $this->crearUsuario();
        $c = $this->cliente('10.0.0.5')->comoUsuario($activo);
        self::$bd->exec('UPDATE usuarios SET activo = 0 WHERE id = ' . $activo['id']);
        $this->assertError(401, 'sin_sesion', $c->get('/api/sesion'));
    }

    public function test_bloqueo_progresivo(): void
    {
        $u = $this->crearUsuario();
        $c = $this->cliente();

        for ($i = 0; $i < 5; $i++) {
            $this->assertError(401, 'credenciales_invalidas', $this->login($c, $u['correo'], 'mala'));
        }
        $r = $this->login($c, $u['correo'], $u['clave']);
        $this->assertError(429, 'demasiados_intentos', $r);
        $this->assertSame('60', $r->cabeceras['Retry-After'] ?? null);
        $this->assertNull($this->setCookie($r));

        $this->reloj->avanzar(59);
        $this->assertError(429, 'demasiados_intentos', $this->login($c, $u['correo'], $u['clave']));
        $this->reloj->avanzar(2); // 61 s
        $this->assertError(401, 'credenciales_invalidas', $this->login($c, $u['correo'], 'mala'), 'se puede intentar de nuevo');

        for ($i = 0; $i < 4; $i++) {
            $this->login($c, $u['correo'], 'mala');
        }
        $r = $this->login($c, $u['correo'], $u['clave']);
        $this->assertError(429, 'demasiados_intentos', $r);
        $this->assertSame('300', $r->cabeceras['Retry-After'] ?? null, 'segundo bloqueo: 5 min');

        $this->reloj->avanzar(299);
        $this->assertError(429, 'demasiados_intentos', $this->login($c, $u['correo'], $u['clave']));
        $this->reloj->avanzar(2);
        for ($i = 0; $i < 5; $i++) {
            $this->login($c, $u['correo'], 'mala');
        }
        $this->assertSame('900', $this->login($c, $u['correo'], $u['clave'])->cabeceras['Retry-After'] ?? null, 'tercero: 15 min');
        $this->reloj->avanzar(901);
        for ($i = 0; $i < 5; $i++) {
            $this->login($c, $u['correo'], 'mala');
        }
        $this->assertSame('3600', $this->login($c, $u['correo'], $u['clave'])->cabeceras['Retry-After'] ?? null, 'cuarto: 60 min');
        $this->reloj->avanzar(3601);
        for ($i = 0; $i < 5; $i++) {
            $this->login($c, $u['correo'], 'mala');
        }
        $this->assertSame('3600', $this->login($c, $u['correo'], $u['clave'])->cabeceras['Retry-After'] ?? null, 'el último se repite');

        $this->reloj->avanzar(3601);
        $this->assertSame(200, $this->login($c, $u['correo'], $u['clave'])->estado);
        $n = self::$bd->query("SELECT COUNT(*) FROM auditoria WHERE accion = 'bloqueo_login'")->fetchColumn();
        $this->assertGreaterThan(0, (int) $n);
    }

    public function test_bloqueo_por_cuenta_aunque_cambie_la_ip(): void
    {
        $u = $this->crearUsuario();
        for ($i = 1; $i <= 5; $i++) {
            $this->login($this->cliente("10.0.1.$i"), $u['correo'], 'mala');
        }
        $this->assertError(429, 'demasiados_intentos', $this->login($this->cliente('10.0.1.99'), $u['correo'], $u['clave']));
    }

    public function test_bloqueo_por_ip_entre_cuentas(): void
    {
        $this->assertSame(20, LimiteIntentos::UMBRAL_IP);
        $this->assertSame(5, LimiteIntentos::UMBRAL_CUENTA);
        $otro = $this->crearUsuario();
        $c = $this->cliente('10.0.2.1');
        // Tras una NAT institucional, 5 errores de distintas personas no bloquean la IP compartida.
        for ($i = 1; $i <= 19; $i++) {
            $this->assertError(401, 'credenciales_invalidas', $this->login($c, "victima$i@lab.cl", 'mala'), "fallo $i");
        }
        $this->assertSame(200, $this->login($c, $otro['correo'], $otro['clave'])->estado, '19 fallos de la IP aún no bloquean');
        // El éxito devuelve su reserva: la IP sigue con 19 y el fallo 20 la bloquea.
        $this->assertError(401, 'credenciales_invalidas', $this->login($c, 'victima20@lab.cl', 'mala'));
        $r = $this->login($c, $otro['correo'], $otro['clave']);
        $this->assertError(429, 'demasiados_intentos', $r);
        $this->assertSame('60', $r->cabeceras['Retry-After'] ?? null);
        $this->assertSame(200, $this->login($this->cliente('10.0.2.2'), $otro['correo'], $otro['clave'])->estado);
    }

    public function test_el_exito_reinicia_la_cuenta(): void
    {
        $u = $this->crearUsuario();
        for ($i = 1; $i <= 4; $i++) {
            $this->login($this->cliente("10.0.3.$i"), $u['correo'], 'mala');
        }
        $this->assertSame(200, $this->login($this->cliente('10.0.3.10'), $u['correo'], $u['clave'])->estado);
        for ($i = 11; $i <= 14; $i++) {
            $this->login($this->cliente("10.0.3.$i"), $u['correo'], 'mala');
        }
        $this->assertSame(200, $this->login($this->cliente('10.0.3.20'), $u['correo'], $u['clave'])->estado, '4 + éxito + 4 no bloquea');
    }

    public function test_entrada_invalida_en_login(): void
    {
        $c = $this->cliente();
        $this->assertError(400, 'entrada_invalida', $c->post('/api/sesion', ['correo' => ['a'], 'clave' => 'x']));
        $this->assertError(400, 'entrada_invalida', $c->post('/api/sesion', ['clave' => 'x']));
        $this->assertError(400, 'entrada_invalida', $c->post('/api/sesion', ['correo' => 'a@b.cl', 'clave' => 'x', 'sitio_web' => 5]));
        $this->assertError(400, 'entrada_invalida', $c->post('/api/sesion', ['correo' => str_repeat('a', 300) . '@b.cl', 'clave' => 'x']));
    }

    public function test_escritura_sin_csrf_da_403(): void
    {
        $u = $this->crearUsuario();
        $c = $this->cliente()->comoUsuario($u);

        $this->assertError(403, 'csrf_invalido', $c->enviar('DELETE', '/api/sesion', [], ['x-csrf-token' => null]));
        $this->assertError(403, 'csrf_invalido', $c->enviar('DELETE', '/api/sesion', [], ['x-csrf-token' => str_repeat('0', 64)]));
        $this->assertError(403, 'csrf_invalido', $c->enviar('DELETE', '/api/sesion', [], ['x-csrf-token' => '']));
        $this->assertSame(200, $c->get('/api/sesion')->estado, 'la sesión sigue viva');

        // El token de otra sesión no sirve.
        $otro = $this->cliente('10.0.0.7')->comoUsuario($this->crearUsuario());
        $this->assertError(403, 'csrf_invalido', $c->enviar('DELETE', '/api/sesion', [], ['x-csrf-token' => $otro->csrf]));
        $this->assertSame(204, $c->delete('/api/sesion')->estado);
    }

    public function test_escritura_sin_sesion_da_401(): void
    {
        $this->assertError(401, 'sin_sesion', $this->cliente()->enviar('DELETE', '/api/sesion', [], ['x-csrf-token' => str_repeat('0', 64)]));
        $this->assertError(401, 'sin_sesion', $this->cliente()->get('/api/sesion'));
    }

    public function test_sesion_expira_por_inactividad(): void
    {
        $c = $this->cliente()->comoUsuario($this->crearUsuario());
        $this->reloj->avanzar(7199);
        $this->assertSame(200, $c->get('/api/sesion')->estado, 'cada petición renueva la inactividad');
        $this->reloj->avanzar(7199);
        $this->assertSame(200, $c->get('/api/sesion')->estado);
        $id = $c->cookie;

        $this->reloj->avanzar(7201);
        $r = $c->get('/api/sesion');
        $this->assertError(401, 'sin_sesion', $r);
        $this->assertStringContainsString('Max-Age=0', (string) $this->setCookie($r), 'borra la cookie');
        $this->assertArrayNotHasKey((string) $id, $this->sesiones->sesiones, 'la sesión vencida se destruye');
    }

    public function test_sesion_expira_a_las_12_horas_aunque_haya_actividad(): void
    {
        $c = $this->cliente()->comoUsuario($this->crearUsuario());
        for ($h = 1; $h <= 11; $h++) {
            $this->reloj->avanzar(3600);
            $this->assertSame(200, $c->get('/api/sesion')->estado, "hora $h");
        }
        $this->reloj->avanzar(3599);
        $this->assertSame(200, $c->get('/api/sesion')->estado);
        $this->reloj->avanzar(2);
        $this->assertError(401, 'sin_sesion', $c->get('/api/sesion'));
    }

    public function test_logout_invalida_la_sesion(): void
    {
        $u = $this->crearUsuario();
        $c = $this->cliente()->comoUsuario($u);
        $id = $c->cookie;
        $csrf = $c->csrf;

        $r = $c->delete('/api/sesion');
        $this->assertSame(204, $r->estado);
        $this->assertStringStartsWith('mm_sesion=;', (string) $this->setCookie($r));
        $this->assertStringContainsString('Max-Age=0', (string) $this->setCookie($r));
        $this->assertSame([], $this->sesiones->sesiones);

        // Reusar la cookie y el token robados no sirve.
        $c->cookie = $id;
        $c->csrf = $csrf;
        $this->assertError(401, 'sin_sesion', $c->get('/api/sesion'));
        $this->assertError(401, 'sin_sesion', $c->delete('/api/sesion'));

        $acciones = self::$bd->query('SELECT accion FROM auditoria ORDER BY id')->fetchAll(\PDO::FETCH_COLUMN);
        $this->assertSame(['inicio_sesion', 'cierre_sesion'], $acciones);
    }

    public function test_regenera_id_al_entrar(): void
    {
        $u = $this->crearUsuario();
        $c = $this->cliente();

        // Fijación: un id impuesto por un atacante nunca se adopta.
        $c->cookie = 'idfijadoporelatacante0123456789';
        $this->login($c, $u['correo'], $u['clave']);
        $this->assertNotSame('idfijadoporelatacante0123456789', $c->cookie);
        $this->assertArrayNotHasKey('idfijadoporelatacante0123456789', $this->sesiones->sesiones);

        // Volver a entrar con sesión abierta cambia el id y el token, y mata el id anterior.
        $id1 = $c->cookie;
        $csrf1 = $c->csrf;
        $this->assertSame(200, $this->login($c, $u['correo'], $u['clave'])->estado);
        $this->assertNotSame($id1, $c->cookie);
        $this->assertNotSame($csrf1, $c->csrf);
        $this->assertArrayNotHasKey((string) $id1, $this->sesiones->sesiones);

        $viejo = $this->cliente();
        $viejo->cookie = $id1;
        $this->assertError(401, 'sin_sesion', $viejo->get('/api/sesion'));
        $this->assertSame(200, $c->get('/api/sesion')->estado);
    }

    public function test_exigir_rol(): void
    {
        $app = $this->app;
        $app->enrutador()->agregar('GET', '/api/prueba/revisor', fn () => Respuesta::json(200, $app->sesion()->exigirRol('revisor', 'admin')));

        $this->assertError(401, 'sin_sesion', $this->cliente()->get('/api/prueba/revisor'));
        $lab = $this->cliente('10.0.0.2')->comoUsuario($this->crearUsuario(['roles' => ['laboratorio']]));
        $this->assertError(403, 'sin_permiso', $lab->get('/api/prueba/revisor'));
        $rev = $this->crearUsuario(['roles' => ['revisor']]);
        $r = $this->cliente('10.0.0.3')->comoUsuario($rev)->get('/api/prueba/revisor');
        $this->assertSame(200, $r->estado);
        $this->assertSame($rev['id'], $r->datos['id']);
        $this->assertSame(['revisor'], $r->datos['roles']);
    }

    public function test_la_sesion_guarda_una_huella_de_la_clave_y_cae_si_cambia(): void
    {
        $u = $this->crearUsuario();
        $c = $this->cliente()->comoUsuario($u);
        $hash = (string) self::$bd->query('SELECT clave_hash FROM usuarios WHERE id = ' . $u['id'])->fetchColumn();
        $datos = $this->sesiones->sesiones[$c->cookie];
        $this->assertSame(substr(hash('sha256', $hash), 0, 16), $datos['huella']);
        $this->assertStringNotContainsString($hash, (string) json_encode($datos), 'la sesión no guarda el hash');

        // El mismo hash (p. ej. reactivar la cuenta) no la invalida; uno distinto sí, y la destruye.
        $this->assertSame(200, $c->get('/api/sesion')->estado);
        $id = $c->cookie;
        self::$bd->prepare('UPDATE usuarios SET clave_hash = ? WHERE id = ?')->execute([$hash . 'x', $u['id']]);
        $this->assertError(401, 'sin_sesion', $c->get('/api/sesion'));
        $this->assertArrayNotHasKey((string) $id, $this->sesiones->sesiones);
    }

    public function test_sesion_sin_huella_no_se_acepta(): void
    {
        $u = $this->crearUsuario();
        $c = $this->cliente()->comoUsuario($u);
        unset($this->sesiones->sesiones[$c->cookie]['huella']);
        $this->assertError(401, 'sin_sesion', $c->get('/api/sesion'));
    }
}
