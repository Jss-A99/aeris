/**
 * controllers/bolsaController.js — AERIS E-commerce
 *
 * API que usa la página de la bolsa (la bolsa vive en el navegador, en localStorage):
 *   GET /api/bolsa/productos?ids=a,b   → { productos: { id: ProductDTO } } con precio y stock ACTUALES
 *   GET /api/promo?codigo=X&subtotal=N → { ok, codigo, descuento, etiqueta } | { ok:false, mensaje }
 * Nada se guarda en caché del navegador: precio, stock y códigos cambian con cada sync.
 */
const { evaluarPromo } = require('../utils/promo');

const MAX_IDS = 60;

/** @param {{ catalogo: ReturnType<import('../services/catalogService').crearCatalogService> }} deps */
function crearBolsaController({ catalogo }) {
    return {
        async productos(req, res) {
            const ids = [...new Set(String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean))].slice(0, MAX_IDS);
            const productos = {};
            for (const id of ids) {
                const dto = await catalogo.porIdOSku(id);
                if (dto && dto.id === id) productos[id] = dto;   // solo por id exacto (lo que guarda la bolsa)
            }
            res.set('Cache-Control', 'no-store');
            res.json({ productos });
        },

        async promo(req, res) {
            const resultado = evaluarPromo(await catalogo.promociones(), req.query.codigo, Number(req.query.subtotal));
            res.set('Cache-Control', 'no-store');
            res.json(resultado);
        }
    };
}

module.exports = { crearBolsaController };
