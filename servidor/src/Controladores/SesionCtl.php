<?php

declare(strict_types=1);

namespace Manual\Controladores;

use Manual\Acceso\Auditoria;
use Manual\Acceso\Usuarios;
use Manual\Http\ErrorHttp;
use Manual\Http\Peticion;
use Manual\Http\Respuesta;
use Manual\Seguridad\Claves;
use Manual\Seguridad\Csrf;
use Manual\Seguridad\LimiteIntentos;
use Manual\Seguridad\Sesion;

/** POST /api/sesion (entrar), GET /api/sesion (actual), DELETE /api/sesion (salir). */
final class SesionCtl
{
    public const LARGO_MAX_CORREO = 254;
    public const LARGO_MAX_CLAVE = 1024;

    public function __construct(
        private readonly Sesion $sesion,
        private readonly Usuarios $usuarios,
        private readonly LimiteIntentos $limite,
        private readonly Auditoria $auditoria,
    ) {
    }

    /**
     * Mismo estado, cuerpo y cabeceras para correo inexistente, clave errónea, cuenta inactiva
     * y honeypot lleno. Siempre se verifica un hash Argon2id (el ficticio si no hay usuario).
     */
    public function entrar(Peticion $p): Respuesta
    {
        $e = $p->json();
        $correo = $e['correo'] ?? null;
        $clave = $e['clave'] ?? null;
        $trampa = $e['sitio_web'] ?? '';
        $campos = [];
        if (!is_string($correo) || trim($correo) === '' || mb_strlen($correo) > self::LARGO_MAX_CORREO) {
            $campos['correo'] = 'Obligatorio, texto de hasta ' . self::LARGO_MAX_CORREO . ' caracteres.';
        }
        if (!is_string($clave) || $clave === '' || strlen($clave) > self::LARGO_MAX_CLAVE) {
            $campos['clave'] = 'Obligatoria, texto de hasta ' . self::LARGO_MAX_CLAVE . ' bytes.';
        }
        if (!is_string($trampa)) {
            $campos['sitio_web'] = 'Debe ser texto.';
        }
        if ($campos !== []) {
            throw new ErrorHttp(400, 'entrada_invalida', 'Datos de acceso incompletos o inválidos.', $campos);
        }

        $claves = ['ip:' . $p->ip, 'cuenta:' . bin2hex($this->usuarios->indice($correo))];
        // El intento se cuenta ANTES de verificar la clave: en paralelo no se prueban más de 5.
        $espera = $this->limite->reservar($claves);
        foreach ($this->limite->bloqueadasAlReservar as $bloqueada) {
            $this->auditoria->registrar(null, 'bloqueo_login', 'intentos_login', null, ['clave' => $bloqueada]);
        }
        if ($espera > 0) {
            return Respuesta::error(429, 'demasiados_intentos', 'Demasiados intentos. Espere antes de volver a intentar.', [], ['Retry-After' => (string) $espera]);
        }

        $u = $this->usuarios->porCorreo($correo);
        $claveCorrecta = Claves::verificar($clave, $u['clave_hash'] ?? Claves::hashFicticio());
        if (!$claveCorrecta || $u === null || !$u['activo'] || $trampa !== '') {
            $this->auditoria->registrar(null, 'login_fallido', 'sesion', null, ['ip' => $p->ip, 'cuenta' => $claves[1]]);
            foreach ($this->limite->confirmarFallo($claves) as $bloqueada) {
                $this->auditoria->registrar(null, 'bloqueo_login', 'intentos_login', null, ['clave' => $bloqueada]);
            }
            return Respuesta::error(401, 'credenciales_invalidas', 'Correo o clave incorrectos.');
        }

        $this->limite->confirmarExito($claves);
        $csrf = Csrf::generar();
        $this->sesion->iniciar($u['id'], $csrf);
        $this->auditoria->registrar($u['id'], 'inicio_sesion', 'usuario', $u['id'], ['ip' => $p->ip]);
        return Respuesta::json(200, ['usuario' => Usuarios::dto($u), 'csrf' => $csrf]);
    }

    public function actual(Peticion $p): Respuesta
    {
        $u = $this->sesion->exigirRol();
        return Respuesta::json(200, ['usuario' => $u, 'csrf' => $this->sesion->tokenCsrf()]);
    }

    public function salir(Peticion $p): Respuesta
    {
        $u = $this->sesion->usuarioActual();
        $this->sesion->cerrar();
        if ($u !== null) {
            $this->auditoria->registrar($u['id'], 'cierre_sesion', 'usuario', $u['id']);
        }
        return Respuesta::vacia(204);
    }
}
