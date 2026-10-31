/**
 * routes/syncRoutes.js — AERIS E-commerce
 *
 * Orden deliberado: primero el token (rechaza barato a quien no está autorizado)
 * y solo después se lee el cuerpo. El parser JSON vive AQUÍ y no en toda la app:
 * las rutas públicas no necesitan parsear cuerpos. El límite se sube porque un
 * catálogo con muchas variantes supera los 100 KB por defecto de Express.
 */
const express = require('express');
const requireSyncToken = require('../middlewares/requireSyncToken');

/** @param {{ sincronizarCatalogo: Function }} syncController */
function crearSyncRoutes(syncController) {
    const router = express.Router();
    router.post(
        '/sync-catalog',
        requireSyncToken,
        express.json({ limit: '5mb' }),
        syncController.sincronizarCatalogo
    );
    return router;
}

module.exports = { crearSyncRoutes };
