/**
 * controllers/pagesController.js — AERIS E-commerce
 *
 * Capa HTTP delgada. Cada método:
 *   1. pide ProductDTO al catalogService,
 *   2. decide redirección / 404,
 *   3. renderiza una vista con un conjunto FIJO de variables ("view model").
 *
 * VIEW MODELS (lo que recibe cada vista; cualquier otra cosa no existe)
 *   pages/index     { pagina, title, pestanas: [{id,nombre,total,items: ProductDTO[]}], looks: ProductDTO[] }
 *   pages/catalogo  { pagina, title, categoriaSeleccionada, filtros, ...armarPaginaCatalogo() }
 *                   (consulta, pestanas, resultado {items,total,pagina,paginas,desde}, paginacion,
 *                    chips, nActivos, hrefLimpiar, ordenes, datosConteo)
 *   pages/producto  { pagina, title, producto: ProductDTO, relacionados: ProductDTO[], migas }
 *   pages/conjunto-detalle { pagina, title, conjunto: ProductDTO (con .piezas), piezasSueltas: ProductDTO[], migas }
 *                   migas: { migas: [{ texto, href }], categoria: { nombre, href } | null }  (utils/migas.js)
 *   pages/favoritos { pagina, title, sugerencias: ProductDTO[] }   (los favoritos viven en el navegador)
 *   pages/carrito | pedidos | nosotros   { pagina, title }   (bolsa y pedidos viven en el navegador)
 *   pages/error     { pagina, title, mensaje, status }       (lo renderiza errorHandler)
 */
const { httpError } = require('../middlewares/errorHandler');
const { elegirPestanas, elegirLooks, elegirSugerencias } = require('../utils/homeSelection');
const { armarPaginaCatalogo } = require('../utils/catalogPage');
const { armarMigas, rutaInterna, fichaDeRuta } = require('../utils/migas');

/** @param {{ catalogo: ReturnType<import('../services/catalogService').crearCatalogService> }} deps */
function crearPagesController({ catalogo }) {
    /** Migas según la ruta por la que llegó (utils/migas.js), con el nombre visible de la categoría. */
    async function migasDe(req, dto) {
        const { filtros } = await catalogo.paginaCatalogo();
        const cat = filtros.categorias.find(c => c.id === dto.categoria)
            || (dto.categoria ? { id: dto.categoria, nombre: dto.categoria.charAt(0).toUpperCase() + dto.categoria.slice(1) } : null);
        const ruta = rutaInterna(req.get('referer'), req.get('host'));
        const ficha = fichaDeRuta(ruta);
        const previo = ficha ? await catalogo.porIdOSku(ficha.id) : null;
        return armarMigas({
            ruta,
            categoria: cat,
            anterior: previo ? { nombre: previo.nombre, url: previo.url } : null,
            urlActual: dto.url
        });
    }

    return {
        async home(req, res) {
            const { prendas, conjuntos, categorias } = await catalogo.home();
            // Al azar en cada visita: se calcula aquí, fuera de la caché del catálogo.
            res.render('pages/index', {
                pagina: 'home',
                title: 'AERIS — Ropa de mujer en Lima',
                pestanas: elegirPestanas(prendas, categorias),
                looks: elegirLooks(conjuntos)
            });
        },

        async verCatalogo(req, res) {
            const { productos, filtros } = await catalogo.paginaCatalogo();
            const vista = armarPaginaCatalogo({ productos, filtros, query: req.query });
            res.render('pages/catalogo', {
                pagina: 'catalogo',
                title: 'Catálogo — AERIS',
                categoriaSeleccionada: vista.consulta.categoria,
                filtros,
                ...vista
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
                relacionados,
                migas: await migasDe(req, dto)
            });
        },

        async verConjunto(req, res, next) {
            const dto = await catalogo.porIdOSku(req.params.id);
            if (!dto) return next(httpError(404, `Conjunto no encontrado: ${req.params.id}`));

            if (dto.tipo !== 'conjunto' || req.params.id !== dto.urlId) return res.redirect(301, dto.url);

            // Cada pieza también se vende sola: sus fichas completas (con precio) para "Piezas por separado".
            const piezasSueltas = [];
            for (const pieza of dto.piezas) {
                const suelta = await catalogo.porIdOSku(pieza.id);
                if (suelta && suelta.tipo === 'prenda') piezasSueltas.push(suelta);
            }
            return res.render('pages/conjunto-detalle', {
                pagina: 'conjunto',
                title: `${dto.nombre} — AERIS`,
                conjunto: dto,
                piezasSueltas,
                migas: await migasDe(req, dto)
            });
        },

        async favoritos(req, res) {
            const sugerencias = elegirSugerencias(await catalogo.todos());   // al azar en cada visita
            res.render('pages/favoritos', { pagina: 'favoritos', title: 'Favoritos — AERIS', sugerencias });
        },

        carrito(req, res) {
            res.render('pages/carrito', { pagina: 'carrito', title: 'Tu bolsa — AERIS' });
        },

        pedidos(req, res) {
            res.render('pages/pedidos', { pagina: 'pedidos', title: 'Pedidos — AERIS' });
        },

        nosotros(req, res) {
            res.render('pages/nosotros', { pagina: 'nosotros', title: 'Nosotros — AERIS' });
        }
    };
}

module.exports = { crearPagesController };
