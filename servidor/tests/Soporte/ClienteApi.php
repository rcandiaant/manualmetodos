<?php

declare(strict_types=1);

namespace Manual\Pruebas\Soporte;

use Manual\Aplicacion;
use Manual\Http\Peticion;
use Manual\Http\Respuesta;

/**
 * Cliente HTTP en proceso: llama a Aplicacion::manejar() y conserva entre llamadas
 * la cookie de sesión (mm_sesion) y el token CSRF, como lo haría el navegador.
 */
final class ClienteApi
{
    public ?string $cookie = null;
    /** mm_sesion, o __Host-mm_sesion con COOKIE_SEGURA=1 */
    public string $nombreCookie = 'mm_sesion';
    public ?string $csrf = null;
    public string $ip = '127.0.0.1';
    public ?Respuesta $ultima = null;

    public function __construct(private readonly Aplicacion $app)
    {
    }

    /** Inicia sesión con $u['correo'] y $u['clave']; falla si no responde 200. */
    public function comoUsuario(array $u): self
    {
        $r = $this->post('/api/sesion', ['correo' => $u['correo'], 'clave' => $u['clave'], 'sitio_web' => '']);
        if ($r->estado !== 200) {
            throw new \RuntimeException('No se pudo iniciar sesión: ' . $r->cuerpo());
        }
        return $this;
    }

    public function get(string $ruta, array $cuerpo = []): Respuesta
    {
        return $this->enviar('GET', $ruta, $cuerpo);
    }

    public function post(string $ruta, array $cuerpo = []): Respuesta
    {
        return $this->enviar('POST', $ruta, $cuerpo);
    }

    public function put(string $ruta, array $cuerpo = []): Respuesta
    {
        return $this->enviar('PUT', $ruta, $cuerpo);
    }

    public function patch(string $ruta, array $cuerpo = []): Respuesta
    {
        return $this->enviar('PATCH', $ruta, $cuerpo);
    }

    public function delete(string $ruta, array $cuerpo = []): Respuesta
    {
        return $this->enviar('DELETE', $ruta, $cuerpo);
    }

    /**
     * @param array<string,mixed>|null $cuerpo null = petición sin cuerpo
     * @param array<string,string|null> $cabeceras extra; con valor null se omite (p. ej. 'x-csrf-token' o 'content-type')
     */
    public function enviar(string $metodo, string $ruta, ?array $cuerpo = [], array $cabeceras = []): Respuesta
    {
        if (!str_starts_with($ruta, '/api')) {
            $ruta = '/api' . $ruta;
        }
        $base = ['content-type' => 'application/json'];
        if ($this->cookie !== null) {
            $base['cookie'] = $this->nombreCookie . '=' . $this->cookie;
        }
        if ($this->csrf !== null && $metodo !== 'GET' && $metodo !== 'HEAD') {
            $base['x-csrf-token'] = $this->csrf;
        }
        $cabeceras = array_change_key_case($cabeceras, CASE_LOWER) + $base;
        $cabeceras = array_filter($cabeceras, fn ($v) => $v !== null);

        $json = '';
        if ($cuerpo !== null && $metodo !== 'GET' && $metodo !== 'HEAD') {
            $json = json_encode($cuerpo === [] ? new \stdClass() : $cuerpo, JSON_THROW_ON_ERROR);
        }
        $r = $this->app->manejar(new Peticion($metodo, $ruta, $cabeceras, $json, $this->ip));
        $this->recordar($r);
        return $this->ultima = $r;
    }

    private function recordar(Respuesta $r): void
    {
        foreach ($r->cabeceras as $nombre => $valor) {
            if (strtolower((string) $nombre) !== 'set-cookie' || preg_match('/^((?:__Host-)?mm_sesion)=([^;]*)/', $valor, $m) !== 1) {
                continue;
            }
            $this->nombreCookie = $m[1];
            $id = $m[2];
            $this->cookie = ($id === '' || str_contains(strtolower($valor), 'max-age=0')) ? null : $id;
            if ($this->cookie === null) {
                $this->csrf = null;
            }
        }
        if ($r->estado === 200 && is_array($r->datos) && isset($r->datos['csrf']) && is_string($r->datos['csrf'])) {
            $this->csrf = $r->datos['csrf'];
        }
    }
}
