/**
 * services/syncService.js — AERIS E-commerce
 *
 * Sincroniza el catálogo desde Google Sheets (vía Apps Script) hacia MongoDB.
 *
 *   { productos, variantes, categorias, familiasColor, tallas, promociones? }   (filas de las pestañas;
 *   PROMOCIONES es opcional: si no se envía, no hay códigos activos)
 *        → construirCatalogo()   PURA: valida TODO y convierte filas en documentos
 *        → si hay errores: se rechaza el envío completo y NO se toca Mongo
 *        → si no: upsert de los publicados + tablas de apoyo + borrado de lo que sobre
 *
 * REGLAS
 *  - Mongo es un ESPEJO de lo publicado: guarda exactamente los productos con la casilla
 *    "Publicado" marcada. Despublicar o borrar la fila en la hoja lo quita de Mongo en el
 *    siguiente envío; volver a marcarlo lo restituye (la hoja guarda todo).
 *  - Los errores de validación BLOQUEAN el envío completo (Mongo nunca queda a medias y un
 *    dato mal escrito no puede provocar borrados).
 *  - Un producto NO publicado solo debe tener Producto_ID y nombre válidos y no repetidos:
 *    se puede dejar a medias sin romper el envío de los demás.
 *  - Se protege contra vaciar la tienda: si no hay ningún producto publicado, se rechaza.
 *  - Las filas que solo tienen casillas (Nuevo/Publicado en FALSE hasta la fila 1000)
 *    se ignoran en silencio.
 */

const { normalizarCodigo } = require('../utils/promo');
const { rutaImagen } = require('../utils/productNormalizer');

/** Nombre de foto: mismas reglas que services/fotoService.js (NOMBRE_VALIDO). Extensión opcional. */
const NOMBRE_FOTO = /^(?=.{1,120}$)[a-z0-9](?:[a-z0-9_-]|\.(?=[a-z0-9]))*$/;

/**
 * Enlace de un banner → dirección para la web, o lanza un texto de error.
 *   vacío                                   → null (banner sin enlace)
 *   /conjunto/12-sastre                     → igual
 *   https://<dominio propio>/conjunto/12…   → /conjunto/12…   (sin el dominio)
 *   https://instagram.com/aeris             → igual, externo (se abre en otra pestaña)
 */
function normalizarEnlace(valor, dominios) {
    const t = String(valor === null || valor === undefined ? '' : valor).trim();
    if (!t) return null;
    if (t.startsWith('/') && !t.startsWith('//')) {
        if (/\s/.test(t)) throw 'no puede tener espacios';
        return { enlace: t, externo: false };
    }
    const conProtocolo = /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(t) ? 'https://' + t : t;
    let url;
    try { url = new URL(conProtocolo); } catch (e) { throw 'debe ser una dirección completa (https://…) o empezar con /'; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw 'debe empezar con https://';
    const host = url.host.toLowerCase().replace(/^www\./, '');
    const propios = (dominios || []).map(d => String(d || '').toLowerCase().replace(/^www\./, '')).filter(Boolean);
    if (propios.includes(host)) return { enlace: (url.pathname || '/') + url.search + url.hash, externo: false };
    return { enlace: url.href, externo: true };
}

const MAX_MENSAJES = 30;

class ErrorSync extends Error {
    /**
     * @param {number} status
     * @param {string} mensaje
     * @param {{ errores?: string[], advertencias?: string[] }} [detalle]
     */
    constructor(status, mensaje, detalle = {}) {
        super(mensaje);
        this.name = 'ErrorSync';
        this.status = status;
        this.errores = detalle.errores || [];
        this.advertencias = detalle.advertencias || [];
    }
}

/* ----------------------------------------------------------------------------
   Utilidades de lectura de celdas
   ---------------------------------------------------------------------------- */

const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());
const vacio = (v) => texto(v) === '';
const lista = (v) => (vacio(v) ? [] : String(v).split(',').map(s => s.trim()).filter(Boolean));
const capitalizar = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Clave tolerante de encabezado: sin tildes, mayúsculas, espacios ni símbolos. */
const clave = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Número desde la celda (acepta "79,9"). NaN si está vacía o no es número. */
function numero(v) {
    if (typeof v === 'number') return v;
    const s = texto(v).replace(',', '.');
    return s === '' ? NaN : Number(s);
}

/** Casilla de Sheets (true/false) o texto equivalente. */
function booleano(v) {
    if (typeof v === 'boolean') return v;
    return ['true', 'verdadero', 'si', 'sí', '1', 'x'].includes(texto(v).toLowerCase());
}

/** Fila sin contenido real: todo vacío salvo casillas booleanas. Ignora campos internos "_...". */
function esFilaVacia(fila) {
    if (!fila || typeof fila !== 'object') return true;
    return Object.keys(fila).every(k => k.startsWith('_') || typeof fila[k] === 'boolean' || vacio(fila[k]));
}

/** Lector de campos que tolera diferencias de tildes/mayúsculas/espacios en los encabezados. */
function lector(fila) {
    const porClave = new Map();
    for (const k of Object.keys(fila)) if (!k.startsWith('_')) porClave.set(clave(k), fila[k]);
    return (...nombres) => {
        for (const n of nombres) {
            const c = clave(n);
            if (porClave.has(c)) return porClave.get(c);
        }
        return undefined;
    };
}

function normalizarHex(v) {
    const s = texto(v);
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s.toLowerCase();
    if (/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return '#' + s.toLowerCase();
    return null;
}

/**
 * "1, 2" → [1, 2]. También recupera el caso en que Sheets convirtió "1/2" o "1,2"
 * en una fecha ISO (2026-02-01T00:00:00.000Z → [1, 2]).
 */
function parsearProductosIncluidos(raw) {
    if (raw === null || raw === undefined || raw === '') return [];

    if (typeof raw === 'string' && raw.includes('T') && raw.endsWith('Z')) {
        const fecha = new Date(raw);
        if (!Number.isNaN(fecha.getTime())) {
            return [fecha.getUTCDate(), fecha.getUTCMonth() + 1];
        }
    }

    return String(raw)
        .replace(/\r?\n|\r/g, '')
        .split(',')
        .map(id => Number(id.trim()))
        .filter(id => Number.isInteger(id) && id > 0);
}

/**
 * Fecha de la hoja → "AAAA-MM-DD" (día en Lima). null si está vacía; undefined si no se entiende.
 * Acepta: celda de fecha enviada por nuestro Apps Script ("2026-12-31T00:00:00.000Z" = el día que
 * se ve en la hoja), texto "31/12/2026" o "2026-12-31", y cualquier otra fecha ISO (se pasa a hora de Lima).
 */
function fechaLima(v) {
    if (v === null || v === undefined || texto(v) === '') return null;
    const s = texto(v);
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return s;
    // Así envía las fechas nuestro Apps Script: el día que SE VE en la hoja, con hora 00:00 "Z".
    m = /^(\d{4}-\d{2}-\d{2})T00:00:00(\.000)?Z$/.exec(s);
    if (m) return m[1];
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const ms = Date.parse(s);
    if (Number.isNaN(ms)) return undefined;
    return new Date(ms - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

/* ----------------------------------------------------------------------------
   Construcción y validación
   ---------------------------------------------------------------------------- */

/**
 * Filas de las 5 pestañas → documentos y tablas de apoyo listos para guardar.
 *
 * @param {Object} cuerpo  { productos, variantes, categorias, familiasColor, tallas }
 * @returns {{
 *   documentos: Object[],
 *   meta: { categorias: Object[], familiasColor: Object[], tallas: Object[] },
 *   errores: string[],
 *   advertencias: string[],
 *   resumen: { publicados: number, noPublicados: number }
 * }}
 */
function construirCatalogo(cuerpo, opciones = {}) {
    const errores = [];
    const advertencias = [];
    const error = (m) => errores.push(m);
    const advertir = (m) => advertencias.push(m);

    const filasDe = (valor) => (Array.isArray(valor) ? valor : []);
    const numeroDeFila = (fila, i) => (Number.isInteger(fila && fila._fila) ? fila._fila : i + 2);

    /** Comprueba que existan las columnas imprescindibles (por si renombraron un encabezado). */
    function exigirColumnas(pestana, filas, columnas) {
        const presentes = new Set();
        filas.forEach(f => Object.keys(f || {}).forEach(k => presentes.add(clave(k))));
        columnas.forEach(c => {
            const alternativas = Array.isArray(c) ? c : [c];
            if (!alternativas.some(a => presentes.has(clave(a)))) {
                error(`${pestana}: falta la columna "${alternativas[0]}". ¿Cambiaste el encabezado?`);
            }
        });
    }

    /* ---------- CATEGORÍAS ---------- */
    const categorias = [];
    const categoriaPorId = new Map();
    {
        const filas = filasDe(cuerpo.categorias);
        exigirColumnas('CATEGORÍAS', filas, ['Categoría', 'Nombre visible', 'Orden', 'Contiene piezas']);
        filas.forEach((f, i) => {
            if (esFilaVacia(f)) return;
            const leer = lector(f);
            const donde = `CATEGORÍAS fila ${numeroDeFila(f, i)}`;
            const id = texto(leer('Categoría')).toLowerCase();
            if (!id) { error(`${donde}: falta el nombre de la categoría.`); return; }
            if (categoriaPorId.has(id)) { error(`${donde}: la categoría "${id}" está repetida.`); return; }
            const orden = numero(leer('Orden'));
            const cat = {
                id,
                nombre: texto(leer('Nombre visible')) || capitalizar(id),
                orden: Number.isFinite(orden) ? orden : 1000 + i,
                contienePiezas: booleano(leer('Contiene piezas'))
            };
            categorias.push(cat);
            categoriaPorId.set(id, cat);
        });
        if (categorias.length === 0) error('CATEGORÍAS está vacía: define al menos una categoría.');
    }

    /* ---------- FAMILIAS COLOR ---------- */
    const familiasColor = [];
    const familiaPorId = new Map();
    {
        const filas = filasDe(cuerpo.familiasColor);
        exigirColumnas('FAMILIAS COLOR', filas, ['Familia', 'HEX muestra']);
        filas.forEach((f, i) => {
            if (esFilaVacia(f)) return;
            const leer = lector(f);
            const donde = `FAMILIAS COLOR fila ${numeroDeFila(f, i)}`;
            const nombre = texto(leer('Familia'));
            if (!nombre) { error(`${donde}: falta el nombre de la familia.`); return; }
            const id = nombre.toLowerCase();
            if (familiaPorId.has(id)) { error(`${donde}: la familia "${nombre}" está repetida.`); return; }
            const hex = normalizarHex(leer('HEX muestra'));
            if (!hex) { error(`${donde}: el HEX "${texto(leer('HEX muestra'))}" de "${nombre}" no es válido (ej. #171717).`); return; }
            const fam = { id, nombre, hex };
            familiasColor.push(fam);
            familiaPorId.set(id, fam);
        });
        if (familiasColor.length === 0) error('FAMILIAS COLOR está vacía: define al menos una familia.');
    }

    /* ---------- PROMOCIONES (opcional) ---------- */
    const promociones = [];
    {
        const filas = filasDe(cuerpo.promociones);
        if (filas.some(f => !esFilaVacia(f))) exigirColumnas('PROMOCIONES', filas, ['Código', 'Tipo', 'Valor']);
        const vistos = new Set();
        filas.forEach((f, i) => {
            if (esFilaVacia(f)) return;
            const leer = lector(f);
            const donde = `PROMOCIONES fila ${numeroDeFila(f, i)}`;
            const codigo = normalizarCodigo(leer('Código'));
            if (!codigo) { error(`${donde}: falta el código.`); return; }
            if (vistos.has(codigo)) { error(`${donde}: el código "${codigo}" está repetido.`); return; }
            vistos.add(codigo);

            const tipoTxt = clave(texto(leer('Tipo')));
            const tipo = tipoTxt.startsWith('porc') ? 'porcentaje' : tipoTxt.startsWith('mont') ? 'monto' : null;
            if (!tipo) { error(`${donde}: el tipo "${texto(leer('Tipo'))}" no es válido (usa Porcentaje o Monto).`); return; }

            const valor = numero(leer('Valor'));
            if (!(valor > 0) || (tipo === 'porcentaje' && valor > 100)) {
                error(`${donde}: el valor de "${codigo}" debe ser mayor que 0${tipo === 'porcentaje' ? ' y como máximo 100' : ''}.`);
                return;
            }
            const minimoRaw = numero(leer('Compra mínima', 'Compra minima', 'Mínimo'));
            if (Number.isFinite(minimoRaw) && minimoRaw < 0) { error(`${donde}: la compra mínima no puede ser negativa.`); return; }

            const vence = fechaLima(leer('Vence', 'Vencimiento'));
            if (vence === undefined) { error(`${donde}: la fecha "${texto(leer('Vence', 'Vencimiento'))}" no es válida (ej. 31/12/2026).`); return; }

            const activoRaw = leer('Activo');
            promociones.push({
                codigo, tipo, valor,
                minimo: Number.isFinite(minimoRaw) ? minimoRaw : 0,
                vence,
                activo: activoRaw === undefined || activoRaw === '' ? true : booleano(activoRaw)
            });
        });
    }

    /* ---------- TALLAS ---------- */
    const tallas = [];
    const tallaPorId = new Map();
    {
        const filas = filasDe(cuerpo.tallas);
        exigirColumnas('TALLAS', filas, ['Talla', 'Orden']);
        filas.forEach((f, i) => {
            if (esFilaVacia(f)) return;
            const leer = lector(f);
            const donde = `TALLAS fila ${numeroDeFila(f, i)}`;
            const talla = texto(leer('Talla')).toUpperCase();
            if (!talla) { error(`${donde}: falta la talla.`); return; }
            if (tallaPorId.has(talla)) { error(`${donde}: la talla "${talla}" está repetida.`); return; }
            const orden = numero(leer('Orden'));
            const t = { talla, orden: Number.isFinite(orden) ? orden : 9000 + i };
            tallas.push(t);
            tallaPorId.set(talla, t);
        });
        if (tallas.length === 0) error('TALLAS está vacía: define al menos una talla.');
    }

    /* ---------- PRODUCTOS: lectura (id, nombre, publicado) ---------- */
    const filasProductos = filasDe(cuerpo.productos);
    exigirColumnas('PRODUCTOS', filasProductos, [
        'Producto_ID', 'Nombre Producto', 'Categoría', 'Precio', 'Publicado', 'Imagen Principal'
    ]);

    const productos = new Map();     // idExcel → { fila, donde, leer, nombre, publicado }
    filasProductos.forEach((f, i) => {
        if (esFilaVacia(f)) return;
        const leer = lector(f);
        const nFila = numeroDeFila(f, i);
        const idExcel = numero(leer('Producto_ID'));
        const nombre = texto(leer('Nombre Producto'));

        if (!Number.isInteger(idExcel) || idExcel <= 0) {
            error(`PRODUCTOS fila ${nFila}: Producto_ID debe ser un número entero mayor que 0 (hay "${texto(leer('Producto_ID'))}").`);
            return;
        }
        const donde = `PRODUCTOS fila ${nFila} (ID ${idExcel})`;
        if (productos.has(idExcel)) { error(`${donde}: el Producto_ID está repetido.`); return; }
        if (!nombre) { error(`${donde}: falta "Nombre Producto".`); return; }

        productos.set(idExcel, { donde, leer, nombre, publicado: booleano(leer('Publicado')) });
    });

    const publicados = [...productos.entries()].filter(([, p]) => p.publicado);
    if (publicados.length === 0 && errores.length === 0) {
        error('Ningún producto está marcado como Publicado: se rechaza el envío para no vaciar la tienda.');
    }

    /* ---------- VARIANTES ---------- */
    const filasVariantes = filasDe(cuerpo.variantes);
    exigirColumnas('VARIANTES', filasVariantes, ['Producto_ID', 'Color Variante', 'HEX Variante', 'Familia', 'Talla', 'Stock']);

    const variantesPorProducto = new Map();
    const vistas = new Set();
    filasVariantes.forEach((f, i) => {
        if (esFilaVacia(f)) return;
        const leer = lector(f);
        const nFila = numeroDeFila(f, i);
        const idExcel = numero(leer('Producto_ID'));
        const donde = `VARIANTES fila ${nFila}`;

        if (!Number.isInteger(idExcel) || idExcel <= 0) {
            error(`${donde}: Producto_ID debe ser un número entero mayor que 0 (hay "${texto(leer('Producto_ID'))}").`);
            return;
        }
        const producto = productos.get(idExcel);
        if (!producto) {
            error(`${donde}: el Producto_ID ${idExcel} no existe en PRODUCTOS.`);
            return;
        }
        if (!producto.publicado) return;      // producto en borrador: sus variantes no se validan ni se envían

        const color = texto(leer('Color Variante'));
        const hex = normalizarHex(leer('HEX Variante'));
        const familiaTxt = texto(leer('Familia'));
        const talla = texto(leer('Talla')).toUpperCase();
        const stock = numero(leer('Stock'));
        let valida = true;

        if (!color) { error(`${donde} (ID ${idExcel}): falta "Color Variante".`); valida = false; }
        if (!hex) { error(`${donde} (ID ${idExcel}): el HEX "${texto(leer('HEX Variante'))}" no es válido (ej. #171717).`); valida = false; }

        const familia = familiaPorId.get(familiaTxt.toLowerCase());
        if (!familiaTxt) {
            error(`${donde} (ID ${idExcel}): falta la "Familia".`); valida = false;
        } else if (!familia) {
            error(`${donde} (ID ${idExcel}): la familia "${familiaTxt}" no existe en FAMILIAS COLOR (disponibles: ${familiasColor.map(x => x.nombre).join(', ') || 'ninguna'}).`);
            valida = false;
        }

        if (!talla) {
            error(`${donde} (ID ${idExcel}): falta la "Talla".`); valida = false;
        } else if (!tallaPorId.has(talla)) {
            error(`${donde} (ID ${idExcel}): la talla "${talla}" no existe en TALLAS.`); valida = false;
        }

        if (!Number.isInteger(stock) || stock < 0) {
            error(`${donde} (ID ${idExcel}): "Stock" debe ser un entero de 0 o más (hay "${texto(leer('Stock'))}").`); valida = false;
        }
        if (!valida) return;

        const llave = `${idExcel}|${color.toLowerCase()}|${talla}`;
        if (vistas.has(llave)) {
            error(`${donde} (ID ${idExcel}): ya existe la variante ${color} / ${talla} para este producto.`);
            return;
        }
        vistas.add(llave);

        if (!variantesPorProducto.has(idExcel)) variantesPorProducto.set(idExcel, []);
        variantesPorProducto.get(idExcel).push({
            color,
            hex,
            familia: familia.nombre,
            talla,
            stock,
            imagen: texto(leer('Imagen Variante'))
        });
    });

    // Un mismo color con HEX distintos en un producto: la tienda usa el primero.
    for (const [idExcel, vars] of variantesPorProducto) {
        const hexPorColor = new Map();
        for (const v of vars) {
            const k = v.color.toLowerCase();
            if (!hexPorColor.has(k)) hexPorColor.set(k, v.hex);
            else if (hexPorColor.get(k) !== v.hex) {
                advertir(`Producto ${idExcel}: el color "${v.color}" aparece con HEX distintos; se usará ${hexPorColor.get(k)}.`);
            }
        }
    }

    /* ---------- PRODUCTOS PUBLICADOS: validación completa y documentos ---------- */
    const documentos = [];
    for (const [idExcel, p] of publicados) {
        const { donde, leer, nombre } = p;
        const categoriaTxt = texto(leer('Categoría')).toLowerCase();
        const categoria = categoriaPorId.get(categoriaTxt);
        const precio = numero(leer('Precio'));
        const precioAnteriorRaw = leer('Precio Anterior');
        const anterior = vacio(precioAnteriorRaw) ? null : numero(precioAnteriorRaw);
        let valido = true;

        if (!categoriaTxt) {
            error(`${donde}: falta la "Categoría".`); valido = false;
        } else if (!categoria) {
            error(`${donde}: la categoría "${categoriaTxt}" no existe en CATEGORÍAS.`); valido = false;
        }
        if (!Number.isFinite(precio) || precio <= 0) {
            error(`${donde}: "Precio" debe ser un número mayor que 0 (hay "${texto(leer('Precio'))}").`); valido = false;
        }
        if (anterior !== null && !Number.isFinite(anterior)) {
            error(`${donde}: "Precio Anterior" no es un número (hay "${texto(precioAnteriorRaw)}").`); valido = false;
        } else if (anterior !== null && Number.isFinite(precio) && anterior <= precio) {
            advertir(`${donde}: "Precio Anterior" (${anterior}) no es mayor que "Precio" (${precio}); no se mostrará como descuento.`);
        }

        const imagenPrincipal = texto(leer('Imagen Principal'));
        if (!imagenPrincipal) advertir(`${donde}: sin "Imagen Principal"; se mostrará la imagen por defecto.`);

        const esConjunto = Boolean(categoria && categoria.contienePiezas);
        const incluidosRaw = leer('Productos Incluidos', 'Productos Incluidos (Solo Conjuntos)');
        const incluidos = esConjunto ? parsearProductosIncluidos(incluidosRaw) : [];

        if (esConjunto) {
            if (incluidos.length === 0) {
                error(`${donde}: es un conjunto pero "Productos Incluidos" está vacío o no se entiende (usa ids separados por coma, ej. 1, 2).`);
                valido = false;
            }
            for (const idPieza of incluidos) {
                const pieza = productos.get(idPieza);
                if (idPieza === idExcel) {
                    error(`${donde}: un conjunto no puede incluirse a sí mismo.`); valido = false;
                } else if (!pieza) {
                    error(`${donde}: incluye el ID ${idPieza}, que no existe en PRODUCTOS.`); valido = false;
                } else if (!pieza.publicado) {
                    error(`${donde}: incluye "${pieza.nombre}" (ID ${idPieza}), que no está publicado.`); valido = false;
                } else if (categoriaPorId.get(texto(pieza.leer('Categoría')).toLowerCase())?.contienePiezas) {
                    error(`${donde}: incluye el ID ${idPieza}, que también es un conjunto.`); valido = false;
                }
            }
            if (variantesPorProducto.has(idExcel)) {
                advertir(`${donde}: un conjunto no lleva variantes propias; se ignoraron (el stock sale de sus piezas).`);
            }
        } else {
            if (!vacio(incluidosRaw)) {
                advertir(`${donde}: "Productos Incluidos" solo se usa en conjuntos; se ignoró.`);
            }
            if (!variantesPorProducto.has(idExcel)) {
                advertir(`${donde}: no tiene variantes; aparecerá como agotado.`);
            }
        }

        if (!valido) continue;

        documentos.push({
            idExcel,
            nombre,
            descripcion: texto(leer('Descripción')),
            precio,
            precioAnterior: anterior,
            categoria: categoria.id,
            nuevo: booleano(leer('Nuevo')),
            publicado: true,
            imagenPrincipal,
            imagenesSecundarias: lista(leer('Imágenes Secundarias')),
            esConjunto,
            productosIncluidosIds: incluidos,
            variantes: esConjunto ? [] : (variantesPorProducto.get(idExcel) || [])
        });
    }

    /* ---------- BANNERS (opcional) ----------
       Solo cuentan los que tienen "Activo" marcado; "Orden" los ordena entre sí (sin orden, al final;
       empate, el de más arriba). Título, Enlace y Texto del enlace son opcionales e independientes. */
    const banners = [];
    {
        const filas = filasDe(cuerpo.banners);
        if (filas.some(f => !esFilaVacia(f))) exigirColumnas('BANNERS', filas, ['Foto', 'Activo']);
        filas.forEach((f, i) => {
            if (esFilaVacia(f)) return;
            const leer = lector(f);
            if (!booleano(leer('Activo'))) return;
            const donde = `BANNERS fila ${numeroDeFila(f, i)}`;

            const foto = texto(leer('Foto'));
            if (!foto) { error(`${donde}: falta la foto (nombre del archivo en la carpeta BANNERS).`); return; }
            if (!NOMBRE_FOTO.test(foto)) { error(`${donde}: la foto "${foto}" debe ir en minúsculas, sin espacios ni tildes (ej. banner-primavera).`); return; }

            const ordenRaw = leer('Orden');
            const orden = vacio(ordenRaw) ? Infinity : numero(ordenRaw);
            if (!Number.isFinite(orden) && orden !== Infinity) { error(`${donde}: "Orden" debe ser un número (hay "${texto(ordenRaw)}").`); return; }

            let destino = null;
            try { destino = normalizarEnlace(leer('Enlace'), opciones.dominios); } catch (motivo) {
                error(`${donde}: el enlace "${texto(leer('Enlace'))}" ${motivo}.`); return;
            }
            const textoEnlace = texto(leer('Texto del enlace', 'Texto enlace'));
            if (textoEnlace && !destino) advertir(`${donde}: tiene "Texto del enlace" pero no "Enlace"; el texto no se mostrará.`);

            banners.push({
                fila: i, orden,
                imagen: rutaImagen(foto),
                titulo: texto(leer('Título', 'Titulo')),
                enlace: destino ? destino.enlace : null,
                externo: destino ? destino.externo : false,
                textoEnlace: destino ? textoEnlace : ''
            });
        });
        banners.sort((a, b) => (a.orden - b.orden) || (a.fila - b.fila) || 0);
        banners.forEach((b, i) => { b.orden = i + 1; delete b.fila; });
    }

    return {
        documentos,
        meta: { categorias, familiasColor, tallas, promociones, banners },
        errores,
        advertencias,
        resumen: { publicados: publicados.length, noPublicados: productos.size - publicados.length }
    };
}

/** Recorta una lista larga de mensajes sin perder cuántos faltan. */
function recortar(mensajes) {
    if (mensajes.length <= MAX_MENSAJES) return mensajes;
    return [...mensajes.slice(0, MAX_MENSAJES), `... y ${mensajes.length - MAX_MENSAJES} más.`];
}

/**
 * @param {Object} cuerpo  { productos, variantes, categorias, familiasColor, tallas }
 * @param {{ repositorio: Object }} opciones
 * @returns {Promise<{ publicados:number, noPublicados:number, eliminados:number, advertencias:string[] }>}
 */
async function sincronizar(cuerpo, { repositorio, dominios }) {
    if (!cuerpo || !Array.isArray(cuerpo.productos) || cuerpo.productos.length === 0) {
        throw new ErrorSync(400, 'El catálogo enviado está vacío.');
    }

    const { documentos, meta, errores, advertencias, resumen } = construirCatalogo(cuerpo, { dominios });

    if (errores.length > 0) {
        throw new ErrorSync(
            400,
            `La hoja tiene ${errores.length} error(es). No se guardó nada: corrígelos y vuelve a sincronizar.`,
            { errores: recortar(errores), advertencias: recortar(advertencias) }
        );
    }

    await repositorio.upsertMuchos(documentos);
    await repositorio.guardarMeta(meta);
    const eliminados = await repositorio.eliminarAusentes(documentos.map(d => d.idExcel));

    return {
        publicados: documentos.length,
        noPublicados: resumen.noPublicados,
        eliminados,
        advertencias: recortar(advertencias)
    };
}

module.exports = { ErrorSync, parsearProductosIncluidos, construirCatalogo, sincronizar, normalizarEnlace, NOMBRE_FOTO };
