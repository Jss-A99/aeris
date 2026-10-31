/**
 * controllers/syncController.js — AERIS E-commerce
 * Capa HTTP delgada: traduce la petición a syncService y el resultado a JSON.
 * La lógica vive en services/syncService.js.
 */
const { sincronizar, ErrorSync } = require('../services/syncService');

/**
 * @param {Object} deps
 * @param {Object} deps.repositorio
 * @param {{ invalidar: () => void }} deps.catalogo   Para refrescar la caché tras sincronizar.
 */
function crearSyncController({ repositorio, catalogo }) {
    return {
        async sincronizarCatalogo(req, res) {
            const cuerpo = req.body || {};
            try {
                const resultado = await sincronizar(cuerpo, { repositorio });
                catalogo.invalidar();

                console.log(`[AERIS SYNC] ${resultado.publicados} publicados, ${resultado.eliminados} eliminados, ${resultado.advertencias.length} advertencias.`);
                return res.status(200).json({
                    status: 'ok',
                    message: 'Sincronización completada con éxito.',
                    publicados: resultado.publicados,
                    noPublicados: resultado.noPublicados,
                    eliminados: resultado.eliminados,
                    advertencias: resultado.advertencias
                });
            } catch (error) {
                if (error instanceof ErrorSync) {
                    return res.status(error.status).json({
                        status: 'error',
                        message: error.message,
                        errores: error.errores,
                        advertencias: error.advertencias
                    });
                }
                console.error('[AERIS SYNC] Error crítico:', error);
                // No se devuelve error.message al exterior (puede revelar detalles internos).
                return res.status(500).json({ status: 'error', message: 'Error interno en el servidor.' });
            }
        }
    };
}

module.exports = { crearSyncController };
