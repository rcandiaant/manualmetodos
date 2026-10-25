<?php

declare(strict_types=1);

namespace Manual\Seguridad;

/**
 * Sesiones nativas de PHP para producción.
 *
 * - use_strict_mode=1: PHP no adopta ids que no generó (fijación de sesión).
 * - use_cookies=0: PHP no emite la cookie; la emite Sesion a través de Respuesta con
 *   HttpOnly, SameSite=Strict y Secure según COOKIE_SEGURA (los session.cookie_* quedan
 *   configurados igual, como defensa en profundidad).
 * - Cada operación abre y cierra la sesión enseguida: no se mantiene el bloqueo del archivo.
 * - $ruta permite guardar las sesiones en una carpeta propia fuera de la raíz web, para que
 *   la limpieza del hosting (que usa su propio gc_maxlifetime) no corte sesiones antes de tiempo.
 */
final class AlmacenSesionNativa implements AlmacenSesion
{
    private const ID_VALIDO = '/^[A-Za-z0-9,-]{22,256}$/D';

    public function __construct(bool $cookieSegura, ?string $ruta = null)
    {
        if ($ruta !== null) {
            if (!is_dir($ruta)) {
                @mkdir($ruta, 0700, true); // falla si existe un archivo con ese nombre o sin permisos
            }
            if (!is_dir($ruta) || !is_writable($ruta)) {
                // Al cliente le llega 500 error_interno; el detalle queda solo en el log del servidor.
                $mensaje = "Carpeta de sesiones no disponible o sin permiso de escritura: $ruta"
                    . ' (créela por FTP con permisos 0700 para el usuario de PHP, fuera de public/).';
                error_log($mensaje);
                throw new \RuntimeException($mensaje);
            }
            ini_set('session.save_path', $ruta);
        }
        $ini = [
            'session.name' => Sesion::COOKIE,
            'session.use_strict_mode' => '1',
            'session.use_cookies' => '0',
            'session.use_only_cookies' => '1',
            'session.use_trans_sid' => '0',
            'session.cookie_httponly' => '1',
            'session.cookie_samesite' => 'Strict',
            'session.cookie_secure' => $cookieSegura ? '1' : '0',
            'session.cookie_path' => '/',
            'session.cache_limiter' => '',
            'session.gc_maxlifetime' => (string) Sesion::ABSOLUTA,
            'session.gc_probability' => '1',
            'session.gc_divisor' => '100',
        ];
        foreach ($ini as $clave => $valor) {
            if (ini_set($clave, $valor) === false) {
                throw new \RuntimeException("No se pudo configurar $clave");
            }
        }
    }

    public function cargar(string $id): ?array
    {
        if (!$this->abrir($id)) {
            return null;
        }
        $datos = $_SESSION;
        session_abort(); // solo lectura: libera el bloqueo sin escribir
        return $datos;
    }

    public function guardar(string $id, array $datos): void
    {
        if (!$this->abrir($id)) {
            throw new \LogicException('La sesión no existe.');
        }
        $_SESSION = $datos;
        session_write_close();
    }

    public function regenerar(?string $idActual): string
    {
        if ($idActual === null || !$this->abrir($idActual)) {
            $this->iniciar();
        }
        if (!session_regenerate_id(true)) {
            throw new \RuntimeException('No se pudo regenerar el id de sesión.');
        }
        $_SESSION = [];
        $nuevo = session_id();
        session_write_close();
        if (!is_string($nuevo) || $nuevo === '') {
            throw new \RuntimeException('Id de sesión vacío.');
        }
        return $nuevo;
    }

    public function destruir(string $id): void
    {
        if ($this->abrir($id)) {
            $_SESSION = [];
            session_destroy();
        }
    }

    /** Abre la sesión $id solo si ya existe en el servidor. */
    private function abrir(string $id): bool
    {
        $this->cerrarActiva();
        if (preg_match(self::ID_VALIDO, $id) !== 1) {
            return false;
        }
        session_id($id);
        $this->iniciar();
        if (session_id() !== $id) {
            // El modo estricto rechazó el id y creó otro: se descarta.
            session_destroy();
            return false;
        }
        return true;
    }

    private function iniciar(): void
    {
        $this->cerrarActiva();
        if (!session_start()) {
            throw new \RuntimeException('No se pudo iniciar la sesión.');
        }
    }

    private function cerrarActiva(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
    }
}
