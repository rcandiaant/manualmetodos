<?php

declare(strict_types=1);

namespace Manual\Controladores;

use Manual\Acceso\Capitulos;
use Manual\Acceso\Comentarios;
use Manual\Acceso\Consulta;
use Manual\Dominio\Etapa;
use Manual\Dominio\Rol;
use Manual\Http\ErrorHttp;
use Manual\Http\Peticion;
use Manual\Http\Respuesta;
use Manual\Reloj;
use Manual\Seguridad\Sesion;
use Manual\Validacion\Entrada;

/** Comentarios propios del laboratorio. Ajeno e inexistente responden igual: 404. */
final class ComentariosCtl
{
    public const LARGO_TEXTO = 4000;
    public const LARGO_BLOQUE = 190;
    /** Tope de las posiciones de `rango` (un bloque real tiene muchos menos tokens). */
    public const MAX_POSICION = 10_000_000;

    public function __construct(
        private readonly Sesion $sesion,
        private readonly Capitulos $capitulos,
        private readonly Comentarios $comentarios,
        private readonly Consulta $consulta,
        private readonly Reloj $reloj,
    ) {
    }

    public function listar(Peticion $p, array $params): Respuesta
    {
        $u = $this->sesion->exigirRol(Rol::LABORATORIO);
        $cap = $this->capituloExistente($params);
        return Respuesta::json(200, $this->comentarios->delCapitulo($u['id'], $cap));
    }

    /** POST `{bloqueId, rango: {desde, hasta}, texto}` → 201 `{id}`. */
    public function crear(Peticion $p, array $params): Respuesta
    {
        $u = $this->sesion->exigirRol(Rol::LABORATORIO);
        $this->exigirConsulta();
        $cap = $this->capituloExistente($params);
        $e = $p->json();
        $bloqueId = Entrada::texto($e, 'bloqueId', self::LARGO_BLOQUE);
        $rango = self::rango($e['rango'] ?? null);
        $texto = Entrada::texto($e, 'texto', self::LARGO_TEXTO);
        $id = $this->comentarios->crear($u['id'], $cap, $bloqueId, $rango, $texto, $this->reloj->ahora());
        return Respuesta::json(201, ['id' => $id]);
    }

    /** PATCH `{texto}`: solo el texto es editable. */
    public function editar(Peticion $p, array $params): Respuesta
    {
        $u = $this->sesion->exigirRol(Rol::LABORATORIO);
        $this->exigirConsulta();
        $texto = Entrada::texto($p->json(), 'texto', self::LARGO_TEXTO);
        $id = (int) $params['id'];
        if (!$this->comentarios->editarTexto($u['id'], $id, $texto)) {
            throw new ErrorHttp(404, 'no_encontrado', 'Comentario no encontrado.');
        }
        return Respuesta::json(200, ['id' => $id]);
    }

    public function borrar(Peticion $p, array $params): Respuesta
    {
        $u = $this->sesion->exigirRol(Rol::LABORATORIO);
        $this->exigirConsulta();
        if (!$this->comentarios->borrar($u['id'], (int) $params['id'])) {
            throw new ErrorHttp(404, 'no_encontrado', 'Comentario no encontrado.');
        }
        return Respuesta::vacia(204);
    }

    /** @return array{desde:int,hasta:int} */
    private static function rango(mixed $v): array
    {
        if (!is_array($v) || array_is_list($v)) {
            throw Entrada::invalido('rango', 'debe ser un objeto {desde, hasta}');
        }
        $desde = $v['desde'] ?? null;
        $hasta = $v['hasta'] ?? null;
        if (!is_int($desde) || !is_int($hasta) || $desde < 0 || $hasta < 0 || $hasta > self::MAX_POSICION) {
            throw Entrada::invalido('rango', 'desde y hasta deben ser enteros entre 0 y ' . self::MAX_POSICION);
        }
        if ($desde > $hasta) {
            throw Entrada::invalido('rango', 'desde no puede ser mayor que hasta');
        }
        return ['desde' => $desde, 'hasta' => $hasta];
    }

    private function capituloExistente(array $params): int
    {
        $id = (int) $params['id'];
        if ($this->capitulos->versionBaseVigente($id) === null) {
            throw new ErrorHttp(404, 'no_encontrado', 'Capítulo no encontrado.');
        }
        return $id;
    }

    private function exigirConsulta(): void
    {
        if ($this->consulta->etapa() !== Etapa::CONSULTA) {
            throw new ErrorHttp(409, 'etapa_no_permite', 'Los comentarios solo se pueden modificar durante la consulta.');
        }
    }
}
