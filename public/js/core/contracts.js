/**
 * ============================================================================
 * CONTRATOS DEL CLIENTE: CartItem y WishItem — AERIS E-COMMERCE
 * ============================================================================
 * @file public/js/core/contracts.js
 *
 * Define la ÚNICA forma válida de una línea del carrito y de un item de la wishlist, y
 * cómo se construyen a partir de un ProductDTO (ver utils/productContract.js).
 * No toca localStorage ni el DOM: eso lo hacen bag-store y wish-store.
 *
 * Funciona en el navegador (window.AerisContracts) y en Node (require), para
 * poder probarlo con `node --test`.
 *
 * @typedef {Object} ComponenteCart
 * @property {string} id           id de la pieza (PiezaDTO.id)
 * @property {string} nombre
 * @property {string|null} color   null si la pieza no tiene opciones de color
 * @property {string|null} talla   null si la pieza no tiene opciones de talla
 *
 * @typedef {Object} CartItem
 * @property {string} key              Identidad de la línea (misma selección = misma línea).
 * @property {string} id               id del producto o conjunto.
 * @property {'prenda'|'conjunto'} tipo
 * @property {string} titulo
 * @property {number} precio           Precio unitario al momento de agregar.
 * @property {string} imagen           Ruta relativa ("/images/..."), nunca con host.
 * @property {number} cantidad         Entero >= 1.
 * @property {string|null} color       Solo prenda.
 * @property {string|null} talla       Solo prenda.
 * @property {ComponenteCart[]} componentes  Solo conjunto; [] en prenda.
 * @property {string} url
 * @property {number} addedAt          Date.now()
 *
 * @typedef {Object} WishItem
 * @property {string} id
 * @property {'prenda'|'conjunto'} tipo
 * @property {string} titulo
 * @property {number} precio
 * @property {string} imagen
 * @property {string} url
 * @property {number} addedAt
 * ============================================================================
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AerisContracts = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ------------------------------------------------------------------ */
    /* Utilidades                                                          */
    /* ------------------------------------------------------------------ */

    const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());
    const minus = (v) => texto(v).toLowerCase();
    const mayus = (v) => texto(v).toUpperCase();

    function normalizarCantidad(c) {
        const n = Math.floor(Number(c));
        return Number.isFinite(n) && n >= 1 ? n : 1;
    }

    class CartItemError extends Error {
        constructor(codigo, mensaje) {
            super(mensaje);
            this.name = 'CartItemError';
            /** COLOR_INVALIDO | TALLA_INVALIDA | VARIANTE_NO_EXISTE | SIN_STOCK | STOCK_INSUFICIENTE | ... */
            this.codigo = codigo;
        }
    }

    /* ------------------------------------------------------------------ */
    /* CartItem                                                            */
    /* ------------------------------------------------------------------ */

    /**
     * Identidad de una línea. Dos líneas con la misma key se fusionan sumando
     * cantidad. Un conjunto con otra selección de piezas es OTRA línea.
     */
    function cartItemKey(item) {
        if (item.tipo === 'conjunto') {
            const partes = (item.componentes || [])
                .map(c => `${texto(c.id)}~${minus(c.color)}~${mayus(c.talla)}`)
                .join('|');
            return `c:${texto(item.id)}:${partes}`;
        }
        return `p:${texto(item.id)}:${minus(item.color)}:${mayus(item.talla)}`;
    }

    /**
     * Valida una selección contra lo que ofrece una prenda o una pieza
     * (ProductDTO | PiezaDTO) y devuelve color/talla canónicos.
     */
    function validarSeleccion(fuente, color, talla, cantidad) {
        const nombre = fuente.nombre || fuente.id;
        if (fuente.agotado) {
            throw new CartItemError('SIN_STOCK', `"${nombre}" está agotado.`);
        }

        let colorFinal = null;
        if (fuente.colores.length > 0) {
            const c = fuente.colores.find(x => minus(x.nombre) === minus(color));
            if (!c) throw new CartItemError('COLOR_INVALIDO', `Elige un color válido para "${nombre}".`);
            colorFinal = c.nombre;
        }

        let tallaFinal = null;
        if (fuente.tallas.length > 0) {
            const t = fuente.tallas.find(x => x === mayus(talla));
            if (!t) throw new CartItemError('TALLA_INVALIDA', `Elige una talla válida para "${nombre}".`);
            tallaFinal = t;
        }

        if (fuente.variantes.length > 0) {
            const coincidentes = fuente.variantes.filter(v =>
                (colorFinal === null || v.color === colorFinal) &&
                (tallaFinal === null || v.talla === tallaFinal)
            );
            if (coincidentes.length === 0) {
                throw new CartItemError('VARIANTE_NO_EXISTE', `Esa combinación no existe para "${nombre}".`);
            }
            const stock = coincidentes.reduce((s, v) => s + v.stock, 0);
            if (stock <= 0) {
                throw new CartItemError('SIN_STOCK', `Sin stock en esa combinación de "${nombre}".`);
            }
            if (cantidad > stock) {
                throw new CartItemError('STOCK_INSUFICIENTE', `Solo quedan ${stock} unidades de "${nombre}".`);
            }
        }
        return { color: colorFinal, talla: tallaFinal };
    }

    /**
     * ProductDTO + selección → CartItem válido. Lanza CartItemError si la
     * selección no es válida (los componentes de UI deberían impedirlo antes).
     *
     * @param {Object} dto  ProductDTO
     * @param {{color?:string, talla?:string, componentes?:Array<{id:string,color?:string,talla?:string}>}} seleccion
     * @param {number} [cantidad=1]
     * @returns {CartItem}
     */
    function buildCartItem(dto, seleccion, cantidad) {
        if (!dto || !dto.id) throw new CartItemError('PRODUCTO_INVALIDO', 'Producto inválido.');
        const sel = seleccion || {};
        const cant = normalizarCantidad(cantidad);

        let item;
        if (dto.tipo === 'conjunto') {
            if (!Array.isArray(dto.piezas) || dto.piezas.length === 0) {
                throw new CartItemError('CONJUNTO_SIN_PIEZAS', `"${dto.nombre}" no tiene piezas disponibles.`);
            }
            if (dto.agotado) throw new CartItemError('SIN_STOCK', `"${dto.nombre}" está agotado.`);

            const elegidas = Array.isArray(sel.componentes) ? sel.componentes : [];
            const componentes = dto.piezas.map(pieza => {
                const elegida = elegidas.find(e => texto(e.id) === pieza.id);
                if (!elegida) {
                    throw new CartItemError('COMPONENTE_FALTANTE', `Falta elegir la pieza "${pieza.nombre}".`);
                }
                const { color, talla } = validarSeleccion(pieza, elegida.color, elegida.talla, cant);
                return { id: pieza.id, nombre: pieza.nombre, color, talla };
            });

            item = {
                id: dto.id, tipo: 'conjunto', titulo: dto.nombre, precio: dto.precio,
                imagen: dto.imagen, cantidad: cant, color: null, talla: null,
                componentes, url: dto.url
            };
        } else {
            const { color, talla } = validarSeleccion(dto, sel.color, sel.talla, cant);
            const colorDto = color === null ? null : dto.colores.find(c => c.nombre === color);
            item = {
                id: dto.id, tipo: 'prenda', titulo: dto.nombre, precio: dto.precio,
                imagen: colorDto ? colorDto.imagen : dto.imagen, cantidad: cant,
                color, talla, componentes: [], url: dto.url
            };
        }

        item.key = cartItemKey(item);
        item.addedAt = Date.now();
        return item;
    }

    /* ------------------------------------------------------------------ */
    /* WishItem                                                             */
    /* ------------------------------------------------------------------ */

    /** @returns {WishItem} */
    function buildWishItem(dto) {
        if (!dto || !dto.id) throw new CartItemError('PRODUCTO_INVALIDO', 'Producto inválido.');
        return {
            id: dto.id,
            tipo: dto.tipo === 'conjunto' ? 'conjunto' : 'prenda',
            titulo: dto.nombre,
            precio: dto.precio,
            imagen: dto.imagen,
            url: dto.url,
            addedAt: Date.now()
        };
    }

    return {
        CartItemError,
        cartItemKey,
        buildCartItem,
        buildWishItem
    };
});
