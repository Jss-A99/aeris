/**
 * utils/catalogPage.js — AERIS E-commerce
 *
 * Arma TODO lo que pinta la página de catálogo a partir de ProductDTO[], los datos de filtros
 * (catalogFacets) y la querystring. Función PURA: la vista solo recorre lo que recibe.
 *
 * Las reglas (qué cumple un filtro, cómo se ordena, cómo se pagina) viven en
 * public/js/core/catalog-query.js, que también usa el navegador para contar resultados.
 */
const Q = require('../public/js/core/catalog-query');

const soles = (n) => `S/ ${Math.round(n)}`;

/**
 * @param {Object} p
 * @param {import('./productContract').ProductDTO[]} p.productos
 * @param {ReturnType<import('./catalogFacets').calcularFiltros>} p.filtros
 * @param {Object} p.query  req.query
 */
function armarPaginaCatalogo({ productos, filtros, query }) {
    const estado = Q.parsear(query, filtros);
    const enlace = (cambios) => '/catalogo' + Q.aQuery(estado, filtros, cambios);

    /* Pestañas: Todo, las de prendas (orden de la hoja), las de conjuntos y Descuentos si hay alguno */
    const esDeConjuntos = (c) => productos.some(p => p.categoria === c.id && p.tipo === 'conjunto');
    const base = [
        { id: Q.TODO, nombre: 'Todo' },
        ...filtros.categorias.filter(c => !esDeConjuntos(c)),
        ...filtros.categorias.filter(esDeConjuntos)
    ];
    if (productos.some(p => p.precioAnterior !== null)) base.push({ id: Q.DESCUENTOS, nombre: 'Descuentos' });
    if (!base.some(c => c.id === estado.categoria)) estado.categoria = Q.TODO;   // categoría inventada → Todo

    const pestanas = base.map(c => ({
        id: c.id,
        nombre: c.nombre,
        total: productos.filter(p => Q.cumple(p, estado, c.id)).length,   // respeta los demás filtros
        href: enlace({ categoria: c.id }),
        activa: c.id === estado.categoria
    }));

    /* Resultado de la página */
    const resultado = Q.paginar(Q.filtrar(productos, estado), estado.pagina);
    estado.pagina = resultado.pagina;

    const paginacion = resultado.paginas < 2 ? null : {
        anterior: resultado.pagina > 1 ? enlace({ pagina: resultado.pagina - 1 }) : null,
        siguiente: resultado.pagina < resultado.paginas ? enlace({ pagina: resultado.pagina + 1 }) : null,
        numeros: Q.numerosPagina(resultado.pagina, resultado.paginas).map(n => (n === '…'
            ? { salto: true }
            : { n, href: enlace({ pagina: n }), actual: n === resultado.pagina }))
    };

    /* Filtros activos (cada uno con su enlace para quitarlo) */
    const familia = new Map(filtros.familiasColor.map(f => [f.id, f]));
    const chips = [
        ...(estado.orden ? [{ texto: Q.ORDENES.find(o => o.id === estado.orden).nombre, href: enlace({ orden: null }) }] : []),
        ...estado.tallas.map(t => ({ texto: `Talla ${t}`, href: enlace({ tallas: estado.tallas.filter(x => x !== t) }) })),
        ...estado.colores.map(c => ({
            texto: familia.get(c).nombre, hex: familia.get(c).hex,
            href: enlace({ colores: estado.colores.filter(x => x !== c) })
        })),
        ...(Q.precioActivo(estado, filtros)
            ? [{ texto: `${soles(estado.min)} – ${soles(estado.max)}`, href: enlace({ min: filtros.precio.min, max: filtros.precio.max }) }]
            : [])
    ];

    return {
        consulta: estado,
        pestanas,
        resultado,
        paginacion,
        chips,
        nActivos: Q.nActivos(estado, filtros),
        hrefLimpiar: enlace({ orden: null, tallas: [], colores: [], min: filtros.precio.min, max: filtros.precio.max }),
        ordenes: Q.ORDENES,
        datosConteo: productos.map(Q.compactar)
    };
}

module.exports = { armarPaginaCatalogo };
