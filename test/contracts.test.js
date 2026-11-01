const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const C = require('../public/js/core/contracts');
const { toProductDTO } = require('../utils/productNormalizer');

const AHORA = Date.parse('2026-10-29T12:00:00Z');
const oid = (hex) => ({ toString: () => hex });

const rawBlusa = () => ({
    _id: oid('aaaaaaaaaaaaaaaaaaaaaa01'), idExcel: 1, nombre: 'Blusa de seda', precio: 120,
    categoria: 'blusas', imagenPrincipal: 'blusa-negra.jpg',
    variantes: [
        { color: 'Negro', hex: '#000', talla: 'M', stock: 3, imagen: 'blusa-negra.jpg' },
        { color: 'Negro', hex: '#000', talla: 'S', stock: 0, imagen: 'blusa-negra.jpg' },
        { color: 'Blanco', hex: '#fff', talla: 'M', stock: 5, imagen: 'blusa-blanca.jpg' }
    ],
    createdAt: new Date(AHORA - 100 * 86400000)
});
const rawPantalon = () => ({
    _id: oid('aaaaaaaaaaaaaaaaaaaaaa02'), idExcel: 2, nombre: 'Pantalón', precio: 150,
    categoria: 'pantalones', imagenPrincipal: 'pantalon.jpg',
    variantes: [{ color: 'Beige', hex: '#d2b48c', talla: '38', stock: 2, imagen: 'pantalon.jpg' }],
    createdAt: new Date(AHORA - 100 * 86400000)
});
const rawConjunto = () => ({
    _id: oid('aaaaaaaaaaaaaaaaaaaaaa03'), idExcel: 3, nombre: 'Conjunto Noir', precio: 250,
    categoria: 'conjuntos', esConjunto: true, imagenPrincipal: 'noir.jpg',
    productosIncluidosIds: [1, 2], createdAt: new Date(AHORA - 100 * 86400000)
});

const blusa = () => toProductDTO(rawBlusa(), { ahora: AHORA });
const conjunto = () => toProductDTO(rawConjunto(), { catalogo: [rawBlusa(), rawPantalon(), rawConjunto()], ahora: AHORA });

describe('buildCartItem — prenda', () => {
    test('construye un CartItem válido con color/talla canónicos y la foto del color', () => {
        const item = C.buildCartItem(blusa(), { color: 'blanco', talla: 'm' }, 2);

        assert.equal(item.tipo, 'prenda');
        assert.equal(item.id, 'aaaaaaaaaaaaaaaaaaaaaa01');
        assert.equal(item.color, 'Blanco');
        assert.equal(item.talla, 'M');
        assert.equal(item.cantidad, 2);
        assert.equal(item.imagen, '/images/productos/blusa-blanca.jpg');
        assert.equal(item.url, '/producto/1-blusa-de-seda');
        assert.deepEqual(item.componentes, []);
        assert.equal(item.key, 'p:aaaaaaaaaaaaaaaaaaaaaa01:blanco:M');
    });

    test('rechaza selecciones inválidas con un código estable', () => {
        const dto = blusa();
        const codigo = (sel, cant) => {
            try { C.buildCartItem(dto, sel, cant); } catch (e) { return e.codigo; }
            return 'OK';
        };
        assert.equal(codigo({ color: 'Rojo', talla: 'M' }), 'COLOR_INVALIDO');
        assert.equal(codigo({ color: 'Negro', talla: 'XL' }), 'TALLA_INVALIDA');
        assert.equal(codigo({ color: 'Negro', talla: 'S' }), 'SIN_STOCK');
        assert.equal(codigo({ color: 'Negro', talla: 'M' }, 4), 'STOCK_INSUFICIENTE');
        assert.equal(codigo({ color: 'Negro', talla: 'M' }, 3), 'OK');
        assert.equal(codigo({}), 'COLOR_INVALIDO');
    });

    test('prenda sin opciones de color/talla → color y talla null (no "Único")', () => {
        const dto = toProductDTO({ _id: oid('cc'), nombre: 'Pañuelo', precio: 30, variantes: [{ color: '', talla: '', stock: 5, imagen: '' }] });
        const item = C.buildCartItem(dto, {}, 1);
        assert.equal(item.color, null);
        assert.equal(item.talla, null);
    });

    test('cantidad inválida se corrige a 1', () => {
        assert.equal(C.buildCartItem(blusa(), { color: 'Blanco', talla: 'M' }, 'x').cantidad, 1);
        assert.equal(C.buildCartItem(blusa(), { color: 'Blanco', talla: 'M' }, -3).cantidad, 1);
    });
});

describe('buildCartItem — conjunto', () => {
    const seleccion = (dto, colorBlusa = 'Negro') => ({
        componentes: [
            { id: dto.piezas[0].id, color: 'Negro', talla: 'M' },
            { id: dto.piezas[1].id, color: 'Beige', talla: '38' }
        ].map(c => c.id === dto.piezas[0].id ? { ...c, color: colorBlusa } : c)
    });

    test('un conjunto conserva TODAS sus piezas elegidas (el bug del bottom sheet)', () => {
        const dto = conjunto();
        // Orden de la hoja: blusa (1) y pantalón (2)
        const item = C.buildCartItem(dto, {
            componentes: [
                { id: dto.piezas[0].id, color: 'Blanco', talla: 'M' },
                { id: dto.piezas[1].id, color: 'Beige', talla: '38' }
            ]
        });

        assert.equal(item.tipo, 'conjunto');
        assert.equal(item.color, null);
        assert.deepEqual(item.componentes, [
            { id: 'aaaaaaaaaaaaaaaaaaaaaa01', nombre: 'Blusa de seda', color: 'Blanco', talla: 'M' },
            { id: 'aaaaaaaaaaaaaaaaaaaaaa02', nombre: 'Pantalón', color: 'Beige', talla: '38' }
        ]);
        assert.equal(item.url, '/conjunto/3-conjunto-noir');
    });

    test('selecciones distintas del mismo conjunto son líneas distintas; la misma, se fusiona', () => {
        const dto = conjunto();
        const a = C.buildCartItem(dto, seleccion(dto, 'Negro'));
        const b = C.buildCartItem(dto, seleccion(dto, 'Blanco'));
        const c = C.buildCartItem(dto, seleccion(dto, 'Negro'));

        assert.notEqual(a.key, b.key);
        assert.equal(a.key, c.key);
    });

    test('falta elegir una pieza → COMPONENTE_FALTANTE', () => {
        const dto = conjunto();
        assert.throws(
            () => C.buildCartItem(dto, { componentes: [{ id: dto.piezas[0].id, color: 'Negro', talla: 'M' }] }),
            (e) => e.codigo === 'COMPONENTE_FALTANTE'
        );
    });

    test('conjunto sin piezas → CONJUNTO_SIN_PIEZAS', () => {
        const dto = toProductDTO(rawConjunto(), { catalogo: [], ahora: AHORA });
        assert.throws(() => C.buildCartItem(dto, {}), (e) => e.codigo === 'CONJUNTO_SIN_PIEZAS');
    });
});

describe('WishItem', () => {
    test('buildWishItem guarda el tipo (para enlazar bien los conjuntos)', () => {
        const fav = C.buildWishItem(conjunto());
        assert.equal(fav.tipo, 'conjunto');
        assert.equal(fav.url, '/conjunto/3-conjunto-noir');
        assert.equal(fav.imagen, '/images/productos/noir.jpg');
    });
});
