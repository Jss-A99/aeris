/**
 * controllers/fotosController.js — AERIS E-commerce
 *
 * Sincronización de fotos desde Google Drive (lo llama el Apps Script, con el mismo token):
 *   POST /api/sync-fotos/estado   → { fotos: { nombre: version } }   qué hay guardado
 *   POST /api/sync-fotos          { fotos: [{ nombre, version, datos(base64) }] } → guarda un lote
 *   POST /api/sync-fotos/limpiar  { nombres: [...] } → borra las que ya no están en la carpeta
 *
 * Y la entrega a la web:
 *   GET /images/productos/:nombre → la foto guardada (si no está en Mongo, sigue a los archivos
 *   de /public, así lo copiado con `npm run fotos` también funciona).
 */
const crypto = require('crypto');
const { ErrorSync } = require('../services/syncService');

/** @param {{ fotos: ReturnType<import('../services/fotoService').crearFotoService> }} deps */
function crearFotosController({ fotos }) {
    function responderError(res, error) {
        if (error instanceof ErrorSync) {
            return res.status(error.status).json({ status: 'error', message: error.message, errores: error.errores });
        }
        console.error('[AERIS FOTOS] Error:', error);
        return res.status(500).json({ status: 'error', message: 'Error interno en el servidor.' });
    }

    return {
        async estado(req, res) {
            try { return res.json({ status: 'ok', fotos: await fotos.versiones() }); } catch (e) { return responderError(res, e); }
        },

        async subir(req, res) {
            try {
                const guardadas = await fotos.guardar((req.body || {}).fotos);
                console.log(`[AERIS FOTOS] ${guardadas} foto(s) guardada(s).`);
                return res.json({ status: 'ok', guardadas });
            } catch (e) { return responderError(res, e); }
        },

        async limpiar(req, res) {
            try {
                const eliminadas = await fotos.limpiar((req.body || {}).nombres);
                if (eliminadas) console.log(`[AERIS FOTOS] ${eliminadas} foto(s) eliminada(s).`);
                return res.json({ status: 'ok', eliminadas });
            } catch (e) { return responderError(res, e); }
        },

        /** Sirve la foto con caché del navegador (1 día) y respuesta 304 si no cambió. */
        async servir(req, res, next) {
            let foto;
            try { foto = await fotos.leer(req.params.nombre); } catch (e) { return next(); }   // Mongo caído: probar /public
            if (!foto) return next();
            const etag = '"' + crypto.createHash('sha1').update(foto.version).digest('hex').slice(0, 16) + '"';
            res.set({ 'Content-Type': foto.tipo, 'Cache-Control': 'public, max-age=86400', ETag: etag });
            if (req.get('if-none-match') === etag) return res.status(304).end();
            return res.send(foto.datos);
        }
    };
}

module.exports = { crearFotosController };
