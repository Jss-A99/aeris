/**
 * ============================================================================
 * CONTRATOS DEL CLIENTE: CartItem y FavItem — AERIS E-COMMERCE
 * ============================================================================
 * @file public/js/core/contracts.js
 *
 * Define la ÚNICA forma válida de una línea del carrito y de un favorito, y
 * cómo se construyen a partir de un ProductDTO (ver utils/productContract.js).
 * No toca localStorage ni el DOM: eso será trabajo de cart-store / fav-store.
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
 * @typedef {Object} FavItem
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

    const IMAGEN_PLACEHOLDER = '/images/placeholder.svg';
    const IMAGEN_BASE = '/images/productos/';

    /* ------------------------------------------------------------------ */
    /* Utilidades                                                          */
    /* ------------------------------------------------------------------ */

    const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());
    const minus = (v) => texto(v).toLowerCase();
    const mayus = (v) => texto(v).toUpperCase();

    /** "Único"/"Única"/vacío → null (el contrato usa null para "sin opción"). */
    function limpiarOpcion(v) {
        const s = texto(v);
        return (!s || /^[uú]nic[oa]$/i.test(s)) ? null : s;
    }

    function normalizarCantidad(c) {
        const n = Math.floor(Number(c));
        return Number.isFinite(n) && n >= 1 ? n : 1;
    }

    function rutaDe(tipo, id) {
        return (tipo === 'conjunto' ? '/conjunto/' : '/producto/') + id;
    }

    /** Ruta relativa. Quita el origen propio (http://localhost:3001) y completa nombres sueltos. */
    function normalizarImagen(img, origen) {
        const s = texto(img);
        if (!s) return IMAGEN_PLACEHOLDER;
        if (origen && s.startsWith(origen + '/')) return s.slice(origen.length);
        if (/^https?:\/\//i.test(s) || s.startsWith('/')) return s;
        return IMAGEN_BASE + s;
    }

    function origenActual() {
        return (typeof location !== 'undefined' && location && location.origin) ? location.origin : null;
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

    /**
     * MIGRACIÓN: acepta cualquiera de las formas antiguas que hay hoy en el
     * localStorage de los clientes y devuelve un CartItem (o null si no se
     * puede recuperar). Formas conocidas:
     *  - main.js:             {id,titulo,color,talla,precio,cantidad,imagen}
     *  - conjunto-detalle.js: {tipo:'conjunto', componentes:[{id,nombre,color,talla}], ...}
     *  - bottom sheet mobile: {esConjunto:true, piezas:[{piezaIndex,color,talla}]} (sin ids de pieza)
     *
     * Nota: los conjuntos que el bottom sheet guardó pasando por main.js
     * perdieron `piezas` y `esConjunto` al guardarse; esos no son recuperables
     * y quedan como prenda con el id del conjunto.
     */
    function normalizeCartItem(raw, opciones) {
        if (!raw || typeof raw !== 'object') return null;
        const origen = opciones && opciones.origen !== undefined ? opciones.origen : origenActual();

        const id = texto(raw.id !== undefined ? raw.id : raw._id);
        if (!id) return null;

        const esConjunto = raw.tipo === 'conjunto' || raw.esConjunto === true;
        const tipo = esConjunto ? 'conjunto' : 'prenda';
        const precio = Number(raw.precio);

        let componentes = [];
        if (esConjunto) {
            const origenComp = Array.isArray(raw.componentes) ? raw.componentes
                : (Array.isArray(raw.piezas) ? raw.piezas : []);
            componentes = origenComp.map((c, i) => ({
                id: texto(c && (c.id !== undefined ? c.id : c.piezaId)),
                nombre: texto(c && c.nombre) || `Pieza ${(c && c.piezaIndex) || i + 1}`,
                color: limpiarOpcion(c && c.color),
                talla: limpiarOpcion(c && c.talla)
            }));
        }

        const item = {
            id,
            tipo,
            titulo: texto(raw.titulo !== undefined ? raw.titulo : raw.nombre) || (esConjunto ? 'Conjunto AERIS' : 'Prenda AERIS'),
            precio: Number.isFinite(precio) && precio >= 0 ? precio : 0,
            imagen: normalizarImagen(raw.imagen !== undefined ? raw.imagen : raw.imagenPrincipal, origen),
            cantidad: normalizarCantidad(raw.cantidad !== undefined ? raw.cantidad : raw.quantity),
            color: esConjunto ? null : limpiarOpcion(raw.color),
            talla: esConjunto ? null : limpiarOpcion(raw.talla),
            componentes,
            url: rutaDe(tipo, id),
            addedAt: Number(raw.addedAt || raw.timestamp) || Date.now()
        };
        item.key = cartItemKey(item);
        return item;
    }

    /** Lista cualquiera → { items (fusionados por key), descartados }. */
    function migrateCart(rawList, opciones) {
        const lista = Array.isArray(rawList) ? rawList : [];
        const porKey = new Map();
        let descartados = 0;

        lista.forEach(raw => {
            const item = normalizeCartItem(raw, opciones);
            if (!item) { descartados++; return; }
            const existente = porKey.get(item.key);
            if (existente) existente.cantidad += item.cantidad;
            else porKey.set(item.key, item);
        });

        return { items: [...porKey.values()], descartados };
    }

    /* ------------------------------------------------------------------ */
    /* FavItem                                                             */
    /* ------------------------------------------------------------------ */

    /** @returns {FavItem} */
    function buildFavItem(dto) {
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

    /**
     * MIGRACIÓN de favoritos antiguos: objetos {id,titulo,precio,imagen} o ids
     * sueltos (conjunto-detalle.js toleraba ambos).
     * No se puede saber si era un conjunto: se enlaza a /producto/:id, que
     * también resuelve conjuntos.
     */
    function normalizeFavItem(raw, opciones) {
        if (raw === null || raw === undefined) return null;
        const origen = opciones && opciones.origen !== undefined ? opciones.origen : origenActual();
        const obj = (typeof raw === 'object') ? raw : { id: raw };

        const id = texto(obj.id !== undefined ? obj.id : obj._id);
        if (!id) return null;
        const tipo = obj.tipo === 'conjunto' ? 'conjunto' : 'prenda';
        const precio = Number(obj.precio);

        return {
            id,
            tipo,
            titulo: texto(obj.titulo !== undefined ? obj.titulo : obj.nombre) || (tipo === 'conjunto' ? 'Conjunto AERIS' : 'Prenda AERIS'),
            precio: Number.isFinite(precio) && precio >= 0 ? precio : 0,
            imagen: normalizarImagen(obj.imagen !== undefined ? obj.imagen : obj.imagenPrincipal, origen),
            url: rutaDe(tipo, id),
            addedAt: Number(obj.addedAt) || Date.now()
        };
    }

    /** Lista cualquiera → favoritos únicos por id. */
    function migrateFavorites(rawList, opciones) {
        const vistos = new Map();
        (Array.isArray(rawList) ? rawList : []).forEach(raw => {
            const fav = normalizeFavItem(raw, opciones);
            if (fav && !vistos.has(fav.id)) vistos.set(fav.id, fav);
        });
        return [...vistos.values()];
    }

    return {
        CartItemError,
        cartItemKey,
        buildCartItem,
        normalizeCartItem,
        migrateCart,
        buildFavItem,
        normalizeFavItem,
        migrateFavorites
    };
});
