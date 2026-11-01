/**
 * ============================================================================
 * CONTRATO ÚNICO DE PRODUCTO — AERIS E-COMMERCE
 * ============================================================================
 * @file utils/productContract.js
 *
 * Este archivo define QUÉ forma tiene un producto cuando sale del servidor.
 * Es la "cintura" de la arquitectura:
 *
 *   MongoDB (doc crudo) → productNormalizer → ProductDTO → vistas EJS / JS cliente
 *
 * REGLAS DEL CONTRATO
 *  1. Fuera de productNormalizer.js NADIE lee el documento crudo de Mongo.
 *  2. Las vistas y el JS del cliente NO recalculan hechos del dominio
 *     (si es nuevo, el descuento, la ruta de imagen, el id, las tallas...).
 *  3. Comparaciones estrictas: el DTO garantiza un único formato por campo
 *     (colores con una sola grafía, tallas en MAYÚSCULAS, rutas con "/").
 * ============================================================================
 */

/**
 * @typedef {'prenda'|'conjunto'} TipoProducto
 *
 * @typedef {Object} ColorDTO
 * @property {string} nombre   Grafía canónica (la primera que aparece en las variantes).
 * @property {string} hex      Siempre "#rrggbb" o "#rgb" en minúsculas.
 * @property {string} imagen   Ruta de la foto de ese color (si no hay, la imagen del producto).
 * @property {string} familia  Id de la familia de color (minúsculas) de la primera variante con ese color ("" si no hay).
 *
 * @typedef {Object} VarianteDTO
 * @property {string} color    Misma grafía que ColorDTO.nombre ("" si no aplica).
 * @property {string} hex
 * @property {string} familia  Id de la familia de color (minúsculas). Es lo que usan los filtros.
 * @property {string} talla    MAYÚSCULAS ("" si no aplica).
 * @property {number} stock    Entero >= 0.
 * @property {boolean} ultimasUnidades  stock entre 1 y REGLAS.UMBRAL_ULTIMAS_UNIDADES.
 * @property {string} imagen   Ruta normalizada (nunca vacía).
 *
 * @typedef {Object} PiezaDTO   Prenda dentro de un conjunto.
 * @property {string} id
 * @property {string} nombre
 * @property {string} imagen
 * @property {string} url
 * @property {ColorDTO[]} colores
 * @property {string[]} tallas
 * @property {VarianteDTO[]} variantes
 * @property {boolean} agotado
 *
 * @typedef {Object} ProductDTO
 * @property {string} id                  String(_id). Identificador interno estable (carrito, favoritos).
 * @property {string} urlId               Tramo de la URL: "<Producto_ID>-<slug>" (ej. "4-vestido-midi-abertura").
 * @property {number|null} sku            idExcel (id en Google Sheets).
 * @property {TipoProducto} tipo
 * @property {string} nombre
 * @property {string} descripcion
 * @property {string} categoria           minúsculas.
 * @property {number} precio
 * @property {number|null} precioAnterior null salvo que sea un descuento real (> precio).
 * @property {boolean} esNuevo             Casilla "Nuevo" de la hoja. La vista decide dónde mostrarlo.
 * @property {boolean} publicado          Casilla "Publicado". Solo los publicados salen de la lista pública.
 * @property {string|null} creadoEn       ISO 8601 (para ordenar). null si no hay fecha válida.
 * @property {string} imagen              Igual a galeria[0].
 * @property {string[]} galeria           Sin duplicados, nunca vacía.
 * @property {string[]} familiasColor     minúsculas. Unión de las familias de sus variantes (conjunto: de sus piezas).
 * @property {ColorDTO[]} colores         Conjunto: unión de las piezas.
 * @property {string[]} tallas            Ordenadas. Conjunto: unión de las piezas.
 * @property {VarianteDTO[]} variantes    Conjunto: siempre [] (ver piezas).
 * @property {number|null} stockTotal     Conjunto: null.
 * @property {boolean} agotado            Conjunto: sin piezas, o alguna pieza agotada o no publicada.
 * @property {PiezaDTO[]} piezas          Solo conjuntos; en el orden definido en la hoja.
 * @property {string} url                 /producto/:urlId  |  /conjunto/:urlId
 */

/**
 * Reglas de negocio centralizadas. Si cambia una regla, cambia AQUÍ.
 */
const REGLAS = Object.freeze({
    /** "Últimas unidades": variante con stock entre 1 y este valor (inclusive). */
    UMBRAL_ULTIMAS_UNIDADES: 3,
    /** Solo para documentos antiguos sin la bandera esConjunto. Hoy lo define CATEGORÍAS ("Contiene piezas"). */
    CATEGORIA_CONJUNTOS: 'conjuntos',
    IMAGEN_BASE: '/images/productos/',
    IMAGEN_PLACEHOLDER: '/images/placeholder.svg',
    HEX_POR_DEFECTO: '#171717',
    /**
     * Orden de respaldo para tallas de letras cuando la tabla TALLAS no trae el dato
     * (documentos antiguos). El orden real sale de la columna "Orden" de la hoja.
     * SOLO ORDENA: nunca decide qué tallas existen; eso sale siempre de la base de datos.
     */
    ORDEN_TALLAS: Object.freeze(['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']),
    RUTA_PRENDA: '/producto/',
    RUTA_CONJUNTO: '/conjunto/'
});

/**
 * Verifica que un objeto cumple el contrato. Devuelve la lista de errores
 * (vacía = válido). Útil en tests y, si quieres, en desarrollo.
 *
 * @param {ProductDTO} dto
 * @returns {string[]}
 */
function validarProductDTO(dto) {
    if (!dto || typeof dto !== 'object') return ['El DTO está vacío o no es un objeto'];

    const errores = [];
    const exigir = (condicion, mensaje) => { if (!condicion) errores.push(mensaje); };
    const esRuta = (s) => typeof s === 'string' && (s.startsWith('/') || /^https?:\/\//i.test(s));
    const unicos = (lista) => new Set(lista).size === lista.length;

    exigir(typeof dto.id === 'string' && dto.id !== '', 'id debe ser un string no vacío');
    exigir(dto.tipo === 'prenda' || dto.tipo === 'conjunto', 'tipo debe ser "prenda" o "conjunto"');
    exigir(typeof dto.nombre === 'string' && dto.nombre !== '', 'nombre no puede estar vacío');
    exigir(Number.isFinite(dto.precio) && dto.precio >= 0, 'precio debe ser un número >= 0');

    exigir(
        dto.precioAnterior === null || (Number.isFinite(dto.precioAnterior) && dto.precioAnterior > dto.precio),
        'precioAnterior debe ser null o mayor que precio'
    );
    exigir(!('descuentoPct' in dto), 'descuentoPct ya no existe: la tienda solo muestra el precio tachado');

    exigir(!('badge' in dto), 'badge ya no existe: la vista decide qué etiqueta mostrar');
    exigir(typeof dto.urlId === 'string' && /^[a-z0-9-]+$/i.test(dto.urlId), 'urlId debe ser un tramo de URL válido');
    exigir(typeof dto.publicado === 'boolean', 'publicado debe ser booleano');

    exigir(Array.isArray(dto.galeria) && dto.galeria.length > 0, 'galeria no puede estar vacía');
    exigir(Array.isArray(dto.galeria) && dto.galeria[0] === dto.imagen, 'imagen debe ser galeria[0]');
    exigir(Array.isArray(dto.galeria) && dto.galeria.every(esRuta) && unicos(dto.galeria), 'galeria: rutas válidas y sin duplicados');
    exigir(esRuta(dto.imagen), 'imagen debe ser una ruta (empieza con "/" o http)');

    exigir(Array.isArray(dto.colores), 'colores debe ser un array');
    exigir(Array.isArray(dto.tallas), 'tallas debe ser un array');
    exigir(Array.isArray(dto.variantes), 'variantes debe ser un array');
    exigir(Array.isArray(dto.piezas), 'piezas debe ser un array');

    if (Array.isArray(dto.colores)) {
        const nombres = dto.colores.map(c => String(c.nombre).toLowerCase());
        exigir(unicos(nombres), 'colores: nombres repetidos (ignorando mayúsculas)');
        exigir(dto.colores.every(c => /^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(c.hex)), 'colores: hex inválido');
        exigir(dto.colores.every(c => esRuta(c.imagen)), 'colores: imagen inválida');
        exigir(dto.colores.every(c => typeof c.familia === 'string' && c.familia === c.familia.toLowerCase()), 'colores: familia debe ser texto en minúsculas');
    }
    if (Array.isArray(dto.tallas)) {
        exigir(dto.tallas.every(t => t === String(t).toUpperCase() && t !== ''), 'tallas deben estar en MAYÚSCULAS y no vacías');
        exigir(unicos(dto.tallas), 'tallas repetidas');
    }
    if (Array.isArray(dto.variantes) && Array.isArray(dto.colores) && Array.isArray(dto.tallas)) {
        const nombresColor = new Set(dto.colores.map(c => c.nombre));
        const tallas = new Set(dto.tallas);
        exigir(dto.variantes.every(v => Number.isInteger(v.stock) && v.stock >= 0), 'variantes: stock debe ser entero >= 0');
        exigir(dto.variantes.every(v => v.color === '' || nombresColor.has(v.color)), 'variantes: color con grafía distinta a colores[]');
        exigir(dto.variantes.every(v => v.talla === '' || tallas.has(v.talla)), 'variantes: talla fuera de tallas[]');
        exigir(dto.variantes.every(v => esRuta(v.imagen)), 'variantes: imagen inválida');
        exigir(dto.variantes.every(v => typeof v.familia === 'string' && v.familia === v.familia.toLowerCase()), 'variantes: familia debe ser texto en minúsculas');
        exigir(
            dto.variantes.every(v => v.ultimasUnidades === (v.stock >= 1 && v.stock <= REGLAS.UMBRAL_ULTIMAS_UNIDADES)),
            'variantes: ultimasUnidades incoherente con el stock'
        );
    }

    exigir(typeof dto.agotado === 'boolean', 'agotado debe ser booleano');
    exigir(typeof dto.esNuevo === 'boolean', 'esNuevo debe ser booleano');
    exigir(
        dto.creadoEn === null || (typeof dto.creadoEn === 'string' && !Number.isNaN(Date.parse(dto.creadoEn))),
        'creadoEn debe ser null o una fecha ISO válida'
    );

    if (dto.tipo === 'conjunto') {
        exigir(Array.isArray(dto.variantes) && dto.variantes.length === 0, 'un conjunto no lleva variantes propias (usa piezas)');
        exigir(dto.stockTotal === null, 'un conjunto tiene stockTotal null');
        exigir(typeof dto.url === 'string' && dto.url === REGLAS.RUTA_CONJUNTO + dto.urlId, 'url de conjunto incorrecta');
        if (Array.isArray(dto.piezas)) {
            exigir(dto.agotado === (dto.piezas.length === 0 || dto.piezas.some(p => p.agotado)), 'agotado de conjunto incoherente con sus piezas');
            dto.piezas.forEach((p, i) => {
                exigir(typeof p.id === 'string' && p.id !== '', `piezas[${i}].id inválido`);
                exigir(Array.isArray(p.variantes) && Array.isArray(p.colores) && Array.isArray(p.tallas), `piezas[${i}] incompleta`);
            });
        }
    } else {
        exigir(Array.isArray(dto.piezas) && dto.piezas.length === 0, 'una prenda no lleva piezas');
        exigir(typeof dto.url === 'string' && dto.url === REGLAS.RUTA_PRENDA + dto.urlId, 'url de prenda incorrecta');
        if (Array.isArray(dto.variantes)) {
            const suma = dto.variantes.reduce((s, v) => s + v.stock, 0);
            exigir(dto.stockTotal === suma, 'stockTotal debe ser la suma del stock de las variantes');
            exigir(dto.agotado === (suma <= 0), 'agotado incoherente con el stock');
        }
    }

    return errores;
}

module.exports = {
    REGLAS,
    validarProductDTO
};
