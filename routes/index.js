/**
 * routes/index.js — AERIS E-commerce
 * ÚNICO lugar donde se ve el mapa completo de URLs de la tienda.
 */
const express = require('express');
const { limitePorMinuto } = require('../middlewares/limitePorMinuto');

/**
 * @param {Object} deps
 * @param {ReturnType<import('../controllers/pagesController').crearPagesController>} deps.pages
 * @param {ReturnType<import('../controllers/bolsaController').crearBolsaController>} deps.bolsa
 * @param {ReturnType<import('../controllers/pedidosController').crearPedidosController>} [deps.pedidos]
 * @param {import('express').Router} deps.syncRouter
 */
function crearRutas({ pages, bolsa, pedidos, syncRouter }) {
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

    // API de la bolsa (lectura; no guarda nada)
    router.get('/api/bolsa/productos', bolsa.productos);
    router.get('/api/promo', bolsa.promo);

    // "Finalizar orden": registra el pedido con su código antes de abrir WhatsApp (no toca el stock)
    if (pedidos) router.post('/api/pedidos', limitePorMinuto(10), express.json({ limit: '50kb' }), pedidos.crear);

    router.use('/api', syncRouter);

    return router;
}

module.exports = { crearRutas };
