# Fase 1D: informes, exportación y despliegue — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: superpowers:subagent-driven-development (elegida por el usuario). Los pasos usan casillas (`- [ ]`).

**Objetivo:** cerrar la Fase 1 con lo que falta para usarla en serio:
- el registro final de cambios en pantalla, imprimible y en CSV;
- la descarga de todos los `.tex` finales en un `.zip`;
- las tareas de cron de mantenimiento y respaldo;
- el paquete `.zip` + `.sql` que Fabio sube al cPanel, con su guía de despliegue.

**Arquitectura:**
- Los informes se arman **en el navegador del revisor** (spec §6.8) con los endpoints existentes. El único cambio de API es agregar `resueltoPorNombre` a `GET /capitulos/{id}/aportes`.
- El cron es un script PHP de línea de comandos (`bin/cron.php`) que cPanel ejecuta.
- El paquete lo arma un script de Node que usa Docker solo para `composer install --no-dev`.
- El paquete se valida levantándolo en un contenedor aparte y corriendo `npm run humo` contra él.

**Tecnología:** la de 1C (TypeScript estricto, Vite y Vitest + jsdom en el cliente; PHP 8.2–8.4 sin framework + MariaDB 10.6 en el servidor), más `fflate` (MIT) para armar `.zip` en el navegador y en Node.

**Spec:** `docs/superpowers/specs/2026-10-23-plataforma-consulta-manual-design.md` (§5.4 registro final, §6.8 cron, §6.9 estructura de despliegue, §7 entrega, §9 Fase 1).
**Contrato:** `docs/api.md`. Su checklist de despliegue (§6) es la fuente de la guía de la Task 7.

## Restricciones globales

- **Reglas del usuario:**
  - sin pausas entre tareas;
  - commits al final, uno atómico por tarea, mostrados antes de crearlos;
  - Conventional Commits;
  - identidad `rcandiaa87 <rodrigo.candia@inia.cl>` y push con la cuenta `rcandiaant`;
  - trailers `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` y `Claude-Session`.
- **Hosting de producción:**
  - cPanel compartido con PHP 8.2–8.4, 512 MB de RAM y MariaDB 10.6 (charset por defecto latin1);
  - **sin SSH ni git**: hay FTP, administrador de archivos, Cron Jobs y phpMyAdmin;
  - no se puede contar con `exec()`, `mysqldump` ni binarios externos.
- **Contrato:**
  - `docs/api.md` es el contrato; solo la Task 1 lo amplía, y de forma aditiva;
  - toda escritura lleva `Content-Type: application/json` y `X-CSRF-Token`;
  - el cliente nunca recibe secretos.
- **CSP:** igual que en 1C (`script-src 'self'`, etc.). `window.print()` está permitido; no se agregan scripts inline ni CDN.
- **DOM:** nunca `innerHTML` con texto del servidor o del documento. El DOM se arma con el helper `el` y `textContent`.
- **Fechas:**
  - la API está en UTC con `Z`;
  - en pantalla y en el CSV se muestran en `America/Santiago` con `aLocal` de `src/app/fechas.ts`.
- **CSV:**
  - UTF-8 con BOM, separador `;` (Excel en español) y LF;
  - toda celda pasa por la neutralización de fórmulas ya existente: se extrae `celdaCsv` de `src/app/admin/usuarios.ts` a `src/app/csv.ts` y se reutiliza.
- **Contenido del manual:** `manual-fuente/` nunca se versiona ni entra al paquete; tampoco `.env`, `tests/`, `var/` ni `node_modules`.
- Solo dependencias MIT/BSD/ISC/Apache, con la versión exacta fijada.

## Foco de revisión

1. **Un informe consolidado con unos 35 laboratorios × 15 capítulos (miles de filas)** se arma y se filtra sin congelar la página. Prueba en la Task 3: 35 × 15 × 20 sugerencias sintéticas → `filasInforme` + `filtrar` en menos de 1500 ms en jsdom.
2. **Una sugerencia cuyo `bloqueId` no existe en la base vigente** (versión base anterior, o bloque borrado o movido) no rompe el informe. Su ubicación dice «Bloque no encontrado en la versión vigente». Prueba en la Task 3.
3. **Un respaldo de una base grande** no agota los 512 MB: se escribe fila a fila, comprimido con gzip, sin cargar tablas enteras en memoria. Prueba en la Task 2: 20 000 filas con un pico de memoria menor a 32 MB.
4. **Un capítulo sin versión final al descargar el `.zip`** no se omite en silencio: el `.zip` se arma igual con los que existen e incluye `FALTANTES.txt` con la lista, y la página la muestra. Prueba en la Task 5.
5. **El informe impreso** respeta los filtros activos, repite la cabecera de la tabla en cada página, no corta filas por la mitad y oculta la navegación y los botones. La prueba en la Task 4 verifica las reglas `@media print` y que el título impreso nombre los filtros.

---

### Task 1: API — nombre de quien resolvió en los aportes

**Archivos:**
- Modificar:
  - `servidor/src/Acceso/Sugerencias.php` (consulta de aportes, alrededor de la línea 152);
  - `servidor/src/Acceso/Comentarios.php` (alrededor de la línea 94);
  - `docs/api.md` §4.5;
  - `cliente/src/app/tipos-api.ts`;
  - `cliente/scripts/humo-api.ts` (comprobación en el paso 8).
- Prueba: el archivo de pruebas PHP existente de aportes y revisión (buscarlo en `servidor/tests/` con `grep -l aportes`).

**Interfaces:**
- Produce:
  - cada sugerencia y cada comentario de `GET /capitulos/{id}/aportes` suma `resueltoPorNombre: string | null` (el `nombre` del usuario revisor; null si está pendiente o abierto);
  - `mis-aportes` **no** lo expone (§4.5: no muestra quién resolvió).
- Tipos TS:
  - `SugerenciaServidor.resueltoPorNombre?: string | null`;
  - `ComentarioServidor.resueltoPorNombre?: string | null`.

- [ ] **Paso 1: pruebas PHP**
  - `aportes incluye resueltoPorNombre del revisor`: resolver con un revisor llamado «Ana Revisora» → `resueltoPorNombre === 'Ana Revisora'`.
  - `pendiente tiene resueltoPorNombre null`.
  - `mis-aportes no expone resueltoPorNombre ni resueltoPor`.
  - Lo mismo para comentarios.
- [ ] **Paso 2:** correrlas y verlas fallar (FAIL). **Paso 3:** implementar con `LEFT JOIN usuarios r ON r.id = s.resuelto_por` y el DTO explícito. **Paso 4:** correrlas y verlas pasar (PASS), y además toda la suite PHP.
- [ ] **Paso 5:**
  - documentar el campo en `docs/api.md` §4.5;
  - agregarlo a `tipos-api.ts`;
  - en `humo-api.ts`, después de decidir, comprobar que `resueltoPorNombre` es el nombre del revisor de la prueba de humo;
  - correr `npm run humo` y ver todos los pasos en ok.

### Task 2: Cron de mantenimiento y respaldo lógico

**Archivos:**
- Crear:
  - `servidor/bin/cron.php`;
  - `servidor/src/Mantenimiento/Limpieza.php`;
  - `servidor/src/Mantenimiento/Respaldo.php`;
  - las pruebas correspondientes en `servidor/tests/`.

**Interfaces:**
- Uso por línea de comandos: `php bin/cron.php <tarea>`, donde `<tarea>` es `limpieza`, `respaldo` o `todo`.
  - Termina con código 0 si todo salió bien y distinto de 0 si algo falló; imprime una línea por acción.
  - Fuera de la CLI (`PHP_SAPI !== 'cli'`) termina con código 1 sin hacer nada. Además, `bin/` está fuera de la raíz web.
- `Limpieza::ejecutar(): array{intentos: int}`:
  - borra de `intentos_login` las filas con `actualizado` de hace más de 7 días y sin bloqueo vigente (`bloqueado_hasta` NULL o en el pasado);
  - las instantáneas de `revisiones_copia` ya se recortan a 20 al escribir (`Acceso/Copias.php`), así que la limpieza **no** las toca.
- `Respaldo::ejecutar(string $directorio, int $conservar = 14): string`:
  - escribe `respaldo-AAAAMMDD-HHMMSS.sql.gz` en `var/respaldos/` (lo crea con permisos 0700);
  - el contenido son `CREATE TABLE` vía `SHOW CREATE TABLE` e `INSERT` por lotes de 100 filas, leyendo con un cursor sin búfer (`PDO::MYSQL_ATTR_USE_BUFFERED_QUERY => false`) y escribiendo con `gzopen`/`gzwrite`;
  - conserva los `$conservar` más recientes y borra el resto;
  - devuelve la ruta del archivo;
  - registra la acción en `auditoria` con `accion = 'cron_respaldo'` o `'cron_limpieza'`.
- El reloj se inyecta con `Reloj`, como en el resto del servidor.

- [ ] **Paso 1: pruebas**
  - `limpieza borra intentos viejos sin bloqueo y conserva bloqueos vigentes`
  - `respaldo genera sql.gz restaurable`: se importa en una base temporal de prueba y se comparan los conteos de cada tabla.
  - `respaldo conserva solo los 14 mas recientes`
  - `respaldo de 20000 filas no supera 32 MB de pico` (`memory_get_peak_usage(true)`, medido como diferencia).
  - `cron fuera de cli no hace nada`
- [ ] **Paso 2:** FAIL. **Paso 3:** implementar. **Paso 4:** PASS, con toda la suite PHP en verde.
- [ ] **Paso 5:** probar en Docker con `docker compose exec php php bin/cron.php todo` → código 0 y el archivo creado. Documentar en el informe las líneas de cron sugeridas (las usa la Task 7):
  - respaldo diario a las 03:30;
  - limpieza semanal.

### Task 3: Datos del informe (modelo puro)

**Archivos:**
- Crear:
  - `cliente/src/app/informe/datos.ts`;
  - `cliente/src/app/csv.ts`;
  - `cliente/tests/app/informe/datos.test.ts`.
- Modificar: `cliente/src/app/admin/usuarios.ts` (importa `celdaCsv` de `csv.ts`, sin cambiar su comportamiento).

**Interfaces:**
- `csv.ts`:
  - `celdaCsv(v: string): string`, movida tal cual desde `admin/usuarios.ts`;
  - `armarCsv(cabecera: string[], filas: string[][]): string`, con BOM, separador `;` y LF.
- `datos.ts`:
  ```ts
  type TipoAporte = 'sugerencia' | 'comentario';
  interface FilaInforme {
    capituloId: number; capitulo: string; tipo: TipoAporte;
    ubicacion: string;          // «3. Reactivos › ítem 2» o «Bloque no encontrado en la versión vigente»
    original: string; propuesta: string;   // texto plano; comentario: original = texto anclado, propuesta = texto del comentario
    laboratorio: string; motivo: string;
    estado: string;             // pendiente|aceptada|rechazada|modificada (sugerencia) · abierto|resuelto (comentario)
    derivadaReunion: boolean;
    resueltoPor: string; resueltoEn: string;   // nombre y fecha local America/Santiago, o ''
    nota: string;
  }
  function filasInforme(capitulos: {id: number; titulo: string; base: DocJSON}[],
                        aportes: Map<number, {sugerencias: SugerenciaServidor[]; comentarios: ComentarioServidor[]}>): FilaInforme[];
  interface FiltrosInforme { capituloId?: number; laboratorio?: string; estado?: string; soloReunion?: boolean; tipo?: TipoAporte }
  function filtrar(filas: FilaInforme[], f: FiltrosInforme): FilaInforme[];
  function describirFiltros(f: FiltrosInforme, capitulos: {id: number; titulo: string}[]): string; // para el título impreso
  function csvInforme(filas: FilaInforme[]): string;
  ```
- Reglas:
  - **Ubicación:** número y título de la `\section` que contiene el bloque. Si el bloque está en una lista, se agrega «› ítem N» (1-based). Se calcula sobre la base vigente del capítulo con un índice `bid → ubicación` armado una sola vez por capítulo.
  - **Texto original y propuesta:** se toman de los campos de la sugerencia (`original`/`propuesta`, o su equivalente en `SugerenciaServidor`, verificarlo en `tipos-api.ts`), pasados a texto plano. La matemática se muestra como su LaTeX entre `$…$`.
  - **Orden:** capítulo (por `orden`), luego posición del bloque en el documento, luego laboratorio.
  - **Identidad:** una sugerencia idéntica de varios laboratorios se mantiene como **una fila por laboratorio**, porque el informe es por aporte (spec §5.4).

- [ ] **Paso 1: pruebas**
  - `ubicacion con seccion e item de lista`
  - `bloque inexistente dice no encontrado` (foco 2)
  - `comentario aparece como fila con su texto`
  - `fechas en America/Santiago y nombre de quien resolvio`
  - `filtrar por capitulo laboratorio estado y solo reunion`
  - `describirFiltros nombra los filtros activos`
  - `csv con BOM separador punto y coma y formulas neutralizadas`
  - `35 labs x 15 capitulos x 20 sugerencias en menos de 1500 ms` (foco 1)
  - los tests existentes de `admin/usuarios` siguen en verde.
- [ ] **Paso 2:** FAIL. **Paso 3:** implementar. **Paso 4:** PASS.

### Task 4: Vista del informe, impresión y CSV

**Archivos:**
- Crear:
  - `cliente/src/app/informe/vista.ts`;
  - `cliente/src/app/informe/informe.css`;
  - `cliente/tests/app/informe/vista.test.ts`.
- Modificar:
  - `cliente/src/app/main.ts` (rutas `#/informe` e `#/informe/:id`, solo para revisor, cargadas de forma diferida como el revisor y la administración);
  - `cliente/src/app/inicio.ts` (enlace «Registro de cambios» para el revisor);
  - `cliente/src/app/revisor/vista.ts` (enlace «Registro de cambios de este capítulo»).

**Interfaces:**
- Consume: Task 3 (`filasInforme`, `filtrar`, `describirFiltros`, `csvInforme`) y la Task 1 (`resueltoPorNombre`).
- `vistaInforme(api: Api, capituloId?: number): Vista`:
  - carga `GET /capitulos`, y luego `base` y `aportes` de cada capítulo (o de uno solo), con un máximo de 4 peticiones simultáneas;
  - muestra el avance («Cargando 3 de 15 capítulos…»);
  - si falla un capítulo, muestra un aviso `role="alert"` que lo nombra y un botón «Reintentar», y el resto del informe se muestra igual.
- **Filtros:** capítulo, laboratorio, estado, tipo y «Solo derivados a reunión». Viven en la consulta del hash (`#/informe?lab=…&estado=…`), así un enlace reproduce la vista.
- **Tabla:** columnas Capítulo, Ubicación, Original → Propuesta, Laboratorio, Motivo, Decisión, Resuelto por, Fecha, Nota. Encima, contadores por estado.
- **«Imprimir»:**
  - llama a `window.print()`;
  - `informe.css` trae `@media print` con `thead { display: table-header-group }`, `tr { break-inside: avoid }`, la navegación y los botones ocultos (`.no-imprimir`) y un título impreso con `describirFiltros` y la fecha.
- **«Descargar CSV»:** `csvInforme(filasFiltradas)` → archivo `registro-cambios-AAAAMMDD.csv`, generado con la misma técnica de `descargarTexto` (Blob + `revokeObjectURL` diferido).

- [ ] **Paso 1: pruebas**
  - `solo revisor accede al informe`
  - `carga todos los capitulos con concurrencia limitada y muestra avance`
  - `fallo de un capitulo muestra alerta y reintentar sin ocultar el resto`
  - `filtros se reflejan en el hash y lo restauran`
  - `imprimir llama window.print y el titulo impreso nombra los filtros`
  - `css de impresion repite cabecera y oculta navegacion` (lee las reglas de `informe.css`) (foco 5)
  - `descargar csv usa las filas filtradas`
- [ ] **Paso 2:** FAIL. **Paso 3:** implementar. **Paso 4:** PASS, más `npm run typecheck` y `npm run build` sin avisos.

### Task 5: Descarga de todos los `.tex` finales en `.zip`

**Archivos:**
- Crear:
  - `cliente/src/app/informe/zip.ts`;
  - `cliente/tests/app/informe/zip.test.ts`.
- Modificar:
  - `cliente/package.json` (agregar `fflate` con la versión exacta, MIT);
  - `cliente/src/app/informe/vista.ts` (botón «Descargar todos los .tex finales (.zip)»).

**Interfaces:**
- `armarZipFinales(api: Api, capitulos: {id: number; slug?: string; titulo: string}[]): Promise<{zip: Uint8Array; incluidos: string[]; faltantes: string[]}>`:
  - usa `GET /capitulos/{id}/final`; un 404 cuenta como faltante y cualquier otro error se propaga;
  - los nombres de archivo salen de `nombreTex` (`revisor/final.ts`);
  - los textos van en UTF-8 con LF;
  - si hay faltantes, agrega `FALTANTES.txt` con un título por línea;
  - nombre del archivo: `manual-final-AAAAMMDD.zip`.
- En la vista, antes de descargar, se muestran los faltantes en un aviso dentro de la página (sin `confirm()`) con «Descargar de todos modos».

- [ ] **Paso 1: pruebas**
  - `zip contiene un tex por capitulo con final`: se descomprime con `fflate.unzipSync` y se compara el contenido.
  - `capitulo sin final va a FALTANTES y se avisa` (foco 4)
  - `error distinto de 404 se muestra y no descarga`
  - `nombres de archivo unicos aunque dos slugs choquen`: el segundo recibe el sufijo `-2`.
- [ ] **Paso 2:** FAIL. **Paso 3:** implementar. **Paso 4:** PASS.

### Task 6: Paquete de despliegue `.zip` + `.sql`, validado

**Archivos:**
- Crear:
  - `cliente/scripts/empaquetar.ts` (script `"empaquetar": "tsx scripts/empaquetar.ts"`);
  - `servidor/.env.produccion.example`;
  - `docker/paquete/compose.paquete.yaml` (o un perfil `paquete` en `compose.yaml`);
  - `cliente/tests/empaquetar.test.ts`, con las funciones puras del script.

**Interfaces:**
- `npm run empaquetar` (desde `cliente/`), en este orden:
  1. comprueba que el árbol de git esté limpio (con `--permitir-sucio` solo avisa);
  2. `npm run build`;
  3. ejecuta `docker compose --profile herramientas run --rm composer install --no-dev --optimize-autoloader --classmap-authoritative`;
  4. arma `dist/paquete/manualmetodos/` con `bin/ config/ migraciones/ src/ vendor/ composer.json` y `public/` (que lleva `index.php`, `.htaccess` y el contenido de `cliente/dist/`), más `.env.produccion.example`;
  5. genera `dist/manualmetodos-AAAAMMDD-<sha7>.zip` con fflate;
  6. genera `dist/manualmetodos-AAAAMMDD-<sha7>.sql`: concatena `servidor/migraciones/*.sql` en orden, con una cabecera comentada que indica cómo importarlo (phpMyAdmin, sin cambiar el charset);
  7. **siempre**, aunque algo falle, restaura el `vendor` de desarrollo con `composer install`;
  8. imprime un resumen con el tamaño y la lista de carpetas.
- Funciones puras exportadas para probar:
  - `listaPaquete(raiz): string[]`;
  - `validarPaquete(archivos: string[]): string[]`, que devuelve los errores.
- `validarPaquete` exige `public/index.php`, `public/.htaccess`, `public/index.html`, `vendor/autoload.php` y `migraciones/001_inicial.sql`.
- `validarPaquete` rechaza cualquier ruta con `tests/`, `phpunit`, `.env` (salvo `.env.produccion.example`), `var/`, `manual-fuente`, `node_modules` o `.git`.
- `.env.produccion.example`:
  - todas las variables de `servidor/.env.example`, con `COOKIE_SEGURA=1` y `ZONA_HORARIA=America/Santiago`;
  - marcadores `<…>` en lugar de valores reales;
  - un comentario por línea que remite a la sección correspondiente de `docs/api.md` §6.
- **Validación de punta a punta:**
  - un contenedor PHP (la misma imagen de `compose.yaml`) monta `dist/paquete/manualmetodos` como `/var/www/app`, con `public/` como DocumentRoot, en el puerto **8081**, contra la misma base de desarrollo;
  - `HUMO_URL=http://localhost:8081 npm run humo` → todos los pasos en ok;
  - se documenta en el informe.

- [ ] **Paso 1: pruebas**
  - `validarPaquete exige archivos obligatorios`
  - `validarPaquete rechaza tests env var manual-fuente`
  - `nombre del paquete lleva fecha y sha`
- [ ] **Paso 2:** FAIL. **Paso 3:** implementar. **Paso 4:** PASS.
- [ ] **Paso 5:** correr `npm run empaquetar` y verificar:
  - salen el `.zip` y el `.sql`;
  - el humo contra el puerto 8081 pasa completo;
  - `curl http://localhost:8081/.env` y `/composer.json` devuelven 403 o 404;
  - el `vendor` de desarrollo quedó restaurado (`npm run humo` contra el 8080 sigue pasando).

### Task 7: Guía de despliegue y actualización de la guía de uso

**Archivos:**
- Crear: `docs/despliegue.md`.
- Modificar: `docs/guia-uso.md` (registro de cambios, impresión, CSV y `.zip`) y `docs/api.md` §6 (enlazar la guía nueva).

**Contenido de `docs/despliegue.md`:** paso a paso en lenguaje simple, para Fabio, con lo que ve en cPanel.
1. Crear el subdominio (p. ej. `manual.renalasch.cl`) con Document Root `/home/<usuario>/manualmetodos/public`.
2. Subir el `.zip` con el Administrador de archivos y extraerlo.
3. Crear la base y su usuario con privilegios mínimos.
4. Importar el `.sql` en phpMyAdmin sin cambiar el charset.
5. Crear el `.env` desde `.env.produccion.example`, generar las dos claves y respaldarlas fuera del servidor.
6. Ajustar la versión de PHP y sus límites.
7. Crear el primer administrador con `crear-admin.php --sql`.
8. Configurar Cron Jobs: las líneas exactas que salen de la Task 2, con la ruta `/usr/local/bin/php` y una nota para confirmarla en cPanel.
9. Hacer la prueba rápida (la lista de `docs/api.md` §6).
10. Actualizar a una versión nueva: qué carpetas reemplazar y cuáles no tocar (`.env`, `var/`).
11. Restaurar un respaldo.

- [ ] **Paso 1:** escribir los documentos, sin secretos ni contenido del manual.
- [ ] **Paso 2:** recorrer la guía contra el paquete real de la Task 6 en el contenedor del puerto 8081 (extraer, crear el `.env`, importar el `.sql` en una base nueva, crear el administrador, correr `cron.php todo` y hacer la prueba rápida) y corregir lo que no calce.
- [ ] **Paso 3:** `npm test`, `npm run typecheck`, `npm run build`, `npm run humo` y la suite PHP, todo en verde; `npm run verificar` sigue en 15/15.

---

## Paralelismo (para el coordinador)

Hay tres líneas independientes, cada una en su propio worktree, que se unen al final:

| Línea | Tareas | Carpetas | Comparte |
|---|---|---|---|
| Servidor | T1 → T2 | `servidor/` | `docs/api.md` |
| Informes | T3 → T4 → T5 | `cliente/src/app/informe` y `csv.ts` | `main.ts`, `inicio.ts` y `revisor/vista.ts` (un enlace cada uno) |
| Despliegue | T6 → T7 | `cliente/scripts`, `docker/` y `docs/` | ninguno |

- T4 consume `resueltoPorNombre` según el contrato de la Task 1, aunque esta todavía no esté unida.
- T7 necesita el paquete de T6 y las líneas de cron de T2, así que corre después de unir las tres líneas.

## Fuera de alcance (Fase 2 o a pedido)

- Envío automático de credenciales por correo.
- Exportación `.xlsx` (alcanza el CSV).
- Panel de avance.
- Anonimizar laboratorios en el informe.
- Despliegue automático por FTP.
- Agrupar en una sola propuesta la reescritura de un párrafo, que hoy queda partida palabra por palabra (observado en la demo; decidir con el usuario después de verla).
