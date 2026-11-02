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
 *   mensaje   texto de WhatsApp (para "Enviar pedido" / "Volver a abrir WhatsApp")
 *   lineas    [{ id, tipo, titulo, url, imagen, precio, cantidad, color, talla,
 *               componentes: [{ id, nombre, color, talla }] }]
 * }
 *
 * En el navegador queda listo como window.AerisPedidosStore (+ window.AerisVolverAPedir).
 * En Node se exporta crearPedidosStore(opciones) y volverAPedir() para las pruebas.
 * Orden de carga: contracts.js → persistent-store.js → pedidos-store.js
 * ============================================================================
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./contracts'), require('./persistent-store'));
    } else {
        const api = factory(root.AerisContracts, root.AerisPersistentStore);
        root.AerisPedidosStore = api.crearPedidosStore();
        root.AerisVolverAPedir = api.volverAPedir;
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

    /**
     * "Volver a pedir": arma los CartItem de un pedido con los datos ACTUALES de la tienda,
     * con las mismas reglas de stock que la bolsa (contando lo que ya hay en ella).
     *  - Si hay menos stock, se agrega lo que queda.
     *  - Lo que ya no existe o se agotó, se omite.
     *
     * @param {Object[]} lineas              pedido.lineas
     * @param {Object<string, Object|null>} productos   id → ProductDTO actual (null = ya no existe)
     * @param {(key:string) => number} enBolsa          cantidad que ya hay en la bolsa con esa key
     * @returns {{ items: Object[], incompletos: number }}  incompletos = líneas omitidas o con menos unidades
     */
    function volverAPedir(lineas, productos, enBolsa) {
        const items = [];
        let incompletos = 0;
        (lineas || []).forEach(l => {
            const dto = productos[l.id];
            const seleccion = l.tipo === 'conjunto'
                ? { componentes: (l.componentes || []).map(c => ({ id: c.id, color: c.color, talla: c.talla })) }
                : { color: l.color, talla: l.talla };
            let item = null;
            if (dto) {
                for (let n = l.cantidad; n >= 1 && !item; n--) {
                    try {
                        const prueba = Contracts.buildCartItem(dto, seleccion, n);
                        Contracts.buildCartItem(dto, seleccion, (enBolsa(prueba.key) || 0) + n);
                        item = prueba;
                    } catch (e) { /* menos unidades */ }
                }
            }
            if (!item || item.cantidad < l.cantidad) incompletos++;
            if (item) items.push(item);
        });
        return { items, incompletos };
    }

    return { crearPedidosStore, volverAPedir, CLAVE, VERSION, MAXIMO };
});
