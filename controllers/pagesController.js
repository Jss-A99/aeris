/**
 * controllers/pagesController.js — AERIS E-commerce
 *
 * Capa HTTP delgada. Cada método:
 *   1. pide ProductDTO al catalogService,
 *   2. decide redirección / 404,
 *   3. renderiza una vista con un conjunto FIJO de variables ("view model").
 *
 * VIEW MODELS (lo que recibe cada vista; cualquier otra cosa no existe)
 *   pages/index     { pagina, title, prendas: ProductDTO[], conjuntos: ProductDTO[] }
 *   pages/catalogo  { pagina, title, categoriaSeleccionada, productos: ProductDTO[], filtros }
 *   pages/producto  { pagina, title, producto: ProductDTO, relacionados: ProductDTO[] }
 *   pages/conjunto-detalle { pagina, title, conjunto: ProductDTO (con .piezas) }
 *   pages/favoritos | carrito | nosotros   { pagina, title }
 *   pages/error     { pagina, title, mensaje, status }       (lo renderiza errorHandler)
 */
const { httpError } = require('../middlewares/errorHandler');

/** @param {{ catalogo: ReturnType<import('../services/catalogService').crearCatalogService> }} deps */
function crearPagesController({ catalogo }) {
    return {
        async home(req, res) {
            const { prendas, conjuntos } = await catalogo.home();
            res.render('pages/index', { pagina: 'home', title: 'AERIS — E-commerce', prendas, conjuntos });
        },

        async verCatalogo(req, res) {
            const { productos, filtros } = await catalogo.paginaCatalogo();
            const categoriaSeleccionada = String(req.query.categoria || '').trim().toLowerCase() || 'todo';
            res.render('pages/catalogo', {
                pagina: 'catalogo',
                title: 'Catálogo — AERIS',
                categoriaSeleccionada,
                productos,
                filtros
            });
        },

        async verProducto(req, res, next) {
            const dto = await catalogo.porIdOSku(req.params.id);
            if (!dto) return next(httpError(404, `Producto no encontrado: ${req.params.id}`));

            // Una sola URL canónica por producto (/producto/<Producto_ID>-<slug>): el SKU suelto,
            // un slug viejo, el id interno de Mongo y los conjuntos redirigen a donde corresponde.
            if (dto.tipo === 'conjunto' || req.params.id !== dto.urlId) return res.redirect(301, dto.url);

            const relacionados = await catalogo.relacionados(dto, 4);
            return res.render('pages/producto', {
                pagina: 'producto',
                title: `${dto.nombre} — AERIS`,
                producto: dto,
                relacionados
            });
        },

        async verConjunto(req, res, next) {
            const dto = await catalogo.porIdOSku(req.params.id);
            if (!dto) return next(httpError(404, `Conjunto no encontrado: ${req.params.id}`));

            if (dto.tipo !== 'conjunto' || req.params.id !== dto.urlId) return res.redirect(301, dto.url);

            return res.render('pages/conjunto-detalle', {
                pagina: 'conjunto',
                title: `${dto.nombre} — Lookbook AERIS`,
                conjunto: dto
            });
        },

        favoritos(req, res) {
            res.render('pages/favoritos', { pagina: 'favoritos', title: 'Lista de Deseos — AERIS' });
        },

        carrito(req, res) {
            res.render('pages/carrito', { pagina: 'carrito', title: 'Carrito de Compras — AERIS' });
        },

        nosotros(req, res) {
            res.render('pages/nosotros', { pagina: 'nosotros', title: 'Nosotros — AERIS' });
        }
    };
}

module.exports = { crearPagesController };
