/**
 * ============================================================================
 * STORE DE PEDIDOS — AERIS E-COMMERCE
 * ============================================================================
 * @file public/js/core/pedidos-store.js
 *
 * Los pedidos de la clienta, guardados SOLO en este navegador (sin login).
 *  - Clave: 'aeris:pedidos' → { v: 1, items: Pedido[] } (el más reciente primero, máx. 50)
 *  - Única marca: `enviado` = la clienta tocó el botón que abre WhatsApp. No hay estados de
 *    pago: la venta se cierra por WhatsApp y puede terminar con menos piezas.
 *
 * Pedido: {
 *   id        código de la tienda (AER-0042) o, si la tienda no respondió, uno local (L-…)
 *   codigo    'AER-0042' | null
 *   fecha     ISO
 *   enviado   boolean
 *   entrega   'recojo' | 'lima' | 'provincia'
 *   envioGratis boolean
 *   promo     { codigo, descuento } | null
 *   totales   { subtotal, descuento, total }
 *   mensaje   texto de WhatsApp (para "Enviar pedido" si no se llegó a enviar)
 *   lineas    [{ id, tipo, titulo, url, imagen, precio, cantidad, color, talla,
 *               componentes: [{ id, nombre, color, talla }] }]
 * }
 *
 * En el navegador queda listo como window.AerisPedidosStore.
 * En Node se exporta crearPedidosStore(opciones) para las pruebas.
 * Orden de carga: contracts.js → persistent-store.js → pedidos-store.js
 * ============================================================================
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./contracts'), require('./persistent-store'));
    } else {
        const api = factory(root.AerisContracts, root.AerisPersistentStore);
        root.AerisPedidosStore = api.crearPedidosStore();
    }
})(typeof self !== 'undefined' ? self : this, function (Contracts, Base) {
    'use strict';

    const CLAVE = 'aeris:pedidos';
    const VERSION = 1;
    const MAXIMO = 50;

    function esPedidoValido(p) {
        return !!p && typeof p === 'object'
            && typeof p.id === 'string' && p.id !== ''
            && typeof p.fecha === 'string'
            && typeof p.enviado === 'boolean'
            && typeof p.mensaje === 'string'
            && !!p.totales && Number.isFinite(p.totales.total)
            && Array.isArray(p.lineas) && p.lineas.length > 0;
    }

    function crearPedidosStore(opciones) {
        const op = opciones || {};
        const base = Base.crearStorePersistente({
            clave: CLAVE,
            version: VERSION,
            esValido: esPedidoValido,
            storage: op.storage,
            ventana: op.ventana
        });

        return {
            /** Copia de los pedidos, el más reciente primero. */
            getItems: base.leer,
            count: () => base.leer().length,

            /** Guarda un pedido nuevo arriba de la lista (si ya existe ese id, lo reemplaza). */
            agregar(pedido) {
                if (!esPedidoValido(pedido)) {
                    throw new Contracts.CartItemError('ITEM_INVALIDO', 'No se pudo guardar el pedido.');
                }
                const copia = JSON.parse(JSON.stringify(pedido));
                base.cambiar(items => [copia, ...items.filter(x => x.id !== copia.id)].slice(0, MAXIMO));
            },

            /** La clienta tocó el botón de WhatsApp de ese pedido. */
            marcarEnviado(id) {
                base.cambiar(items => items.map(x => (x.id === id ? { ...x, enviado: true } : x)));
            },

            /** Único evento de cambio. Devuelve la función para desuscribirse. */
            subscribe: base.subscribe
        };
    }

    return { crearPedidosStore, CLAVE, VERSION, MAXIMO };
});
