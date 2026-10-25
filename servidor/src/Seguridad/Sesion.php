<?php

declare(strict_types=1);

namespace Manual\Seguridad;

use Manual\Acceso\Usuarios;
use Manual\Http\ErrorHttp;
use Manual\Reloj;

/**
 * Sesión de la petición en curso.
 *
 * - Cookie `mm_sesion` con HttpOnly, SameSite=Strict y Path=/; con COOKIE_SEGURA=1 se llama
 *   `__Host-mm_sesion` y lleva Secure.
 * - Al iniciar sesión se regenera el id (el anterior se destruye) y se crea un token CSRF nuevo.
 * - Vence tras 2 h sin actividad o 12 h desde el inicio, lo que ocurra primero.
 * - El usuario se relee de la base en cada petición: desactivarlo o cambiarle roles rige de inmediato.
 * - Guarda una huella de clave_hash (16 hex de su SHA-256, nunca el hash). Si la clave se regenera,
 *   la huella deja de coincidir y la sesión se destruye: todas las sesiones abiertas de esa cuenta caen.
 * La cookie sale en las cabeceras de la Respuesta (Set-Cookie), nunca con header() directo.
 */
final class Sesion
{
    public const COOKIE = 'mm_sesion';
    public const INACTIVIDAD = 7200;
    public const ABSOLUTA = 43200;

    private const ID_VALIDO = '/^[A-Za-z0-9,-]{22,256}$/D';

    /** @var array<string,mixed>|null */
    private ?array $datos = null;
    private bool $cargada = false;
    private ?string $setCookie = null;

    /** @param \Closure(): Usuarios $usuarios perezoso: no conecta a la base si no hace falta */
    public function __construct(
        private readonly AlmacenSesion $almacen,
        private readonly Reloj $reloj,
        private readonly \Closure $usuarios,
        private readonly bool $cookieSegura,
        private ?string $id,
    ) {
        if ($this->id !== null && preg_match(self::ID_VALIDO, $this->id) !== 1) {
            $this->id = null;
        }
    }

    public function activa(): bool
    {
        return $this->datos() !== null;
    }

    public function tokenCsrf(): ?string
    {
        $t = $this->datos()['csrf'] ?? null;
        return is_string($t) ? $t : null;
    }

    /** @return array{id:int,nombre:string,laboratorio:string,roles:list<string>}|null */
    public function usuarioActual(): ?array
    {
        $datos = $this->datos();
        if ($datos === null) {
            return null;
        }
        $u = ($this->usuarios)()->porId((int) $datos['usuario_id']);
        if ($u === null || !$u['activo'] || !hash_equals(self::huella($u['clave_hash']), (string) $datos['huella'])) {
            $this->cerrar();
            return null;
        }
        $datos['ultimo'] = $this->ahora();
        try {
            $this->almacen->guardar((string) $this->id, $datos);
        } catch (\LogicException) {
            // Otra petición (p. ej. un logout en otra pestaña) la destruyó entre cargar y guardar.
            $this->cerrar();
            return null;
        }
        $this->datos = $datos;
        return Usuarios::dto($u);
    }

    /**
     * Exige sesión y, si se indican roles, al menos uno de ellos.
     * @return array{id:int,nombre:string,laboratorio:string,roles:list<string>}
     */
    public function exigirRol(string ...$roles): array
    {
        $u = $this->usuarioActual();
        if ($u === null) {
            throw new ErrorHttp(401, 'sin_sesion', 'Debe iniciar sesión.');
        }
        if ($roles !== [] && array_intersect($roles, $u['roles']) === []) {
            throw new ErrorHttp(403, 'sin_permiso', 'No tiene permiso para esta acción.');
        }
        return $u;
    }

    /** Inicia sesión: id nuevo (el anterior se destruye), marcas de tiempo, huella de la clave y token CSRF. */
    public function iniciar(int $usuarioId, string $claveHash, string $csrf): void
    {
        $this->id = $this->almacen->regenerar($this->id);
        $ahora = $this->ahora();
        $this->datos = ['usuario_id' => $usuarioId, 'huella' => self::huella($claveHash), 'creada' => $ahora, 'ultimo' => $ahora, 'csrf' => $csrf];
        $this->cargada = true;
        $this->almacen->guardar($this->id, $this->datos);
        $this->setCookie = self::nombreCookie($this->cookieSegura) . '=' . $this->id . $this->atributosCookie();
    }

    /**
     * Con HTTPS la cookie lleva el prefijo __Host- (exige Secure, Path=/ y sin Domain): un subdominio
     * no puede plantarla ni pisarla (cookie tossing). En desarrollo sin HTTPS se usa el nombre simple.
     */
    public static function nombreCookie(bool $cookieSegura): string
    {
        return ($cookieSegura ? '__Host-' : '') . self::COOKIE;
    }

    public function cerrar(): void
    {
        if ($this->id !== null) {
            $this->almacen->destruir($this->id);
        }
        $this->id = null;
        $this->datos = null;
        $this->cargada = true;
        $this->setCookie = self::nombreCookie($this->cookieSegura) . '=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT' . $this->atributosCookie();
    }

    /** @return array<string,string> */
    public function cabeceras(): array
    {
        return $this->setCookie === null ? [] : ['Set-Cookie' => $this->setCookie];
    }

    /** @return array<string,mixed>|null */
    private function datos(): ?array
    {
        if ($this->cargada) {
            return $this->datos;
        }
        $this->cargada = true;
        if ($this->id === null) {
            return null;
        }
        $datos = $this->almacen->cargar($this->id);
        if (!is_array($datos) || !isset($datos['usuario_id'], $datos['huella'], $datos['creada'], $datos['ultimo'], $datos['csrf'])) {
            $this->cerrar(); // cookie obsoleta o inventada: se borra
            return null;
        }
        $ahora = $this->ahora();
        if ($ahora - (int) $datos['ultimo'] > self::INACTIVIDAD || $ahora - (int) $datos['creada'] > self::ABSOLUTA) {
            $this->cerrar();
            return null;
        }
        return $this->datos = $datos;
    }

    /** Huella corta de clave_hash: basta para detectar el cambio y no expone el hash en la carpeta de sesiones. */
    private static function huella(string $claveHash): string
    {
        return substr(hash('sha256', $claveHash), 0, 16);
    }

    private function ahora(): int
    {
        return $this->reloj->ahora()->getTimestamp();
    }

    private function atributosCookie(): string
    {
        return '; Path=/; HttpOnly; SameSite=Strict' . ($this->cookieSegura ? '; Secure' : '');
    }
}
