<?php

declare(strict_types=1);

namespace Manual\Controladores;

use Manual\Acceso\Auditoria;
use Manual\Acceso\Capitulos;
use Manual\Acceso\Consulta;
use Manual\Acceso\Usuarios;
use Manual\Dominio\Rol;
use Manual\Http\ErrorHttp;
use Manual\Http\Peticion;
use Manual\Http\Respuesta;
use Manual\Seguridad\Claves;
use Manual\Seguridad\Sesion;
use Manual\Validacion\Entrada;
use Manual\Validacion\ValidadorDocumento;

/** Rutas /api/admin/*: solo rol admin. Toda acción queda en auditoría, sin claves ni correos. */
final class AdminCtl
{
    public const MAX_TEX = 1048576;
    public const MAX_FILAS_CSV = 100;

    public function __construct(
        private readonly Sesion $sesion,
        private readonly Usuarios $usuarios,
        private readonly Capitulos $capitulos,
        private readonly Consulta $consulta,
        private readonly Auditoria $auditoria,
        private readonly bool $reinicioPermitido = false,
    ) {
    }

    public function listarUsuarios(Peticion $p): Respuesta
    {
        $this->sesion->exigirRol(Rol::ADMIN);
        return Respuesta::json(200, $this->usuarios->listar());
    }

    /** Las claves generadas solo viajan en esta respuesta: no se guardan, ni se registran en log o auditoría. */
    public function importarUsuarios(Peticion $p): Respuesta
    {
        $admin = $this->sesion->exigirRol(Rol::ADMIN);
        $csv = $p->json()['csv'] ?? null;
        if (!is_string($csv)) {
            throw Entrada::invalido('csv', 'debe ser un texto');
        }
        $filas = $this->leerCsv($csv);

        // Cada hash Argon2id tarda: se amplía el límite de ejecución si el hosting lo permite.
        if (function_exists('set_time_limit')) {
            @set_time_limit(120);
        }
        // Los hashes (lentos) se calculan antes de abrir la transacción.
        $respuesta = [];
        $nuevas = [];
        foreach ($filas as $f) {
            $clave = Claves::generar();
            $respuesta[] = ['correo' => $f['correo'], 'clave' => $clave];
            $nuevas[] = ['nombre' => $f['nombre'], 'correo' => $f['correo'], 'laboratorio' => $f['laboratorio'], 'clave_hash' => Claves::hash($clave)];
        }
        try {
            $ids = $this->usuarios->crearLote($nuevas);
        } catch (\PDOException $e) {
            if ((string) $e->getCode() === '23000') { // otro proceso creó uno de los correos entre la verificación y el alta
                throw new ErrorHttp(400, 'entrada_invalida', 'Algún correo ya existe; no se creó ninguna cuenta.', ['csv' => 'Correo ya existente.']);
            }
            throw $e;
        }
        $this->auditoria->registrar($admin['id'], 'importar_usuarios', 'usuario', null, ['cantidad' => count($ids), 'ids' => $ids]);
        return Respuesta::json(201, $respuesta);
    }

    public function regenerarClave(Peticion $p, array $params): Respuesta
    {
        $admin = $this->sesion->exigirRol(Rol::ADMIN);
        $id = (int) $params['id'];
        if ($this->usuarios->porId($id) === null) {
            throw new ErrorHttp(404, 'no_encontrado', 'Usuario no encontrado.');
        }
        $clave = Claves::generar();
        $this->usuarios->cambiarClave($id, Claves::hash($clave));
        $this->auditoria->registrar($admin['id'], 'regenerar_clave', 'usuario', $id);
        return Respuesta::json(200, ['clave' => $clave]);
    }

    public function actualizarUsuario(Peticion $p, array $params): Respuesta
    {
        $admin = $this->sesion->exigirRol(Rol::ADMIN);
        $id = (int) $params['id'];
        $e = $p->json();
        $activo = null;
        $roles = null;
        if (array_key_exists('activo', $e)) {
            if (!is_bool($e['activo'])) {
                throw Entrada::invalido('activo', 'debe ser verdadero o falso');
            }
            $activo = $e['activo'];
        }
        if (array_key_exists('roles', $e)) {
            $r = $e['roles'];
            if (!is_array($r) || !array_is_list($r) || $r === [] || array_filter($r, fn ($x) => !is_string($x) || !Rol::valido($x)) !== []) {
                throw Entrada::invalido('roles', 'debe ser una lista no vacía de: ' . implode(', ', Rol::TODOS));
            }
            $roles = array_values(array_unique($r));
        }
        if ($activo === null && $roles === null) {
            throw new ErrorHttp(400, 'entrada_invalida', 'Indique «activo» o «roles».', ['activo' => 'Falta al menos un campo.']);
        }
        if ($this->usuarios->porId($id) === null) {
            throw new ErrorHttp(404, 'no_encontrado', 'Usuario no encontrado.');
        }
        if ($id === $admin['id'] && ($activo === false || ($roles !== null && !in_array(Rol::ADMIN, $roles, true)))) {
            throw new ErrorHttp(409, 'operacion_no_permitida', 'No puede desactivarse ni quitarse el rol admin a sí mismo.');
        }
        $this->usuarios->actualizar($id, $activo, $roles);
        $detalle = [];
        if ($activo !== null) {
            $detalle['activo'] = $activo;
        }
        if ($roles !== null) {
            $detalle['roles'] = $roles;
        }
        $this->auditoria->registrar($admin['id'], 'actualizar_usuario', 'usuario', $id, $detalle);
        return Respuesta::json(200, ['id' => $id]);
    }

    public function subirCapitulo(Peticion $p): Respuesta
    {
        // Un capítulo nuevo se sube en cualquier etapa. Reemplazar el texto de uno existente (mismo slug)
        // también, salvo que ya tenga aportes: entonces 409 operacion_no_permitida (lo decide subirBase).
        $admin = $this->sesion->exigirRol(Rol::ADMIN);
        $e = $p->json();
        $slug = Entrada::texto($e, 'slug', 80);
        if (preg_match('/^[a-z0-9-]{1,80}$/D', $slug) !== 1) {
            throw Entrada::invalido('slug', 'solo minúsculas, números y guiones (1 a 80)');
        }
        $titulo = Entrada::texto($e, 'titulo', 255);
        $orden = Entrada::entero($e, 'orden', 0, 100000);
        $tex = $e['texOriginal'] ?? null;
        if (!is_string($tex) || $tex === '' || strlen($tex) > self::MAX_TEX || !mb_check_encoding($tex, 'UTF-8')) {
            throw Entrada::invalido('texOriginal', 'debe ser texto UTF-8 de hasta 1 MB');
        }
        $objeto = $p->jsonObjeto();
        if (!property_exists($objeto, 'docJson') || !$objeto->docJson instanceof \stdClass) {
            throw Entrada::invalido('docJson', 'debe ser un documento (objeto JSON)');
        }
        ValidadorDocumento::validar($objeto->docJson);
        // Se guarda lo validado, recodificado: nunca el cuerpo crudo.
        $docJson = json_encode($objeto->docJson, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

        try {
            $r = $this->capitulos->subirBase($slug, $titulo, $orden, $tex, $docJson, $admin['id']);
        } catch (\PDOException $ex) {
            // Subida simultánea del mismo slug: clave duplicada (23000) o interbloqueo (40001). 1205: espera de
            // bloqueo agotada (p. ej. un guardado de laboratorio en curso sobre el mismo capítulo).
            if (in_array((string) $ex->getCode(), ['23000', '40001'], true) || (int) ($ex->errorInfo[1] ?? 0) === 1205) {
                throw new ErrorHttp(409, 'conflicto_concurrente', 'Otra subida del mismo capítulo está en curso. Reintente.');
            }
            throw $ex;
        }
        if ($r['estado'] === 'con_aportes') {
            $n = $r['laboratorios'];
            throw new ErrorHttp(409, 'operacion_no_permitida', match (true) {
                $n === 0 => 'El capítulo ya tiene una versión final; no se puede reemplazar el texto.',
                $n === 1 => '1 laboratorio ya trabajó en este capítulo; no se puede reemplazar el texto.',
                default => "$n laboratorios ya trabajaron en este capítulo; no se puede reemplazar el texto.",
            });
        }
        $this->auditoria->registrar($admin['id'], 'subir_capitulo', 'capitulo', $r['id'], [
            'slug' => $slug, 'versionId' => $r['versionId'], 'orden' => $orden, 'bytesTex' => strlen($tex), 'bytesDoc' => strlen($docJson),
        ]);
        return Respuesta::json(201, ['id' => $r['id'], 'versionId' => $r['versionId']]);
    }

    /**
     * PATCH /admin/capitulos/{id} con `{orden?, titulo?}`: numeración y título, en cualquier etapa (solo presentación).
     * Orden de comprobación: rol, entrada (400), capítulo (404), como en PATCH /admin/usuarios/{id}.
     */
    public function editarCapitulo(Peticion $p, array $params): Respuesta
    {
        $admin = $this->sesion->exigirRol(Rol::ADMIN);
        $id = (int) $params['id'];
        $e = $p->json();
        // Mismas reglas que en la subida (subirCapitulo).
        $orden = array_key_exists('orden', $e) ? Entrada::entero($e, 'orden', 0, 100000) : null;
        $titulo = array_key_exists('titulo', $e) ? Entrada::texto($e, 'titulo', 255) : null;
        if ($orden === null && $titulo === null) {
            throw new ErrorHttp(400, 'entrada_invalida', 'Indique «orden» o «titulo».', ['orden' => 'Falta al menos un campo.']);
        }
        // Lectura y escritura en una transacción con la fila bloqueada: un DELETE concurrente da 404, no un 200 vacío.
        $antes = $this->capitulos->actualizar($id, $orden, $titulo);
        if ($antes === null) {
            throw new ErrorHttp(404, 'no_encontrado', 'Capítulo no encontrado.');
        }
        $detalle = [];
        if ($orden !== null) {
            $detalle['orden'] = ['antes' => $antes['orden'], 'despues' => $orden];
        }
        if ($titulo !== null) {
            $detalle['titulo'] = ['antes' => $antes['titulo'], 'despues' => $titulo];
        }
        $this->auditoria->registrar($admin['id'], 'editar_capitulo', 'capitulo', $id, $detalle);
        return Respuesta::json(200, ['id' => $id]);
    }

    /**
     * DELETE /admin/capitulos/{id}: en cualquier etapa, solo si el capítulo no tiene aportes
     * (copias, instantáneas, sugerencias, comentarios ni versión final). Orden: rol, 404, aportes (409).
     */
    public function borrarCapitulo(Peticion $p, array $params): Respuesta
    {
        $admin = $this->sesion->exigirRol(Rol::ADMIN);
        $id = (int) $params['id'];
        try {
            $r = $this->capitulos->borrarSinAportes($id);
        } catch (\PDOException $ex) {
            // 40001: interbloqueo. 1205: espera de bloqueo agotada. 23000: la FK RESTRICT rechazó el borrado
            // (un aporte se coló pese a la comprobación). En todos los casos la transacción se deshizo.
            if (in_array((string) $ex->getCode(), ['40001', '23000'], true) || (int) ($ex->errorInfo[1] ?? 0) === 1205) {
                throw new ErrorHttp(409, 'conflicto_concurrente', 'Otra operación sobre el capítulo está en curso. Reintente.');
            }
            throw $ex;
        }
        if ($r['estado'] === 'no_existe') {
            throw new ErrorHttp(404, 'no_encontrado', 'Capítulo no encontrado.');
        }
        if ($r['estado'] === 'con_aportes') {
            throw new ErrorHttp(409, 'operacion_no_permitida', 'No se puede borrar el capítulo: ya tiene aportes (copias, sugerencias o comentarios de laboratorios, o una versión final).');
        }
        $c = $r['capitulo'];
        $this->auditoria->registrar($admin['id'], 'borrar_capitulo', 'capitulo', $id, [
            'slug' => $c['slug'], 'titulo' => $c['titulo'], 'orden' => $c['orden'], 'versiones' => $r['versiones'],
        ]);
        return Respuesta::vacia();
    }

    /**
     * PUT /admin/consulta con `{apertura, cierre, motivoObligatorio}`: el admin fija las fechas libremente
     * en cualquier etapa (docs/api.md §4.6). Ambas null: vuelve a preparación. Ambas fechas: cierre > apertura;
     * pueden estar en el pasado («Cerrar ahora» es cierre = ahora). Una sola: 400.
     * Cada cambio queda en auditoría con los valores anteriores y los nuevos.
     */
    public function guardarConsulta(Peticion $p): Respuesta
    {
        $admin = $this->sesion->exigirRol(Rol::ADMIN);
        $e = $p->json();
        foreach (['apertura', 'cierre'] as $campo) {
            if (!array_key_exists($campo, $e)) {
                throw Entrada::invalido($campo, 'es obligatorio (null para quitar las fechas)');
            }
        }
        $apertura = null;
        $cierre = null;
        if ($e['apertura'] !== null || $e['cierre'] !== null) {
            if ($e['apertura'] === null) {
                throw Entrada::invalido('apertura', 'falta: indique ambas fechas, o ninguna para volver a preparación');
            }
            if ($e['cierre'] === null) {
                throw Entrada::invalido('cierre', 'falta: indique ambas fechas, o ninguna para volver a preparación');
            }
            $apertura = Entrada::fechaIso($e, 'apertura');
            $cierre = Entrada::fechaIso($e, 'cierre');
            // La base guarda segundos: se descartan las fracciones antes de comparar y guardar.
            $apertura = $apertura->setTimestamp($apertura->getTimestamp());
            $cierre = $cierre->setTimestamp($cierre->getTimestamp());
            if ($cierre <= $apertura) {
                throw Entrada::invalido('cierre', 'debe ser posterior a la apertura');
            }
        }
        if (!is_bool($e['motivoObligatorio'] ?? null)) {
            throw Entrada::invalido('motivoObligatorio', 'debe ser verdadero o falso');
        }

        $antes = $this->consulta->dto();
        $this->consulta->guardar($apertura, $cierre, $e['motivoObligatorio']);
        $this->auditoria->registrar($admin['id'], 'actualizar_consulta', 'consulta', 1, [
            'antes' => $antes, 'despues' => $this->consulta->dto(),
        ]);
        return Respuesta::json(200, $this->consulta->dtoAdmin($this->reinicioPermitido));
    }

    /**
     * Limpia un campo del CSV: NBSP pasa a espacio; se quitan los caracteres de formato invisibles
     * (\p{Cf}: BOM, U+200B/C/D, guion blando…), los espacios de los extremos y un par de comillas
     * tipográficas que envuelva el campo.
     */
    private static function limpiarCampo(?string $v): string
    {
        $v = str_replace("\u{00A0}", ' ', (string) $v);
        $v = self::recortar(preg_replace('/\p{Cf}/u', '', $v) ?? $v);
        if (preg_match('/\A[“”„‟‘’‚‛«»‹›](.*)[“”„‟‘’‚‛«»‹›]\z/us', $v, $m) === 1) {
            $v = self::recortar($m[1]);
        }
        return $v;
    }

    /** Recorta espacios Unicode de los extremos (como `String.prototype.trim` del cliente). */
    private static function recortar(string $v): string
    {
        return preg_replace('/^[\s\p{Z}]+|[\s\p{Z}]+$/u', '', $v) ?? trim($v);
    }

    /**
     * Separador según la primera línea: el primer candidato (tabulador, `;`, `,`) con el que
     * `str_getcsv` da exactamente 3 campos; si ninguno, el primero que aparezca en la línea.
     */
    private static function separadorCsv(string $linea): string
    {
        foreach (["\t", ';', ','] as $candidato) {
            if (count(str_getcsv($linea, $candidato, '"', '')) === 3) {
                return $candidato;
            }
        }
        return str_contains($linea, "\t") ? "\t" : (str_contains($linea, ';') ? ';' : ',');
    }

    /**
     * Lee el CSV de usuarios (UTF-8, con o sin BOM). El encabezado `nombre,correo,laboratorio` es opcional:
     * se salta si la primera línea no vacía, normalizada, coincide con él. El separador se detecta en esa
     * misma línea (`separadorCsv`: tabulador de Excel, `;` o `,`). Cada campo se limpia (espacios,
     * caracteres invisibles, comillas tipográficas) y el correo se pasa a minúsculas. Las líneas con solo
     * separadores, espacios o invisibles (filas vacías de Excel) se ignoran.
     * Si hay líneas inválidas o correos duplicados (en el CSV o ya existentes), 400 con la lista de líneas.
     * @return list<array{nombre:string,correo:string,laboratorio:string}>
     */
    private function leerCsv(string $csv): array
    {
        if (str_starts_with($csv, "\xEF\xBB\xBF")) {
            $csv = substr($csv, 3);
        }
        if (!mb_check_encoding($csv, 'UTF-8')) {
            throw Entrada::invalido('csv', 'debe estar en UTF-8');
        }
        // Líneas en blanco (o solo con separadores, espacios o invisibles) antes de la primera: se saltan,
        // pero cuentan para los números de línea.
        $desfase = 0;
        if (preg_match('/\A(?:[\t;,\p{Z}\p{Cf}]*\r?\n)+/u', $csv, $m) === 1) {
            $desfase = substr_count($m[0], "\n");
            $csv = substr($csv, strlen($m[0]));
        }
        $primera = rtrim(strtok($csv, "\n") ?: '', "\r");
        $sep = self::separadorCsv($primera);
        $celdas = array_map(fn ($v) => mb_strtolower(self::limpiarCampo($v)), str_getcsv($primera, $sep, '"', ''));
        $conEncabezado = $celdas === ['nombre', 'correo', 'laboratorio'];

        $flujo = fopen('php://temp', 'r+');
        fwrite($flujo, $csv);
        rewind($flujo);
        if ($conEncabezado) {
            fgetcsv($flujo, null, $sep, '"', '');
        }
        $filas = [];
        $invalidas = [];
        $duplicadas = [];
        $vistos = [];
        while (true) {
            // Número de línea física donde empieza el registro (un campo entre comillas puede abarcar varias).
            $linea = 1 + $desfase + substr_count($csv, "\n", 0, (int) ftell($flujo));
            $reg = fgetcsv($flujo, null, $sep, '"', '');
            if ($reg === false) {
                break;
            }
            $reg = array_map(fn ($v) => self::limpiarCampo($v), $reg);
            if (self::limpiarCampo(str_replace(["\t", ';', ','], '', implode('', $reg))) === '') {
                continue; // línea en blanco o solo con separadores, espacios o invisibles (fila vacía de Excel)
            }
            if (count($filas) + count($invalidas) + count($duplicadas) >= self::MAX_FILAS_CSV) {
                fclose($flujo);
                throw Entrada::invalido('csv', 'máximo ' . self::MAX_FILAS_CSV . ' filas por importación');
            }
            if (count($reg) !== 3) {
                $invalidas[] = $linea;
                continue;
            }
            [$nombre, $correo, $lab] = $reg;
            $correo = mb_strtolower($correo);
            if ($nombre === '' || $lab === '' || mb_strlen($nombre) > 190 || mb_strlen($lab) > 190
                || mb_strlen($correo) > 254 || filter_var($correo, FILTER_VALIDATE_EMAIL) === false) {
                $invalidas[] = $linea;
                continue;
            }
            $indice = bin2hex($this->usuarios->indice($correo));
            if (isset($vistos[$indice]) || $this->usuarios->porCorreo($correo) !== null) {
                $duplicadas[] = $linea;
                continue;
            }
            $vistos[$indice] = true;
            $filas[] = ['nombre' => $nombre, 'correo' => $correo, 'laboratorio' => $lab];
        }
        fclose($flujo);

        if ($invalidas !== [] || $duplicadas !== []) {
            $partes = [];
            if ($invalidas !== []) {
                $partes[] = 'líneas con datos inválidos: ' . implode(', ', $invalidas);
            }
            if ($duplicadas !== []) {
                $partes[] = 'correos repetidos o ya registrados en las líneas: ' . implode(', ', $duplicadas);
            }
            $msg = 'No se creó ninguna cuenta; ' . implode('; ', $partes) . '.';
            throw new ErrorHttp(400, 'entrada_invalida', $msg, ['csv' => $msg]);
        }
        if ($filas === []) {
            throw Entrada::invalido('csv', 'no tiene filas de datos');
        }
        return $filas;
    }
}
