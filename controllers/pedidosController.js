/**
 * controllers/pedidosController.js — AERIS E-commerce
 *
 *   POST /api/pedidos                    (público, lo usa la bolsa)  → { ok, codigo, lineas, promo, envioGratis, totales }
 *   POST /api/pedidos/pendientes         (token, lo usa la hoja)     → { status, pedidos }
 *   POST /api/pedidos/importados         (token)  { codigos: [...] }  → { status, marcados }
 */
const { ErrorPedido } = require('../services/pedidoService');

/** @param {{ pedidos: ReturnType<import('../services/pedidoService').crearPedidoService> }} deps */
function crearPedidosController({ pedidos }) {
    return {
        async crear(req, res) {
            try {
                const r = await pedidos.registrar(req.body);
                console.log(`[AERIS PEDIDO] ${r.codigo} · S/ ${r.totales.total.toFixed(2)}`);
                return res.json({ ok: true, ...r });
            } catch (e) {
                if (e instanceof ErrorPedido) return res.status(e.status).json({ ok: false, mensaje: e.message });
                console.error('[AERIS PEDIDO] Error:', e);
                return res.status(500).json({ ok: false, mensaje: 'No pudimos registrar tu pedido. Inténtalo de nuevo.' });
            }
        },

        async pendientes(req, res) {
            try { return res.json({ status: 'ok', pedidos: await pedidos.pendientes() }); } catch (e) {
                console.error('[AERIS PEDIDO] Error al listar:', e);
                return res.status(500).json({ status: 'error', message: 'Error interno en el servidor.' });
            }
        },

        async importados(req, res) {
            try { return res.json({ status: 'ok', marcados: await pedidos.marcarImportados((req.body || {}).codigos) }); } catch (e) {
                console.error('[AERIS PEDIDO] Error al marcar:', e);
                return res.status(500).json({ status: 'error', message: 'Error interno en el servidor.' });
            }
        }
    };
}

module.exports = { crearPedidosController };
