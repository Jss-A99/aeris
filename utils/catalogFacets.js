/**
 * utils/catalogFacets.js — AERIS E-commerce
 *
 * Calcula, a partir de ProductDTO[] y de las tablas de apoyo (meta), los datos que alimentan
 * los filtros del catálogo. Función PURA. Devuelve DATOS, no clases CSS: cómo se pintan es
 * decisión de la vista.
 *
 * PRINCIPIO: nada está escrito en el código; todo sale de la hoja (vía Mongo).
 *  - Categorías: nombre visible y orden de la pestaña CATEGORÍAS; solo las que tienen productos.
 *  - Familias de color: nombre y HEX de la pestaña FAMILIAS COLOR; solo las que usa algún
 *    producto publicado. No se infiere ningún color.
 *  - Tallas: solo las que existen en alguna variante, ordenadas por la columna "Orden" de TALLAS.
 *  - Precio: mínimo y máximo reales del catálogo.
 */
const { ordenarTallas } = require('./productNormalizer');

const PRECIO_MIN_POR_DEFECTO = 0;
const PRECIO_MAX_POR_DEFECTO = 500;

const esNumerica = (t) => /^\d+(\.\d+)?$/.test(t);
const capitalizar = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * @param {import('./productContract').ProductDTO[]} productos
 * @param {{ categorias?: Object[], familiasColor?: Object[], tallas?: Object[] }} [meta]
 * @returns {{
 *   categorias: Array<{ id: string, nombre: string }>,
 *   precio: { min: number, max: number },
 *   tallas: { letras: string[], numericas: string[] },
 *   familiasColor: Array<{ id: string, nombre: string, hex: string|null }>
 * }}
 *   `hex` es null solo si la familia no está en la tabla FAMILIAS COLOR (dato antiguo o incompleto):
 *   la vista decide qué mostrar en ese caso (por ejemplo, solo el texto).
 */
function calcularFiltros(productos, meta = {}) {
    const lista = Array.isArray(productos) ? productos : [];
    const tablaCategorias = Array.isArray(meta.categorias) ? meta.categorias : [];
    const tablaFamilias = Array.isArray(meta.familiasColor) ? meta.familiasColor : [];
    const tablaTallas = Array.isArray(meta.tallas) ? meta.tallas : [];

    /* Precio */
    const precios = lista.map(p => p.precio).filter(n => Number.isFinite(n) && n > 0);
    const precio = precios.length > 0
        ? { min: Math.floor(Math.min(...precios)), max: Math.ceil(Math.max(...precios)) }
        : { min: PRECIO_MIN_POR_DEFECTO, max: PRECIO_MAX_POR_DEFECTO };

    /* Tallas */
    const ordenTallas = new Map(tablaTallas.map(t => [t.talla, t.orden]));
    const tallasVistas = [...new Set(lista.flatMap(p => p.tallas))];
    const tallas = {
        letras: ordenarTallas(tallasVistas.filter(t => !esNumerica(t)), ordenTallas),
        numericas: ordenarTallas(tallasVistas.filter(esNumerica), ordenTallas)
    };

    /* Familias de color */
    const infoFamilia = new Map(tablaFamilias.map(f => [f.id, f]));
    const familiasColor = [...new Set(lista.flatMap(p => p.familiasColor))]
        .map(id => {
            const info = infoFamilia.get(id);
            return { id, nombre: info ? info.nombre : capitalizar(id), hex: info ? String(info.hex).toLowerCase() : null };
        })
        .sort((a, b) => a.nombre.localeCompare(b.nombre));

    /* Categorías: orden de la tabla; las que no estén en ella (datos antiguos) van al final */
    const usadas = new Set(lista.map(p => p.categoria).filter(Boolean));
    const deTabla = tablaCategorias
        .filter(c => usadas.has(c.id))
        .sort((a, b) => a.orden - b.orden)
        .map(c => ({ id: c.id, nombre: c.nombre }));
    const enTabla = new Set(tablaCategorias.map(c => c.id));
    const sueltas = [...usadas]
        .filter(id => !enTabla.has(id))
        .sort((a, b) => a.localeCompare(b))
        .map(id => ({ id, nombre: capitalizar(id) }));

    return { categorias: [...deTabla, ...sueltas], precio, tallas, familiasColor };
}

module.exports = { calcularFiltros };
