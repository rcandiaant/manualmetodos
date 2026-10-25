<?php

declare(strict_types=1);

namespace Manual\Controladores;

use Manual\Acceso\Auditoria;
use Manual\Acceso\Capitulos;
use Manual\Acceso\Consulta;
use Manual\Acceso\Usuarios;
use Manual\Dominio\Etapa;
use Manual\Dominio\Rol;
use Manual\Http\ErrorHttp;
use Manual\Http\Peticion;
use Manual\Http\Respuesta;
use Manual\Reloj;
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
        private readonly Reloj $reloj,
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
        $admin = $this->sesion->exigirRol(Rol::ADMIN);
        if ($this->consulta->etapa() !== Etapa::PREPARACION) {
            throw new ErrorHttp(409, 'etapa_no_permite', 'Solo se pueden subir capítulos antes de la apertura de la consulta.');
        }
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
            // Subida simultánea del mismo slug: clave duplicada (23000) o interbloqueo (40001).
            if (in_array((string) $ex->getCode(), ['23000', '40001'], true)) {
                throw new ErrorHttp(409, 'conflicto_concurrente', 'Otra subida del mismo capítulo está en curso. Reintente.');
            }
            throw $ex;
        }
        $this->auditoria->registrar($admin['id'], 'subir_capitulo', 'capitulo', $r['id'], [
            'slug' => $slug, 'versionId' => $r['versionId'], 'orden' => $orden, 'bytesTex' => strlen($tex), 'bytesDoc' => strlen($docJson),
        ]);
        return Respuesta::json(201, $r);
    }

    public function guardarConsulta(Peticion $p): Respuesta
    {
        $admin = $this->sesion->exigirRol(Rol::ADMIN);
        $e = $p->json();
        $apertura = Entrada::fechaIso($e, 'apertura');
        $cierre = Entrada::fechaIso($e, 'cierre');
        if (!is_bool($e['motivoObligatorio'] ?? null)) {
            throw Entrada::invalido('motivoObligatorio', 'debe ser verdadero o falso');
        }
        $motivo = $e['motivoObligatorio'];
        // La base guarda segundos: se descartan las fracciones antes de comparar y guardar.
        $apertura = $apertura->setTimestamp($apertura->getTimestamp());
        $cierre = $cierre->setTimestamp($cierre->getTimestamp());
        if ($cierre <= $apertura) {
            throw Entrada::invalido('cierre', 'debe ser posterior a la apertura');
        }

        $actual = $this->consulta->dto();
        $mismas = $actual['apertura'] === Consulta::iso($apertura) && $actual['cierre'] === Consulta::iso($cierre);
        if ($actual['etapa'] === Etapa::PREPARACION) {
            // Un error de tipeo en el pasado abriría o cerraría la consulta al instante y bloquearía las fechas.
            // «Abrir ahora» es válido: apertura >= ahora - 5 min.
            $ahora = $this->reloj->ahora();
            if ($apertura < $ahora->modify('-5 minutes')) {
                throw Entrada::invalido('apertura', 'no puede ser anterior a hace 5 minutos (para abrir ahora use la hora actual)');
            }
            if ($cierre <= $ahora) {
                throw Entrada::invalido('cierre', 'debe ser posterior a la hora actual');
            }
            $this->consulta->guardar($apertura, $cierre, $motivo);
        } elseif ($mismas) {
            $this->consulta->guardarMotivo($motivo);
        } elseif ($actual['etapa'] === Etapa::CONSULTA && $actual['apertura'] === Consulta::iso($apertura)
            && $actual['cierre'] !== null && Consulta::iso($cierre) > $actual['cierre'] && $cierre > $this->reloj->ahora()) {
            // «Ampliamos una semana»: durante la consulta solo se puede atrasar el cierre. No altera ninguna
            // etapa ya vivida; acortarlo o mover la apertura sí lo haría (409, abajo).
            // Las fechas ISO en UTC con «Z» y el mismo formato se comparan bien como texto.
            $this->consulta->guardar($apertura, $cierre, $motivo);
        } else {
            throw new ErrorHttp(409, 'etapa_no_permite', 'Las fechas solo se pueden cambiar antes de la apertura; durante la consulta solo se puede extender el cierre. El motivo obligatorio sí se puede cambiar.');
        }
        $nuevo = $this->consulta->dto();
        $this->auditoria->registrar($admin['id'], 'actualizar_consulta', 'consulta', 1, [
            'apertura' => $nuevo['apertura'], 'cierre' => $nuevo['cierre'], 'motivoObligatorio' => $nuevo['motivoObligatorio'],
        ]);
        return Respuesta::json(200, $nuevo);
    }

    /**
     * Lee el CSV: encabezado exacto `nombre,correo,laboratorio` (o con `;`), UTF-8 con o sin BOM.
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
        // Líneas en blanco antes del encabezado: se saltan, pero cuentan para los números de línea.
        $desfase = 0;
        if (preg_match('/\A(?:[ \t]*\r?\n)+/', $csv, $m) === 1) {
            $desfase = substr_count($m[0], "\n");
            $csv = substr($csv, strlen($m[0]));
        }
        $primera = rtrim(strtok($csv, "\n") ?: '', "\r");
        $sep = match (strtolower(trim($primera))) {
            'nombre,correo,laboratorio' => ',',
            'nombre;correo;laboratorio' => ';',
            default => throw Entrada::invalido('csv', 'el encabezado debe ser exactamente «nombre,correo,laboratorio» (o con «;»)'),
        };

        $flujo = fopen('php://temp', 'r+');
        fwrite($flujo, $csv);
        rewind($flujo);
        fgetcsv($flujo, null, $sep, '"', ''); // encabezado
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
            if ($reg === [null]) {
                continue; // línea en blanco
            }
            if (count($filas) + count($invalidas) + count($duplicadas) >= self::MAX_FILAS_CSV) {
                fclose($flujo);
                throw Entrada::invalido('csv', 'máximo ' . self::MAX_FILAS_CSV . ' filas por importación');
            }
            if (count($reg) !== 3) {
                $invalidas[] = $linea;
                continue;
            }
            [$nombre, $correo, $lab] = array_map(fn ($v) => trim((string) $v), $reg);
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
