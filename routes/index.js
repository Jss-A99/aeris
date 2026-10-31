/**
 * routes/index.js — AERIS E-commerce
 * ÚNICO lugar donde se ve el mapa completo de URLs de la tienda.
 */
const express = require('express');

/**
 * @param {Object} deps
 * @param {ReturnType<import('../controllers/pagesController').crearPagesController>} deps.pages
 * @param {import('express').Router} deps.syncRouter
 */
function crearRutas({ pages, syncRouter }) {
    const router = express.Router();

    // Salud del servicio (Render / monitores). No toca la base de datos.
    router.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

    router.get('/', pages.home);
    router.get('/catalogo', pages.verCatalogo);
    router.get('/producto/:id', pages.verProducto);
    router.get('/conjunto/:id', pages.verConjunto);
    router.get('/favoritos', pages.favoritos);
    router.get('/carrito', pages.carrito);
    router.get('/nosotros', pages.nosotros);

    // Enlaces antiguos (compartidos por WhatsApp, etc.): /productos/:id → /producto/:id
    router.get('/productos/:id', (req, res) => {
        res.redirect(301, `/producto/${encodeURIComponent(req.params.id)}`);
    });

    router.use('/api', syncRouter);

    return router;
}

module.exports = { crearRutas };
