/**
 * ============================================================================
 * STORE DE LA WISHLIST — AERIS E-COMMERCE
 * ============================================================================
 * @file public/js/core/wish-store.js
 *
 * Único dueño de la wishlist en el navegador (en la interfaz puede llamarse "favoritos").
 *  - Clave: 'aeris:wishlist' → { v: 1, items: WishItem[] } (uno por id)
 *
 * En el navegador queda listo como window.AerisWishStore.
 * En Node se exporta crearWishStore(opciones) para las pruebas.
 *
 * Uso:
 *   AerisWishStore.toggle(dto);            // agrega o quita
 *   AerisWishStore.has(dto.id);            // ¿corazón lleno?
 *   AerisWishStore.subscribe(items => ...);
 * ============================================================================
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./contracts'), require('./persistent-store'));
    } else {
        const api = factory(root.AerisContracts, root.AerisPersistentStore);
        root.AerisWishStore = api.crearWishStore();
    }
})(typeof self !== 'undefined' ? self : this, function (Contracts, Base) {
    'use strict';

    const CLAVE = 'aeris:wishlist';
    const VERSION = 1;

    function esWishItemValido(it) {
        return !!it && typeof it === 'object'
            && typeof it.id === 'string' && it.id !== ''
            && (it.tipo === 'prenda' || it.tipo === 'conjunto')
            && typeof it.url === 'string';
    }

    function crearWishStore(opciones) {
        const op = opciones || {};
        const base = Base.crearStorePersistente({
            clave: CLAVE,
            version: VERSION,
            esValido: esWishItemValido,
            storage: op.storage,
            ventana: op.ventana
        });

        const has = (id) => base.leer().some(x => x.id === String(id));

        /** Acepta un ProductDTO (tiene `nombre`) o un WishItem ya hecho. */
        function aWishItem(dtoOWish) {
            return (dtoOWish && dtoOWish.titulo !== undefined && dtoOWish.nombre === undefined)
                ? dtoOWish
                : Contracts.buildWishItem(dtoOWish);
        }

        function add(dtoOWish) {
            const wish = aWishItem(dtoOWish);
            if (!esWishItemValido(wish)) {
                throw new Contracts.CartItemError('ITEM_INVALIDO', 'No se pudo guardar en la wishlist.');
            }
            if (has(wish.id)) return;
            base.cambiar(items => [...items, JSON.parse(JSON.stringify(wish))]);
        }

        function remove(id) {
            base.cambiar(items => items.filter(x => x.id !== String(id)));
        }

        return {
            getItems: base.leer,
            count: () => base.leer().length,
            has,
            add,
            remove,

            /** Agrega o quita. Devuelve true si quedó en la wishlist. */
            toggle(dtoOWish) {
                const id = dtoOWish && dtoOWish.id;
                if (has(id)) { remove(id); return false; }
                add(dtoOWish);
                return true;
            },

            clear() {
                base.cambiar(() => []);
            },

            /** Único evento de cambio. Devuelve la función para desuscribirse. */
            subscribe: base.subscribe
        };
    }

    return { crearWishStore, CLAVE, VERSION };
});
