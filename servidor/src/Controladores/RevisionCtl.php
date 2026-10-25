<?php

declare(strict_types=1);

namespace Manual\Controladores;

use Manual\Acceso\Auditoria;
use Manual\Acceso\Capitulos;
use Manual\Acceso\Comentarios;
use Manual\Acceso\Consulta;
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

/**
 * Trabajo del revisor (aportes de todos, resolución, versión final) y la vista del laboratorio sobre
 * la resolución de sus propios aportes. El revisor entra por los métodos «todas…» de la capa de acceso,
 * que solo se llaman tras exigirRol('revisor'). Orden de comprobación: rol, etapa (409), capítulo (404), entrada.
 */
final class RevisionCtl
{
    public const MAX_NOTA = 2000;
    public const MAX_TEX = 1048576;
    public const ESTADOS_SUGERENCIA = ['pendiente', 'aceptada', 'rechazada', 'modificada'];
    public const ESTADOS_COMENTARIO = ['abierto', 'resuelto'];

    public function __construct(
        private readonly Sesion $sesion,
        private readonly Capitulos $capitulos,
        private readonly Sugerencias $sugerencias,
        private readonly Comentarios $comentarios,
        private readonly Consulta $consulta,
        private readonly Auditoria $auditoria,
        private readonly Reloj $reloj,
    ) {
    }

    /** GET /capitulos/{id}/aportes: todas las sugerencias y comentarios, con laboratorio. Etapas consulta y edicion_final. */
    public function aportes(Peticion $p, array $params): Respuesta
    {
        $this->sesion->exigirRol(Rol::REVISOR);
        if ($this->consulta->etapa() === Etapa::PREPARACION) {
            throw new ErrorHttp(409, 'etapa_no_permite', 'Aún no hay aportes: la consulta no se ha abierto.');
        }
        $cap = $this->capituloExistente($params);
        return Respuesta::json(200, [
            'sugerencias' => $this->sugerencias->todasDelCapitulo($cap),
            'comentarios' => $this->comentarios->todosDelCapitulo($cap),
        ]);
    }

    /** GET /capitulos/{id}/mis-aportes: solo los propios, con la resolución. Solo edicion_final. */
    public function misAportes(Peticion $p, array $params): Respuesta
    {
        $u = $this->sesion->exigirRol(Rol::LABORATORIO);
        $this->exigirEtapa(Etapa::EDICION_FINAL, 'La resolución de sus aportes se publica al terminar la consulta.');
        $cap = $this->capituloExistente($params);
        return Respuesta::json(200, [
            'sugerencias' => $this->sugerencias->propiasConResolucion($u['id'], $cap),
            'comentarios' => $this->comentarios->propiosConResolucion($u['id'], $cap),
        ]);
    }

    /** PATCH /sugerencias/{id} `{estado, notaResolucion?, derivadaReunion?}`. */
    public function resolverSugerencia(Peticion $p, array $params): Respuesta
    {
        $u = $this->sesion->exigirRol(Rol::REVISOR);
        $this->exigirEtapa(Etapa::EDICION_FINAL, 'Las sugerencias se resuelven después del cierre de la consulta.');
        $e = $p->json();
        $estado = Entrada::enumeracion($e, 'estado', self::ESTADOS_SUGERENCIA);
        $nota = self::nota($e);
        $derivada = $e['derivadaReunion'] ?? false;
        if (!is_bool($derivada)) {
            throw Entrada::invalido('derivadaReunion', 'debe ser verdadero o falso');
        }
        $id = (int) $params['id'];
        $ok = $this->sugerencias->resolver($id, $estado, $nota, $derivada, $u['id'], $this->reloj->ahora(), function (array $previo) use ($u, $id, $estado, $derivada, $nota): void {
            $this->auditoria->registrar($u['id'], 'resolver_sugerencia', 'sugerencia', $id, [
                'capituloId' => $previo['capituloId'],
                'anterior' => $previo['estado'],
                'nuevo' => $estado,
                'derivadaAnterior' => $previo['derivadaReunion'],
                'derivadaReunion' => $derivada,
                'conNota' => $nota !== null,
            ]);
        });
        if (!$ok) {
            throw new ErrorHttp(404, 'no_encontrado', 'Sugerencia no encontrada.');
        }
        return Respuesta::json(200, ['id' => $id]);
    }

    /** PATCH /comentarios/{id}/resolucion `{estado, notaResolucion?}`. */
    public function resolverComentario(Peticion $p, array $params): Respuesta
    {
        $u = $this->sesion->exigirRol(Rol::REVISOR);
        $this->exigirEtapa(Etapa::EDICION_FINAL, 'Los comentarios se resuelven después del cierre de la consulta.');
        $e = $p->json();
        $estado = Entrada::enumeracion($e, 'estado', self::ESTADOS_COMENTARIO);
        $nota = self::nota($e);
        $id = (int) $params['id'];
        $ok = $this->comentarios->resolver($id, $estado, $nota, $u['id'], $this->reloj->ahora(), function (array $previo) use ($u, $id, $estado, $nota): void {
            $this->auditoria->registrar($u['id'], 'resolver_comentario', 'comentario', $id, [
                'capituloId' => $previo['capituloId'],
                'anterior' => $previo['estado'],
                'nuevo' => $estado,
                'conNota' => $nota !== null,
            ]);
        });
        if (!$ok) {
            throw new ErrorHttp(404, 'no_encontrado', 'Comentario no encontrado.');
        }
        return Respuesta::json(200, ['id' => $id]);
    }

    /** PUT /capitulos/{id}/final `{docJson, tex}` → 200 `{versionId}`. Inserta una versión `final` nueva. */
    public function guardarFinal(Peticion $p, array $params): Respuesta
    {
        $u = $this->sesion->exigirRol(Rol::REVISOR);
        $this->exigirEtapa(Etapa::EDICION_FINAL, 'La versión final se guarda después del cierre de la consulta.');
        $cap = $this->capituloExistente($params);
        $o = $p->jsonObjeto();
        $tex = $o->tex ?? null;
        if (!is_string($tex) || $tex === '' || strlen($tex) > self::MAX_TEX || !mb_check_encoding($tex, 'UTF-8')) {
            throw Entrada::invalido('tex', 'debe ser texto UTF-8 de hasta 1 MB');
        }
        $doc = $o->docJson ?? null;
        if (!$doc instanceof \stdClass) {
            throw Entrada::invalido('docJson', 'debe ser un documento (objeto JSON)');
        }
        ValidadorDocumento::validar($doc);
        // Se guarda lo validado, recodificado: nunca el cuerpo crudo.
        $docJson = json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $versionId = $this->capitulos->guardarFinal($cap, $docJson, $tex, $u['id']);
        $this->auditoria->registrar($u['id'], 'guardar_final', 'capitulo', $cap, [
            'versionId' => $versionId, 'bytesTex' => strlen($tex), 'bytesDoc' => strlen($docJson),
        ]);
        return Respuesta::json(200, ['versionId' => $versionId]);
    }

    /** GET /capitulos/{id}/final → `{versionId, docJson, tex}` de la última final; 404 si no hay. */
    public function verFinal(Peticion $p, array $params): Respuesta
    {
        $this->sesion->exigirRol(Rol::REVISOR);
        $cap = $this->capituloExistente($params);
        $f = $this->capitulos->ultimaFinal($cap);
        if ($f === null) {
            throw new ErrorHttp(404, 'no_encontrado', 'El capítulo aún no tiene versión final.');
        }
        return Respuesta::json(200, [
            'versionId' => $f['versionId'],
            'docJson' => json_decode($f['docJson'], false, 512, JSON_THROW_ON_ERROR),
            'tex' => $f['tex'],
        ]);
    }

    /** Nota opcional de 0 a 2000 caracteres; ausente, null o vacía = sin nota. */
    private static function nota(array $e): ?string
    {
        $v = $e['notaResolucion'] ?? null;
        if ($v === null) {
            return null;
        }
        return Entrada::texto($e, 'notaResolucion', self::MAX_NOTA, 0) === '' ? null : $v;
    }

    private function capituloExistente(array $params): int
    {
        $id = (int) $params['id'];
        if ($this->capitulos->versionBaseVigente($id) === null) {
            throw new ErrorHttp(404, 'no_encontrado', 'Capítulo no encontrado.');
        }
        return $id;
    }

    private function exigirEtapa(string $etapa, string $mensaje): void
    {
        if ($this->consulta->etapa() !== $etapa) {
            throw new ErrorHttp(409, 'etapa_no_permite', $mensaje);
        }
    }
}
