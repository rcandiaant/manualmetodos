<?php

declare(strict_types=1);

namespace Manual\Controladores;

use Manual\Acceso\Capitulos;
use Manual\Acceso\Comentarios;
use Manual\Acceso\Sugerencias;
use Manual\Http\ErrorHttp;
use Manual\Http\Peticion;
use Manual\Http\Respuesta;
use Manual\Seguridad\Sesion;

/** GET /api/capitulos y GET /api/capitulos/{id}/base: para cualquier usuario con sesión. */
final class CapitulosCtl
{
    public const CACHE_CONTROL = 'private, max-age=0, must-revalidate';

    public function __construct(
        private readonly Sesion $sesion,
        private readonly Capitulos $capitulos,
        private readonly Sugerencias $sugerencias,
        private readonly Comentarios $comentarios,
    ) {
    }

    /** `[{id, orden, slug, titulo, misCambios, misComentarios}]`: los conteos son del usuario de la sesión. */
    public function listar(Peticion $p): Respuesta
    {
        $u = $this->sesion->exigirRol();
        $cambios = $this->sugerencias->conteoPorCapitulo($u['id']);
        $comentarios = $this->comentarios->conteoPorCapitulo($u['id']);
        $lista = array_map(fn (array $c): array => $c + [
            'misCambios' => $cambios[$c['id']] ?? 0,
            'misComentarios' => $comentarios[$c['id']] ?? 0,
        ], $this->capitulos->listar());
        return Respuesta::json(200, $lista);
    }

    /** `{versionId, docJson}` de la versión base vigente, con ETag `"v<versionId>"` y 304 si coincide. */
    public function base(Peticion $p, array $params): Respuesta
    {
        $this->sesion->exigirRol();
        $versionId = $this->capitulos->versionBaseVigente((int) $params['id']);
        if ($versionId === null) {
            throw new ErrorHttp(404, 'no_encontrado', 'Capítulo no encontrado.');
        }
        $etag = "\"v$versionId\"";
        $cabeceras = ['ETag' => $etag, 'Cache-Control' => self::CACHE_CONTROL];
        // El 304 no necesita el documento: basta la versión vigente.
        if (self::coincide($p->cabecera('if-none-match'), $etag)) {
            return Respuesta::vacia(304)->conCabeceras($cabeceras);
        }
        $doc = $this->capitulos->docBase($versionId);
        if ($doc === null) {
            throw new ErrorHttp(404, 'no_encontrado', 'Capítulo no encontrado.');
        }
        // Como objetos, para que un `{}` del documento vuelva como `{}`.
        return Respuesta::json(200, [
            'versionId' => $versionId,
            'docJson' => json_decode($doc, false, 512, JSON_THROW_ON_ERROR),
        ], $cabeceras);
    }

    /** If-None-Match: lista separada por comas, con o sin prefijo débil `W/`, o `*`. */
    private static function coincide(?string $ifNoneMatch, string $etag): bool
    {
        if ($ifNoneMatch === null) {
            return false;
        }
        foreach (explode(',', $ifNoneMatch) as $candidato) {
            $candidato = trim($candidato);
            if ($candidato === '*' || $candidato === $etag || $candidato === 'W/' . $etag) {
                return true;
            }
        }
        return false;
    }
}
