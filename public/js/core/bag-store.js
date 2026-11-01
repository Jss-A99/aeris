/**
 * ============================================================================
 * STORE DE LA BOLSA — AERIS E-COMMERCE
 * ============================================================================
 * @file public/js/core/bag-store.js
 *
 * Único dueño de la bolsa en el navegador (en el código antes se llamaba
 * "carrito"). Nadie más toca su localStorage.
 *  - Clave: 'aeris:bag' → { v: 1, items: CartItem[] }
 *  - Los CartItem se construyen con AerisContracts.buildCartItem (que valida
 *    color, talla y stock); este store solo los guarda, fusiona y cuenta.
 *
 * En el navegador queda listo como window.AerisBagStore.
 * En Node se exporta crearBagStore(opciones) para las pruebas.
 *
 * Uso:
 *   const item = AerisContracts.buildCartItem(dto, { color, talla }, 1);
 *   AerisBagStore.add(item);
 *   AerisBagStore.subscribe(items => pintarContador(AerisBagStore.count()));
 * ============================================================================
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./contracts'), require('./persistent-store'));
    } else {
        const api = factory(root.AerisContracts, root.AerisPersistentStore);
        root.AerisBagStore = api.crearBagStore();
    }
})(typeof self !== 'undefined' ? self : this, function (Contracts, Base) {
    'use strict';

    const CLAVE = 'aeris:bag';
    const VERSION = 1;

    /** Forma mínima que debe tener un CartItem guardado. */
    function esCartItemValido(it) {
        return !!it && typeof it === 'object'
            && typeof it.key === 'string' && it.key !== ''
            && typeof it.id === 'string' && it.id !== ''
            && (it.tipo === 'prenda' || it.tipo === 'conjunto')
            && Number.isInteger(it.cantidad) && it.cantidad >= 1
            && Number.isFinite(it.precio) && it.precio >= 0
            && Array.isArray(it.componentes);
    }

    function cantidadEntera(n) {
        const c = Math.floor(Number(n));
        return Number.isFinite(c) ? c : NaN;
    }

    function crearBagStore(opciones) {
        const op = opciones || {};
        const base = Base.crearStorePersistente({
            clave: CLAVE,
            version: VERSION,
            esValido: esCartItemValido,
            storage: op.storage,
            ventana: op.ventana
        });

        return {
            /** Copia de las líneas de la bolsa. */
            getItems: base.leer,

            /** Total de unidades (para el contador de la navbar). */
            count: () => base.leer().reduce((s, it) => s + it.cantidad, 0),

            /** Suma de precio × cantidad. */
            total: () => base.leer().reduce((s, it) => s + it.precio * it.cantidad, 0),

            /** Cantidad que ya hay en la bolsa con esa key (0 si no está). */
            cantidadDe(key) {
                const it = base.leer().find(x => x.key === key);
                return it ? it.cantidad : 0;
            },

            /**
             * Agrega un CartItem (hecho con buildCartItem). Si ya existe una
             * línea con la misma key, suma la cantidad.
             * Ojo: el stock se valida antes, al construir el item; para no pasarse,
             * construirlo con cantidadDe(key) + cantidad nueva.
             */
            add(item) {
                if (!esCartItemValido(item)) {
                    throw new Contracts.CartItemError('ITEM_INVALIDO', 'No se pudo agregar a la bolsa.');
                }
                base.cambiar(items => {
                    const existente = items.find(x => x.key === item.key);
                    if (existente) {
                        existente.cantidad += item.cantidad;
                        existente.precio = item.precio; // precio más reciente
                        return items;
                    }
                    return [...items, JSON.parse(JSON.stringify(item))];
                });
            },

            /** Cambia la cantidad de una línea. 0 o menos la quita. */
            setCantidad(key, cantidad) {
                const n = cantidadEntera(cantidad);
                if (Number.isNaN(n)) return;
                base.cambiar(items => n <= 0
                    ? items.filter(x => x.key !== key)
                    : items.map(x => (x.key === key ? { ...x, cantidad: n } : x)));
            },

            remove(key) {
                base.cambiar(items => items.filter(x => x.key !== key));
            },

            clear() {
                base.cambiar(() => []);
            },

            /** Único evento de cambio. Devuelve la función para desuscribirse. */
            subscribe: base.subscribe
        };
    }

    return { crearBagStore, CLAVE, VERSION };
});
