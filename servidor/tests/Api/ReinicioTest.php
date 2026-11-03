<?php

declare(strict_types=1);

namespace Manual\Pruebas\Api;

use Manual\Aplicacion;
use Manual\Mantenimiento\Respaldo;
use Manual\Pruebas\Soporte\AlmacenSesionMemoria;
use Manual\Pruebas\Soporte\BaseDePruebas;
use Manual\Pruebas\Soporte\ClienteApi;
use Manual\Pruebas\Soporte\EscenarioRevision;
use Manual\Pruebas\Soporte\RelojFijo;
use PHPUnit\Framework\TestCase;

/** POST /api/admin/reiniciar: «Reiniciar datos de prueba», solo con REINICIO_PRUEBAS=1. */
final class ReinicioTest extends TestCase
{
    use BaseDePruebas;
    use EscenarioRevision;

    private const DATOS = ['comentarios', 'sugerencias', 'revisiones_copia', 'copias_laboratorio'];

    private string $dir;
    /** Valor de REINICIO_PRUEBAS para las aplicaciones que arma montar(); null = ausente. */
    private ?string $bandera = '1';
    /** Directorio de respaldos que recibe la aplicación (null = $this->dir). */
    private ?string $dirApp = null;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/respaldos-reinicio-' . bin2hex(random_bytes(6));
    }

    protected function tearDown(): void
    {
        if (is_dir($this->dir)) {
            foreach (scandir($this->dir) ?: [] as $f) {
                if ($f !== '.' && $f !== '..') {
                    unlink("$this->dir/$f");
                }
            }
            rmdir($this->dir);
        }
    }

    /** Reemplaza la del trait: la aplicación del escenario lleva la bandera y el directorio de respaldos. */
    protected function nuevaAplicacion(RelojFijo $reloj, ?AlmacenSesionMemoria $sesiones = null): Aplicacion
    {
        $extra = $this->bandera === null ? [] : ['REINICIO_PRUEBAS' => $this->bandera];
        return new Aplicacion(self::configPruebas($extra), $reloj, $sesiones ?? new AlmacenSesionMemoria(), self::$bd, $this->dirApp ?? $this->dir);
    }

    private function contar(string $tabla, string $donde = '1'): int
    {
        return (int) self::$bd->query("SELECT COUNT(*) FROM `$tabla` WHERE $donde")->fetchColumn();
    }

    /** @return array<string,int> */
    private function conteos(): array
    {
        $c = [];
        foreach ([...self::DATOS, 'capitulos', 'versiones_capitulo', 'usuarios', 'auditoria', 'intentos_login'] as $t) {
            $c[$t] = $this->contar($t);
        }
        return $c;
    }

    /** @return list<string> */
    private function respaldos(): array
    {
        return is_dir($this->dir) ? array_values(array_filter(scandir($this->dir) ?: [], fn ($f) => (bool) preg_match(Respaldo::PATRON, $f))) : [];
    }

    private function auditoria(string $accion): array
    {
        $st = self::$bd->prepare('SELECT * FROM auditoria WHERE accion = ? ORDER BY id');
        $st->execute([$accion]);
        return $st->fetchAll();
    }

    public function test_reinicio_respalda_borra_los_aportes_y_conserva_lo_demas(): void
    {
        $this->montar();
        // Edición final con una decisión del revisor y una versión final.
        $this->cerrarConsulta();
        self::assertSame(200, $this->revisor->patch("/sugerencias/{$this->sugIds[0]}", ['estado' => 'aceptada'])->estado);
        self::assertSame(200, $this->revisor->put("/capitulos/{$this->cap}/final", ['docJson' => $this->docFinal(), 'tex' => 'x'])->estado);
        // Un intento de login fallido (intentos_login) que debe conservarse.
        (new ClienteApi($this->app))->post('/sesion', ['correo' => 'nadie@lab.cl', 'clave' => 'mala-clave-123', 'sitio_web' => '']);
        self::$bd->exec('UPDATE consulta SET motivo_obligatorio = 1');
        $antes = $this->conteos();
        self::assertGreaterThan(0, $antes['intentos_login']);
        $revisiones = $antes['revisiones_copia'];
        self::assertGreaterThan(0, $revisiones);

        $r = $this->admin->post('/admin/reiniciar', ['confirmacion' => 'REINICIAR']);
        self::assertSame(200, $r->estado, $r->cuerpo());
        self::assertSame([
            'comentarios' => 2, 'sugerencias' => 2, 'revisiones_copia' => $revisiones, 'copias_laboratorio' => 2, 'versiones_final' => 1,
        ], $r->datos['borrados']);

        // El respaldo existe, es el que se informa y tiene los datos de antes del borrado.
        self::assertSame([$r->datos['respaldo']], $this->respaldos());
        $sql = (string) gzdecode((string) file_get_contents($this->dir . '/' . $r->datos['respaldo']));
        self::assertStringContainsString('Comentario a', $sql);

        $despues = $this->conteos();
        foreach (self::DATOS as $t) {
            self::assertSame(0, $despues[$t], $t);
        }
        self::assertSame(0, $this->contar('versiones_capitulo', "tipo = 'final'"));
        self::assertSame(1, $this->contar('versiones_capitulo', "tipo = 'base'"));
        self::assertSame($antes['capitulos'], $despues['capitulos']);
        self::assertSame($antes['usuarios'], $despues['usuarios']);
        self::assertSame($antes['intentos_login'], $despues['intentos_login']);
        self::assertGreaterThan($antes['auditoria'], $despues['auditoria'], 'la auditoría se conserva y crece');
        self::assertSame([null, null, 1], self::$bd->query('SELECT apertura, cierre, motivo_obligatorio FROM consulta')->fetch(\PDO::FETCH_NUM));

        $aud = $this->auditoria('reiniciar_pruebas');
        self::assertCount(1, $aud);
        $detalle = json_decode((string) $aud[0]['detalle'], true);
        self::assertSame($r->datos['respaldo'], $detalle['respaldo']);
        self::assertSame($r->datos['borrados'], $detalle['borrados']);

        // Vuelve a preparación, sin aportes; el capítulo sigue legible.
        $g = $this->admin->get('/consulta')->datos;
        self::assertSame('preparacion', $g['etapa']);
        self::assertSame(0, $g['aportes']);
        self::assertSame(0, $g['decisionesTomadas']);
        self::assertTrue($g['reinicioPermitido']);
        self::assertSame(200, $this->lab->get("/capitulos/{$this->cap}/base")->estado);
        self::assertNull($this->lab->get("/capitulos/{$this->cap}/copia")->datos['docJson']);
    }

    public function test_confirmacion_distinta_da_400_y_no_toca_nada(): void
    {
        $this->montar();
        $antes = $this->conteos();
        foreach ([[], ['confirmacion' => 'reiniciar'], ['confirmacion' => 'REINICIAR '], ['confirmacion' => 'SI'], ['confirmacion' => true], ['confirmacion' => null]] as $i => $cuerpo) {
            $r = $this->admin->post('/admin/reiniciar', $cuerpo);
            self::assertSame(400, $r->estado, "caso $i: " . $r->cuerpo());
            self::assertSame('entrada_invalida', $r->datos['error']['codigo']);
            self::assertArrayHasKey('confirmacion', $r->datos['error']['campos']);
        }
        self::assertSame($antes, $this->conteos());
        self::assertSame([], $this->respaldos());
    }

    public function test_exige_admin_y_csrf(): void
    {
        $this->montar();
        $antes = $this->conteos();
        foreach ([$this->lab, $this->revisor] as $c) {
            self::assertSame(403, $c->post('/admin/reiniciar', ['confirmacion' => 'REINICIAR'])->estado);
        }
        self::assertSame(401, (new ClienteApi($this->app))->post('/admin/reiniciar', ['confirmacion' => 'REINICIAR'])->estado);
        $r = $this->admin->enviar('POST', '/admin/reiniciar', ['confirmacion' => 'REINICIAR'], ['x-csrf-token' => null]);
        self::assertSame(403, $r->estado);
        self::assertSame('csrf_invalido', $r->datos['error']['codigo']);
        self::assertSame($antes, $this->conteos());
        self::assertSame([], $this->respaldos());
    }

    public function test_sin_la_bandera_la_ruta_no_existe(): void
    {
        foreach ([null, '0', '', 'si', 'true', '1 '] as $valor) {
            $this->bandera = $valor;
            $this->montar();
            $antes = $this->conteos();
            $r = $this->admin->post('/admin/reiniciar', ['confirmacion' => 'REINICIAR']);
            self::assertSame(404, $r->estado, var_export($valor, true));
            self::assertSame('no_encontrado', $r->datos['error']['codigo']);
            self::assertFalse($this->admin->get('/consulta')->datos['reinicioPermitido']);
            self::assertSame($antes, $this->conteos());
        }
        self::assertSame([], $this->respaldos());
    }

    public function test_si_falla_el_respaldo_da_500_y_no_borra_nada(): void
    {
        // Un archivo donde debería ir el directorio: el respaldo no puede crearse.
        $this->dirApp = tempnam(sys_get_temp_dir(), 'no-es-dir');
        try {
            $this->montar();
            $antes = $this->conteos();
            $consulta = self::$bd->query('SELECT apertura, cierre FROM consulta')->fetch(\PDO::FETCH_NUM);
            $r = $this->admin->post('/admin/reiniciar', ['confirmacion' => 'REINICIAR']);
            self::assertSame(500, $r->estado, $r->cuerpo());
            self::assertSame('respaldo_fallido', $r->datos['error']['codigo']);
            self::assertStringContainsString('no se borró nada', $r->datos['error']['mensaje']);
            self::assertSame($antes, $this->conteos());
            self::assertSame($consulta, self::$bd->query('SELECT apertura, cierre FROM consulta')->fetch(\PDO::FETCH_NUM));
            self::assertCount(0, $this->auditoria('reiniciar_pruebas'));
        } finally {
            @unlink($this->dirApp);
        }
    }
}
