/**
 * middlewares/requireSyncToken.js — AERIS E-commerce
 *
 * Protege los endpoints de sincronización con un secreto compartido.
 * El cliente (Google Apps Script) debe enviar el header:  x-sync-token: <SYNC_TOKEN>
 *
 * - Si SYNC_TOKEN no está definido en el entorno, el endpoint queda DESACTIVADO
 *   (503). Es preferible a dejarlo abierto por olvido.
 * - La comparación es de tiempo constante para no filtrar el token por timing.
 */
const crypto = require('crypto');

const requireSyncToken = (req, res, next) => {
    const esperado = process.env.SYNC_TOKEN;

    if (!esperado) {
        console.error('[AERIS] SYNC_TOKEN no está definido: /api/sync-catalog queda desactivado.');
        return res.status(503).json({ status: 'error', message: 'Sincronización no disponible.' });
    }

    // Se comparan hashes (longitud fija) para que timingSafeEqual nunca lance por tamaños distintos.
    const hash = (valor) => crypto.createHash('sha256').update(String(valor)).digest();
    const recibido = req.get('x-sync-token') || '';

    if (!crypto.timingSafeEqual(hash(recibido), hash(esperado))) {
        return res.status(401).json({ status: 'error', message: 'No autorizado.' });
    }
    return next();
};

module.exports = requireSyncToken;
