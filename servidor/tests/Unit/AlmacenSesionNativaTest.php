<?php

declare(strict_types=1);

namespace Manual\Pruebas\Unit;

use Manual\Seguridad\AlmacenSesionNativa;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use PHPUnit\Framework\TestCase;

/**
 * Sesiones nativas de PHP (producción). Cada test corre en su propio proceso
 * porque la extensión session guarda estado global y exige que no se hayan enviado cabeceras.
 */
#[RunTestsInSeparateProcesses]
#[PreserveGlobalState(false)]
final class AlmacenSesionNativaTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/mm-sesiones-' . bin2hex(random_bytes(4));
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/*') ?: [] as $f) {
            unlink($f);
        }
        if (is_dir($this->dir)) {
            rmdir($this->dir);
        }
    }

    public function test_configura_php_de_forma_segura(): void
    {
        new AlmacenSesionNativa(true, $this->dir);
        $this->assertSame('1', ini_get('session.use_strict_mode'));
        $this->assertSame('0', ini_get('session.use_cookies'), 'la cookie la emite Sesion por Respuesta');
        $this->assertSame('1', ini_get('session.use_only_cookies'));
        $this->assertSame('0', ini_get('session.use_trans_sid'));
        $this->assertSame('1', ini_get('session.cookie_httponly'));
        $this->assertSame('1', ini_get('session.cookie_secure'));
        $this->assertSame('Strict', ini_get('session.cookie_samesite'));
        $this->assertSame('mm_sesion', ini_get('session.name'));
        $this->assertSame('', ini_get('session.cache_limiter'));
        $this->assertGreaterThanOrEqual(43200, (int) ini_get('session.gc_maxlifetime'));
        $this->assertSame($this->dir, ini_get('session.save_path'));
        $this->assertDirectoryExists($this->dir);
    }

    public function test_carpeta_inutilizable_falla_con_mensaje_claro(): void
    {
        $log = sys_get_temp_dir() . '/mm-log-' . bin2hex(random_bytes(4));
        ini_set('error_log', $log);
        file_put_contents($this->dir, 'un archivo ocupa el lugar de la carpeta');
        try {
            new AlmacenSesionNativa(false, $this->dir);
            $this->fail('Debió fallar');
        } catch (\RuntimeException) {
            $this->assertStringContainsString("Carpeta de sesiones no disponible o sin permiso de escritura: {$this->dir}", (string) file_get_contents($log));
        } finally {
            unlink($this->dir);
            @unlink($log);
        }
    }

    public function test_crea_la_carpeta_con_permisos_0700(): void
    {
        new AlmacenSesionNativa(false, $this->dir . '/sub');
        $this->assertSame('0700', substr(sprintf('%o', fileperms($this->dir . '/sub')), -4));
        rmdir($this->dir . '/sub');
    }

    public function test_ida_y_vuelta_y_regeneracion(): void
    {
        $a = new AlmacenSesionNativa(false, $this->dir);
        $id = $a->regenerar(null);
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9,-]{22,}$/', $id);
        $a->guardar($id, ['usuario_id' => 7]);
        $this->assertSame(['usuario_id' => 7], $a->cargar($id));
        $this->assertSame(PHP_SESSION_NONE, session_status(), 'no deja la sesión abierta (sin bloqueo)');

        $nuevo = $a->regenerar($id);
        $this->assertNotSame($id, $nuevo);
        $this->assertNull($a->cargar($id), 'session_regenerate_id(true) borra la sesión anterior');

        $a->guardar($nuevo, ['x' => 1]);
        $this->assertSame(['x' => 1], $a->cargar($nuevo));
        $a->destruir($nuevo);
        $this->assertNull($a->cargar($nuevo));
        $this->assertSame([], headers_list(), 'no emite cabeceras por su cuenta');
    }

    public function test_modo_estricto_no_adopta_ids_inventados(): void
    {
        $a = new AlmacenSesionNativa(false, $this->dir);
        $this->assertNull($a->cargar('idinventadoporunatacante0123456789'));
        $this->assertNull($a->cargar('id con espacios;y=raros'));
        $this->assertSame([], glob($this->dir . '/sess_idinventadoporunatacante0123456789') ?: []);
        $this->expectException(\LogicException::class);
        $a->guardar('idinventadoporunatacante0123456789', ['usuario_id' => 1]);
    }
}
