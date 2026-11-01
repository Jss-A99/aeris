/**
 * routes/syncRoutes.js — AERIS E-commerce
 *
 * Orden deliberado: primero el token (rechaza barato a quien no está autorizado)
 * y solo después se lee el cuerpo. El parser JSON vive AQUÍ y no en toda la app:
 * las rutas públicas no necesitan parsear cuerpos. Los límites se suben porque un
 * catálogo con muchas variantes supera los 100 KB por defecto de Express, y un lote
 * de fotos (en base64) puede pesar varios MB.
 */
const express = require('express');
const requireSyncToken = require('../middlewares/requireSyncToken');

/**
 * @param {{ sincronizarCatalogo: Function }} syncController
 * @param {{ estado: Function, subir: Function, limpiar: Function }} [fotosController]
 */
function crearSyncRoutes(syncController, fotosController) {
    const router = express.Router();
    router.post('/sync-catalog', requireSyncToken, express.json({ limit: '5mb' }), syncController.sincronizarCatalogo);

    if (fotosController) {
        router.post('/sync-fotos/estado', requireSyncToken, express.json({ limit: '10kb' }), fotosController.estado);
        router.post('/sync-fotos/limpiar', requireSyncToken, express.json({ limit: '1mb' }), fotosController.limpiar);
        router.post('/sync-fotos', requireSyncToken, express.json({ limit: '25mb' }), fotosController.subir);
    }
    return router;
}

module.exports = { crearSyncRoutes };
