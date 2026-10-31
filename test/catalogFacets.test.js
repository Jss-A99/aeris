const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { calcularFiltros } = require('../utils/catalogFacets');
const { toProductDTOList } = require('../utils/productNormalizer');

/** Tablas de apoyo como las guarda el sync (las mismas de la hoja real). */
const META = {
    categorias: [
        { id: 'blusas', nombre: 'Blusas', orden: 1, contienePiezas: false },
        { id: 'pantalones', nombre: 'Pantalones', orden: 2, contienePiezas: false },
        { id: 'vestidos', nombre: 'Vestidos', orden: 3, contienePiezas: false },
        { id: 'conjuntos', nombre: 'Conjuntos', orden: 4, contienePiezas: true }
    ],
    familiasColor: [
        { id: 'negro', nombre: 'Negro', hex: '#171717' },
        { id: 'blanco', nombre: 'Blanco', hex: '#FFFFFF' },
        { id: 'beige', nombre: 'Beige', hex: '#D4C3B3' },
        { id: 'verde', nombre: 'Verde', hex: '#4A5240' },
        { id: 'vino', nombre: 'Vino', hex: '#581825' }
    ],
    tallas: [
        { talla: 'S', orden: 1 }, { talla: 'M', orden: 2 }, { talla: 'L', orden: 3 },
        { talla: 'XL', orden: 4 }, { talla: 'XXL', orden: 5 }, { talla: '3XL', orden: 6 },
        { talla: '28', orden: 20 }, { talla: '30', orden: 21 }, { talla: '32', orden: 22 },
        { talla: '34', orden: 23 }, { talla: '36', orden: 24 }, { talla: '38', orden: 25 }
    ]
};

/** Variante: [color, hex, familia, talla] */
const v = (color, hex, familia, talla) => ({ color, hex, familia, talla, stock: 2, imagen: 'a.jpg' });
const talla = (t) => v('Negro', '#171717', 'Negro', t);

/** Construye DTO reales a partir de documentos mínimos. */
function dtos(...productos) {
    return toProductDTOList(productos.map((p, i) => ({
        _id: String(i + 1).padStart(24, '0'),
        idExcel: i + 1,
        nombre: `Producto ${i + 1}`,
        precio: p.precio === undefined ? 100 : p.precio,
        categoria: p.categoria || 'blusas',
        imagenPrincipal: 'a.jpg',
        esConjunto: p.esConjunto,
        productosIncluidosIds: p.incluye,
        variantes: p.variantes || []
    })));
}

describe('tallas: salen de la base de datos, todas y solo ellas', () => {
    test('con la tabla TALLAS manda su columna Orden; las que no figuran van después', () => {
        const f = calcularFiltros(dtos(
            { variantes: ['M', 'ÚNICA', '4XL', 'L', '38', '36'].map(talla) }
        ), META);

        assert.deepEqual(f.tallas.letras.slice(0, 2), ['M', 'L']);
        assert.deepEqual([...f.tallas.letras.slice(2)].sort(), ['4XL', 'ÚNICA']);   // aparecen aunque no estén en la tabla
        assert.deepEqual(f.tallas.numericas, ['36', '38']);
    });

    test('un orden "raro" en la tabla se respeta (no hay orden escrito en el código)', () => {
        const meta = { ...META, tallas: [{ talla: 'L', orden: 1 }, { talla: 'M', orden: 2 }, { talla: 'S', orden: 3 }] };
        const f = calcularFiltros(dtos({ variantes: ['S', 'M', 'L'].map(talla) }), meta);
        assert.deepEqual(f.tallas.letras, ['L', 'M', 'S']);
    });

    test('nunca se inventan tallas: si la base solo tiene M y L, solo salen M y L (aunque la tabla tenga más)', () => {
        const f = calcularFiltros(dtos({ variantes: [talla('L'), talla('M')] }), META);
        assert.deepEqual(f.tallas, { letras: ['M', 'L'], numericas: [] });
    });

    test('sin tabla (datos antiguos) usa un orden de respaldo: XL, S, XXS, M → XXS, S, M, XL', () => {
        const f = calcularFiltros(dtos({ variantes: ['XL', 'S', 'XXS', 'M'].map(talla) }));
        assert.deepEqual(f.tallas.letras, ['XXS', 'S', 'M', 'XL']);
    });

    test('las numéricas se ordenan como números (8 antes que 10) y se juntan las de todos los productos', () => {
        const f = calcularFiltros(dtos(
            { variantes: ['10', '36'].map(talla) },
            { variantes: ['8', '10'].map(talla) }
        ));
        assert.deepEqual(f.tallas.numericas, ['8', '10', '36']);
    });

    test('un conjunto aporta las tallas de sus piezas sin duplicarlas', () => {
        const f = calcularFiltros(dtos(
            { variantes: [talla('S')] },
            { variantes: [talla('S'), talla('38')] },
            { categoria: 'conjuntos', esConjunto: true, incluye: [1, 2] }
        ), META);
        assert.deepEqual(f.tallas, { letras: ['S'], numericas: ['38'] });
    });
});

describe('familias de color: nombre y HEX salen de la tabla FAMILIAS COLOR', () => {
    test('solo aparecen las familias que usa algún producto, con el HEX de la tabla', () => {
        const f = calcularFiltros(dtos(
            { variantes: [v('Negro', '#171717', 'Negro', 'M'), v('Vino', '#581825', 'Vino', 'M')] }
        ), META);
        assert.deepEqual(f.familiasColor, [
            { id: 'negro', nombre: 'Negro', hex: '#171717' },
            { id: 'vino', nombre: 'Vino', hex: '#581825' }
        ]);
    });

    test('colores distintos de una misma familia ("Verde Kaki", "Verde Agua") dan UNA sola entrada con el HEX de la familia', () => {
        const f = calcularFiltros(dtos(
            { variantes: [v('Verde Kaki', '#4a5240', 'Verde', 'M')] },
            { variantes: [v('Verde Agua', '#7fd1ae', 'Verde', 'M')] }
        ), META);
        assert.deepEqual(f.familiasColor, [{ id: 'verde', nombre: 'Verde', hex: '#4a5240' }]);
    });

    test('el HEX sale en minúsculas aunque la tabla lo tenga en mayúsculas', () => {
        const f = calcularFiltros(dtos({ variantes: [v('Blanco', '#FFFFFF', 'Blanco', 'M')] }), META);
        assert.equal(f.familiasColor[0].hex, '#ffffff');
    });

    test('NO se adivina nada: una familia que no está en la tabla sale con nombre capitalizado y hex null', () => {
        const f = calcularFiltros(dtos({ variantes: [v('Cereza', '#990033', 'Fucsia', 'M')] }), META);
        assert.deepEqual(f.familiasColor, [{ id: 'fucsia', nombre: 'Fucsia', hex: null }]);
    });

    test('mayúsculas y espacios distintos se unifican en una sola familia', () => {
        const f = calcularFiltros(dtos(
            { variantes: [v('Negro', '#000', 'Negro', 'M')] },
            { variantes: [v('Negro', '#000', ' negro ', 'M')] },
            { variantes: [v('Negro', '#000', 'NEGRO', 'M')] }
        ), META);
        assert.deepEqual(f.familiasColor.map(c => c.id), ['negro']);
    });

    test('orden alfabético por nombre visible', () => {
        const f = calcularFiltros(dtos(
            { variantes: [v('Vino', '#581825', 'Vino', 'M'), v('Beige', '#d4c3b3', 'Beige', 'M'), v('Negro', '#171717', 'Negro', 'M')] }
        ), META);
        assert.deepEqual(f.familiasColor.map(c => c.nombre), ['Beige', 'Negro', 'Vino']);
    });

    test('sin variantes con familia, no hay filtro de color', () => {
        assert.deepEqual(calcularFiltros(dtos({ variantes: [] }), META).familiasColor, []);
    });

    test('son datos, no estilos: ni clases CSS ni colores escritos en el código', () => {
        const f = calcularFiltros(dtos({ variantes: [talla('M')] }), META);
        assert.deepEqual(Object.keys(f.familiasColor[0]).sort(), ['hex', 'id', 'nombre']);
    });
});

describe('precio y categorías', () => {
    test('rango real del catálogo, redondeado hacia afuera; los precios 0 se ignoran', () => {
        const f = calcularFiltros(dtos({ precio: 80.5 }, { precio: 199.2 }, { precio: 0 }), META);
        assert.deepEqual(f.precio, { min: 80, max: 200 });
    });

    test('catálogo vacío o sin datos: valores por defecto, sin errores', () => {
        for (const entrada of [[], undefined, null]) {
            const f = calcularFiltros(entrada);
            assert.deepEqual(f.precio, { min: 0, max: 500 });
            assert.deepEqual(f.tallas, { letras: [], numericas: [] });
            assert.deepEqual(f.familiasColor, []);
            assert.deepEqual(f.categorias, []);
        }
    });

    test('categorías: nombre visible y orden de la tabla CATEGORÍAS, solo las que tienen productos', () => {
        const f = calcularFiltros(dtos({ categoria: 'vestidos' }, { categoria: 'blusas' }, { categoria: 'blusas' }), META);
        assert.deepEqual(f.categorias, [
            { id: 'blusas', nombre: 'Blusas' },
            { id: 'vestidos', nombre: 'Vestidos' }
        ]);
    });

    test('una categoría que no está en la tabla (dato antiguo) va al final, capitalizada', () => {
        const f = calcularFiltros(dtos({ categoria: 'abrigos' }, { categoria: 'blusas' }), META);
        assert.deepEqual(f.categorias, [
            { id: 'blusas', nombre: 'Blusas' },
            { id: 'abrigos', nombre: 'Abrigos' }
        ]);
    });
});
