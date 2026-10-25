<?php

declare(strict_types=1);

namespace Manual\Controladores;

use Manual\Acceso\Capitulos;
use Manual\Acceso\Consulta;
use Manual\Acceso\Copias;
use Manual\Acceso\Sugerencias;
use Manual\Dominio\Etapa;
use Manual\Dominio\Rol;
use Manual\Http\ErrorHttp;
use Manual\Http\Peticion;
use Manual\Http\Respuesta;
use Manual\Reloj;
use Manual\Seguridad\Sesion;
use Manual\Validacion\Entrada;
use Manual\Validacion\ValidadorDocumento;
use Manual\Validacion\ValidadorSugerencia;

/**
 * Copia de trabajo del laboratorio y sus sugerencias. El usuario sale siempre de la sesión:
 * nunca se lee `usuario_id`, `autor` ni `estado` del cuerpo.
 */
final class CopiaCtl
{
    public const MAX_SUGERENCIAS = 2000;
    private const JSON = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR;

    public function __construct(
        private readonly Sesion $sesion,
        private readonly Capitulos $capitulos,
        private readonly Copias $copias,
        private readonly Sugerencias $sugerencias,
        private readonly Consulta $consulta,
        private readonly Reloj $reloj,
    ) {
    }

    /** `{docJson, actualizado, versionId, sugerencias[]}` (solo las propias) o `{docJson: null}`. */
    public function ver(Peticion $p, array $params): Respuesta
    {
        $u = $this->sesion->exigirRol(Rol::LABORATORIO);
        $cap = $this->capituloExistente($params);
        $copia = $this->copias->leer($u['id'], $cap['id']);
        if ($copia === null) {
            return Respuesta::json(200, ['docJson' => null]);
        }
        return Respuesta::json(200, [
            'docJson' => json_decode($copia['docJson'], false, 512, JSON_THROW_ON_ERROR),
            'actualizado' => Consulta::iso($copia['actualizado']),
            'versionId' => $copia['versionBaseId'],
            'sugerencias' => $this->sugerencias->delCapitulo($u['id'], $cap['id'], $copia['versionBaseId']),
        ]);
    }

    /** PUT `{versionId, docJson, sugerencias[]}`: reemplaza copia y sugerencias propias en una transacción. */
    public function guardar(Peticion $p, array $params): Respuesta
    {
        $u = $this->sesion->exigirRol(Rol::LABORATORIO);
        $this->exigirConsulta();
        $cap = $this->capituloExistente($params);

        $o = $p->jsonObjeto();
        $versionId = $o->versionId ?? null;
        if (!is_int($versionId)) {
            throw Entrada::invalido('versionId', 'debe ser un número entero');
        }
        if ($versionId !== $cap['versionId']) {
            throw new ErrorHttp(409, 'version_obsoleta', 'La versión base cambió: recargue el capítulo.');
        }
        $doc = $o->docJson ?? null;
        if (!$doc instanceof \stdClass) {
            throw Entrada::invalido('docJson', 'debe ser un documento (objeto JSON)');
        }
        ValidadorDocumento::validar($doc);
        $sugerencias = $this->validarSugerencias($o->sugerencias ?? null, Sugerencias::claveAutor($u['id']));

        $ahora = $this->reloj->ahora();
        try {
            // Se guarda lo validado, recodificado: nunca el cuerpo crudo.
            $this->copias->guardar($u['id'], $cap['id'], $versionId, json_encode($doc, self::JSON), $sugerencias, $ahora);
        } catch (\PDOException $e) {
            // Dos guardados simultáneos del mismo laboratorio (p. ej. dos pestañas): interbloqueo (1213) o
            // espera de bloqueo agotada (1205). Cualquier otro error (FK, clave duplicada) es un 500 real.
            if (in_array($e->errorInfo[1] ?? null, [1213, 1205], true)) {
                throw new ErrorHttp(409, 'conflicto_concurrente', 'Otro guardado de esta copia está en curso. Reintente.');
            }
            throw $e;
        }
        return Respuesta::json(200, ['actualizado' => Consulta::iso($ahora)]);
    }

    /** PATCH `{motivo}` de una sugerencia propia de la versión base vigente (vacío = sin motivo). */
    public function motivo(Peticion $p, array $params): Respuesta
    {
        $u = $this->sesion->exigirRol(Rol::LABORATORIO);
        $this->exigirConsulta();
        $cap = $this->capituloExistente($params);
        $motivo = Entrada::texto($p->json(), 'motivo', ValidadorSugerencia::LARGO_MOTIVO, 0);
        $uid = $params['uid'];
        if (!$this->sugerencias->actualizarMotivo($u['id'], $cap['id'], $cap['versionId'], $uid, $motivo)) {
            throw new ErrorHttp(404, 'no_encontrado', 'Sugerencia no encontrada.');
        }
        return Respuesta::json(200, ['id' => $uid, 'motivo' => $motivo === '' ? null : $motivo]);
    }

    /** @return array{id:int,versionId:int} */
    private function capituloExistente(array $params): array
    {
        $id = (int) $params['id'];
        $versionId = $this->capitulos->versionBaseVigente($id);
        if ($versionId === null) {
            throw new ErrorHttp(404, 'no_encontrado', 'Capítulo no encontrado.');
        }
        return ['id' => $id, 'versionId' => $versionId];
    }

    private function exigirConsulta(): void
    {
        if ($this->consulta->etapa() !== Etapa::CONSULTA) {
            throw new ErrorHttp(409, 'etapa_no_permite', 'Las copias y sugerencias solo se pueden modificar durante la consulta.');
        }
    }

    /**
     * Valida cada sugerencia, exige que su id empiece por `<claveAutor>:` y que no se repita.
     * Los errores señalan la posición: `campos["sugerencias[3].id"]`.
     *
     * @return list<array{uid:string,bloqueId:string,tipo:string,grupo:?string,datos:string,motivo:?string}>
     */
    private function validarSugerencias(mixed $lista, string $autor): array
    {
        if (!is_array($lista) || !array_is_list($lista)) {
            throw Entrada::invalido('sugerencias', 'debe ser una lista');
        }
        if (count($lista) > self::MAX_SUGERENCIAS) {
            throw Entrada::invalido('sugerencias', 'no puede tener más de ' . self::MAX_SUGERENCIAS . ' sugerencias por guardado');
        }
        $prefijo = $autor . ':';
        $vistos = [];
        $res = [];
        foreach ($lista as $i => $cruda) {
            $campo = "sugerencias[$i]";
            try {
                $v = ValidadorSugerencia::validar($cruda);
            } catch (ErrorHttp $e) {
                $campos = [];
                foreach ($e->campos as $k => $m) {
                    $campos[$k === 'sugerencia' ? $campo : "$campo.$k"] = $m;
                }
                throw new ErrorHttp($e->estado, $e->codigo, "Sugerencia $i: " . $e->getMessage(), $campos);
            }
            if (!str_starts_with($v['id'], $prefijo) || strlen($v['id']) === strlen($prefijo)) {
                throw new ErrorHttp(400, 'entrada_invalida', "Sugerencia $i: el id debe empezar por «{$prefijo}».", ["$campo.id" => "debe empezar por «{$prefijo}»"]);
            }
            if (isset($vistos[$v['id']])) {
                throw new ErrorHttp(400, 'entrada_invalida', "Sugerencia $i: id repetido.", ["$campo.id" => 'id repetido en este guardado']);
            }
            $vistos[$v['id']] = true;

            $motivo = $v['motivo'] ?? null;
            unset($v['motivo']);
            // Los nodos se guardan en la forma de objetos ya validada (un `{}` sigue siendo `{}`).
            $v['original'] = $cruda->original;
            $v['propuesta'] = $cruda->propuesta;
            $res[] = [
                'uid' => $v['id'],
                'bloqueId' => $v['bloqueId'],
                'tipo' => $v['tipo'],
                'grupo' => $v['grupo'] ?? null,
                'datos' => json_encode($v, self::JSON),
                'motivo' => $motivo === '' ? null : $motivo,
            ];
        }
        return $res;
    }
}
