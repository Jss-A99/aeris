const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const C = require('../public/js/core/contracts');
const { crearBagStore } = require('../public/js/core/bag-store');
const { crearWishStore } = require('../public/js/core/wish-store');
const { toProductDTO } = require('../utils/productNormalizer');

/* ---------- Dobles de prueba: localStorage y ventana en memoria ---------- */

function storageFalso(inicial) {
    const datos = new Map(Object.entries(inicial || {}));
    return {
        datos,
        getItem: (k) => (datos.has(k) ? datos.get(k) : null),
        setItem: (k, v) => { datos.set(k, String(v)); },
        removeItem: (k) => { datos.delete(k); }
    };
}
const json = (storage, k) => JSON.parse(storage.getItem(k));
const eventoStorage = (key) => Object.assign(new Event('storage'), { key });

/* ---------- Productos de ejemplo ---------- */

const AHORA = Date.parse('2026-10-29T12:00:00Z');
const oid = (hex) => ({ toString: () => hex });
const blusa = () => toProductDTO({
    _id: oid('aaaaaaaaaaaaaaaaaaaaaa01'), idExcel: 1, nombre: 'Blusa de seda', precio: 120,
    categoria: 'blusas', imagenPrincipal: 'blusa-negra.jpg',
    variantes: [
        { color: 'Negro', hex: '#000', talla: 'M', stock: 3, imagen: 'blusa-negra.jpg' },
        { color: 'Blanco', hex: '#fff', talla: 'M', stock: 5, imagen: 'blusa-blanca.jpg' }
    ],
    createdAt: new Date(AHORA)
}, { ahora: AHORA });

const nuevaBolsa = (storage) => crearBagStore({ storage, ventana: null });
const nuevaWishlist = (storage) => crearWishStore({ storage, ventana: null });

/* ======================================================================== */

describe('bag-store', () => {
    test('empieza vacío y guarda en UNA clave versionada', () => {
        const s = storageFalso();
        const bolsa = nuevaBolsa(s);
        assert.deepEqual(bolsa.getItems(), []);

        bolsa.add(C.buildCartItem(blusa(), { color: 'Negro', talla: 'M' }, 1));
        assert.deepEqual([...s.datos.keys()], ['aeris:bag']);
        const guardado = json(s, 'aeris:bag');
        assert.equal(guardado.v, 1);
        assert.equal(guardado.items.length, 1);
    });

    test('la misma selección suma cantidad; otra selección es otra línea', () => {
        const bolsa = nuevaBolsa(storageFalso());
        bolsa.add(C.buildCartItem(blusa(), { color: 'Negro', talla: 'M' }, 1));
        bolsa.add(C.buildCartItem(blusa(), { color: 'negro', talla: 'm' }, 2));
        bolsa.add(C.buildCartItem(blusa(), { color: 'Blanco', talla: 'M' }, 1));

        assert.equal(bolsa.getItems().length, 2);
        assert.equal(bolsa.count(), 4);
        assert.equal(bolsa.total(), 480);
        assert.equal(bolsa.cantidadDe('p:aaaaaaaaaaaaaaaaaaaaaa01:negro:M'), 3);
    });

    test('setCantidad cambia la línea; 0 la quita; remove y clear', () => {
        const bolsa = nuevaBolsa(storageFalso());
        const item = C.buildCartItem(blusa(), { color: 'Negro', talla: 'M' }, 1);
        bolsa.add(item);
        bolsa.add(C.buildCartItem(blusa(), { color: 'Blanco', talla: 'M' }, 1));

        bolsa.setCantidad(item.key, 3);
        assert.equal(bolsa.cantidadDe(item.key), 3);
        bolsa.setCantidad(item.key, 'abc'); // ignorado
        assert.equal(bolsa.cantidadDe(item.key), 3);
        bolsa.setCantidad(item.key, 0);
        assert.equal(bolsa.cantidadDe(item.key), 0);
        assert.equal(bolsa.getItems().length, 1);

        bolsa.remove(bolsa.getItems()[0].key);
        assert.equal(bolsa.count(), 0);
        bolsa.add(item);
        bolsa.clear();
        assert.deepEqual(bolsa.getItems(), []);
    });

    test('rechaza lo que no es un CartItem', () => {
        const bolsa = nuevaBolsa(storageFalso());
        assert.throws(() => bolsa.add({ id: 'x' }), { codigo: 'ITEM_INVALIDO' });
        assert.equal(bolsa.count(), 0);
    });

    test('lo que devuelve es una copia: mutarlo no cambia el store', () => {
        const bolsa = nuevaBolsa(storageFalso());
        const item = C.buildCartItem(blusa(), { color: 'Negro', talla: 'M' }, 1);
        bolsa.add(item);
        item.cantidad = 99;
        bolsa.getItems()[0].cantidad = 50;
        assert.equal(bolsa.count(), 1);
    });

    test('un solo evento: subscribe avisa al suscribirse y en cada cambio; se puede cancelar', () => {
        const bolsa = nuevaBolsa(storageFalso());
        const vistos = [];
        const cancelar = bolsa.subscribe(items => vistos.push(items.length));
        assert.deepEqual(vistos, [0]);

        bolsa.add(C.buildCartItem(blusa(), { color: 'Negro', talla: 'M' }, 1));
        bolsa.add(C.buildCartItem(blusa(), { color: 'Blanco', talla: 'M' }, 1));
        assert.deepEqual(vistos, [0, 1, 2]);

        cancelar();
        bolsa.clear();
        assert.deepEqual(vistos, [0, 1, 2]);
    });

    test('un suscriptor que falla no impide avisar a los demás', () => {
        const bolsa = nuevaBolsa(storageFalso());
        const errorOriginal = console.error;
        console.error = () => {};
        try {
            let llamadas = 0;
            bolsa.subscribe(() => { throw new Error('boom'); });
            bolsa.subscribe(() => { llamadas++; });
            bolsa.clear();
            assert.equal(llamadas, 2);
        } finally {
            console.error = errorOriginal;
        }
    });

    test('recupera lo guardado al recargar la página', () => {
        const s = storageFalso();
        nuevaBolsa(s).add(C.buildCartItem(blusa(), { color: 'Negro', talla: 'M' }, 2));
        assert.equal(nuevaBolsa(s).count(), 2);
    });

    test('otra versión guardada o claves ajenas: empieza vacío y no las toca', () => {
        const s = storageFalso({
            'aeris:bag': JSON.stringify({ v: 99, items: [] }),
            aeris_cart: JSON.stringify([{ id: 'abc', precio: 1, cantidad: 2 }])
        });
        assert.deepEqual(nuevaBolsa(s).getItems(), []);
        assert.notEqual(s.getItem('aeris_cart'), null);
    });

    test('datos corruptos o items con mala forma no rompen la página', () => {
        assert.deepEqual(nuevaBolsa(storageFalso({ 'aeris:bag': '{no es json' })).getItems(), []);

        const s = storageFalso({
            'aeris:bag': JSON.stringify({ v: 1, items: [{ id: 'x' }, null, 'basura'] })
        });
        assert.deepEqual(nuevaBolsa(s).getItems(), []);
    });

    test('sin localStorage funciona en memoria', () => {
        const bolsa = nuevaBolsa(null);
        bolsa.add(C.buildCartItem(blusa(), { color: 'Negro', talla: 'M' }, 1));
        assert.equal(bolsa.count(), 1);
    });

    test('si guardar falla (cuota llena), el cambio queda en memoria', () => {
        const s = storageFalso();
        const bolsa = nuevaBolsa(s);
        s.setItem = () => { throw new Error('QuotaExceededError'); };
        bolsa.add(C.buildCartItem(blusa(), { color: 'Negro', talla: 'M' }, 1));
        assert.equal(bolsa.count(), 1);
    });

    test('se sincroniza cuando otra pestaña cambia la bolsa', () => {
        const s = storageFalso();
        const ventana = new EventTarget();
        const bolsa = crearBagStore({ storage: s, ventana });
        const vistos = [];
        bolsa.subscribe(items => vistos.push(items.length));

        // "Otra pestaña" escribe directamente en el mismo storage.
        nuevaBolsa(s).add(C.buildCartItem(blusa(), { color: 'Negro', talla: 'M' }, 1));
        ventana.dispatchEvent(eventoStorage('aeris:otra-cosa'));
        assert.deepEqual(vistos, [0]);
        ventana.dispatchEvent(eventoStorage('aeris:bag'));
        assert.deepEqual(vistos, [0, 1]);
        assert.equal(bolsa.count(), 1);
    });
});

/* ======================================================================== */

describe('wish-store', () => {
    test('toggle agrega y quita; has y count', () => {
        const s = storageFalso();
        const favs = nuevaWishlist(s);
        const dto = blusa();

        assert.equal(favs.toggle(dto), true);
        assert.equal(favs.has(dto.id), true);
        assert.equal(favs.count(), 1);
        assert.equal(favs.getItems()[0].url, '/producto/1-blusa-de-seda');
        assert.deepEqual([...s.datos.keys()], ['aeris:wishlist']);

        assert.equal(favs.toggle(dto), false);
        assert.equal(favs.has(dto.id), false);
    });

    test('add no duplica y acepta un WishItem ya hecho', () => {
        const favs = nuevaWishlist(storageFalso());
        favs.add(blusa());
        favs.add(C.buildWishItem(blusa()));
        assert.equal(favs.count(), 1);
    });

    test('rechaza un producto sin id', () => {
        const favs = nuevaWishlist(storageFalso());
        assert.throws(() => favs.add({ nombre: 'x' }), { codigo: 'PRODUCTO_INVALIDO' });
    });

    test('subscribe avisa en cada cambio', () => {
        const favs = nuevaWishlist(storageFalso());
        const vistos = [];
        favs.subscribe(items => vistos.push(items.map(f => f.id)));
        favs.toggle(blusa());
        favs.clear();
        assert.deepEqual(vistos, [[], ['aaaaaaaaaaaaaaaaaaaaaa01'], []]);
    });

    test('bolsa y wishlist no se pisan', () => {
        const s = storageFalso();
        const bolsa = nuevaBolsa(s);
        const favs = nuevaWishlist(s);
        bolsa.add(C.buildCartItem(blusa(), { color: 'Negro', talla: 'M' }, 1));
        favs.toggle(blusa());
        bolsa.clear();
        assert.equal(favs.count(), 1);
        assert.deepEqual([...s.datos.keys()].sort(), ['aeris:bag', 'aeris:wishlist']);
    });
});

/* ======================================================================== */

const { crearPedidosStore, MAXIMO } = require('../public/js/core/pedidos-store');
const P = require('../public/js/core/pedido');

describe('pedidos-store ("Pedidos", guardado en el navegador)', () => {
    const nuevosPedidos = (storage) => crearPedidosStore({ storage, ventana: null });
    const item = () => C.buildCartItem(blusa(), { color: 'Negro', talla: 'M' }, 2);
    const pedido = (codigo, fecha = new Date('2026-11-01T15:30:00Z')) => P.pedidoParaGuardar({
        codigo, items: [item()], entrega: 'lima', promo: null, envioGratis: false, mensaje: 'Hola, AERIS.', fecha,
        lineas: [{ titulo: 'Blusa de seda', precio: 120, cantidad: 2, color: 'Negro', talla: 'M', componentes: [] }]
    });

    test('el pedido guardado lleva lo necesario para verlo y volver a pedirlo; empieza sin enviar', () => {
        const p = pedido('AER-0043');
        assert.equal(p.id, 'AER-0043');
        assert.equal(p.enviado, false);
        assert.deepEqual(p.totales, { subtotal: 240, descuento: 0, total: 240 });
        const l = p.lineas[0];
        assert.equal(l.id, item().id);
        assert.equal(l.tipo, 'prenda');
        assert.equal(l.imagen, '/images/productos/blusa-negra.jpg');
        assert.match(l.url, /^\/producto\//);
        // Sin código (la tienda no respondió): id local
        assert.match(pedido(null).id, /^L-\d+$/);
        assert.equal(pedido(null).codigo, null);
    });

    test('el más reciente queda primero; se guarda en UNA clave; marcarEnviado es la única marca', () => {
        const s = storageFalso();
        const ps = nuevosPedidos(s);
        ps.agregar(pedido('AER-0001'));
        ps.agregar(pedido('AER-0002'));
        assert.deepEqual(ps.getItems().map(p => p.id), ['AER-0002', 'AER-0001']);
        assert.equal(ps.count(), 2);
        ps.marcarEnviado('AER-0001');
        assert.deepEqual(ps.getItems().map(p => p.enviado), [false, true]);
        assert.deepEqual([...s.datos.keys()], ['aeris:pedidos']);
        assert.equal(json(s, 'aeris:pedidos').v, 1);
        // Se recupera al recargar la página
        assert.deepEqual(nuevosPedidos(s).getItems().map(p => p.id), ['AER-0002', 'AER-0001']);
    });

    test('el mismo código no se duplica; se guardan como máximo los últimos 50', () => {
        const ps = nuevosPedidos(storageFalso());
        ps.agregar(pedido('AER-0001'));
        ps.agregar(pedido('AER-0001'));
        assert.equal(ps.count(), 1);
        for (let i = 2; i <= MAXIMO + 5; i++) ps.agregar(pedido('AER-' + String(i).padStart(4, '0')));
        assert.equal(ps.count(), MAXIMO);
        assert.equal(ps.getItems()[0].id, 'AER-0055');
    });

    test('rechaza un pedido mal formado y descarta lo guardado roto', () => {
        const ps = nuevosPedidos(storageFalso());
        assert.throws(() => ps.agregar({ id: 'x' }), C.CartItemError);
        const s = storageFalso({ 'aeris:pedidos': JSON.stringify({ v: 1, items: [{ id: 'roto' }, pedido('AER-0009')] }) });
        assert.deepEqual(nuevosPedidos(s).getItems().map(p => p.id), ['AER-0009']);
    });
});
