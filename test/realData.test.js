const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { construirCatalogo } = require('../services/syncService');
const { toProductDTOList, toProductDTO } = require('../utils/productNormalizer');
const { validarProductDTO } = require('../utils/productContract');
const { calcularFiltros } = require('../utils/catalogFacets');
const F = require('./fixtures/realCatalog');

/**
 * PRUEBAS CON DATOS REALES de AERIS (hoja ya migrada al contrato nuevo + documentos del diseño
 * anterior copiados de MongoDB Atlas). Si el formato real cambia, estas pruebas lo dicen antes
 * que la tienda.
 */
const { documentos, meta, errores, advertencias } = construirCatalogo({
    productos: F.hojaProductos,
    variantes: F.hojaVariantes,
    categorias: F.hojaCategorias,
    familiasColor: F.hojaFamilias,
    tallas: F.hojaTallas
});
const ordenTallas = new Map(meta.tallas.map(t => [t.talla, t.orden]));

/** Lo que Mongo tendría después del sync: documentos + _id y fecha que asigna la base de datos. */
const enMongo = () => documentos.map((d, i) => ({
    ...d, _id: String(i + 1).padStart(24, '0'), createdAt: new Date('2026-10-30T12:00:00Z')
}));
const catalogo = () => toProductDTOList(enMongo(), { ordenTallas });

describe('la hoja real (AERIS - INVENTARIO) pasa la validación', () => {
    test('sin errores ni advertencias', () => {
        assert.deepEqual(errores, []);
        assert.deepEqual(advertencias, []);
        assert.equal(documentos.length, 6);
    });
});

describe('catálogo real: del sync al mapper', () => {
    test('todo el catálogo cumple el contrato', () => {
        const dtos = catalogo();
        assert.equal(dtos.length, 6);
        assert.deepEqual(dtos.flatMap(validarProductDTO), []);
    });

    test('URLs canónicas: Producto_ID + slug sin tildes', () => {
        assert.deepEqual(catalogo().map(d => d.url), [
            '/producto/1-blusa-seda-basica',
            '/producto/2-pantalon-sastre-ancho',
            '/producto/3-pantalon-cargo-urbano',
            '/producto/4-vestido-midi-abertura',
            '/producto/5-vestido-lino-cruzado',
            '/conjunto/6-conjunto-sastre-urbano'
        ]);
    });

    test('el vestido negro con una variante vino ya expone AMBAS familias (el caso que fallaba)', () => {
        const vestido = catalogo().find(d => d.sku === 4);
        assert.deepEqual(vestido.familiasColor, ['negro', 'vino']);
        assert.deepEqual(vestido.colores.map(c => [c.nombre, c.familia, c.hex]), [
            ['Negro', 'negro', '#171717'],
            ['Vino', 'vino', '#581825']
        ]);
        assert.deepEqual(vestido.tallas, ['M', 'XL', 'XXL']);
        assert.equal(vestido.stockTotal, 15);
    });

    test('el conjunto resuelve sus piezas en el orden de la hoja y une sus familias', () => {
        const conjunto = catalogo().find(d => d.sku === 6);
        assert.deepEqual(conjunto.piezas.map(p => p.nombre), ['Blusa Seda Básica', 'Pantalón Sastre Ancho']);
        assert.equal(conjunto.agotado, false);
        assert.deepEqual(conjunto.variantes, []);
        assert.deepEqual([...conjunto.familiasColor].sort(), ['beige', 'blanco', 'negro']);
    });

    test('descuentos reales: 23 %, 23 % y 25 %; el resto sin descuento', () => {
        assert.deepEqual(catalogo().map(d => d.descuentoPct), [0, 23, 23, 0, 25, 0]);
    });

    test('"Nuevo" viene de la casilla: ninguno marcado, ninguno nuevo', () => {
        assert.ok(catalogo().every(d => d.esNuevo === false));
    });

    test('últimas unidades por variante (umbral 3): pantalón cargo 36 (1) y 34 (2), vestido vino XL (3), blusa negra M (2)', () => {
        const dtos = catalogo();
        const poco = (sku) => dtos.find(d => d.sku === sku).variantes.filter(v => v.ultimasUnidades).map(v => `${v.color} ${v.talla}`);
        assert.deepEqual(poco(3), ['Verde Kaki 36', 'Verde Kaki 34']);
        assert.deepEqual(poco(4), ['Vino XL']);
        assert.deepEqual(poco(1), ['Negro M']);
    });
});

describe('filtros del catálogo real: todo sale de las tablas de la hoja', () => {
    const filtros = calcularFiltros(catalogo(), meta);

    test('categorías con su nombre visible y en el orden de la hoja', () => {
        assert.deepEqual(filtros.categorias, [
            { id: 'blusas', nombre: 'Blusas' },
            { id: 'pantalones', nombre: 'Pantalones' },
            { id: 'vestidos', nombre: 'Vestidos' },
            { id: 'conjuntos', nombre: 'Conjuntos' }
        ]);
    });

    test('precio y tallas (solo las que existen, ordenadas por la tabla TALLAS)', () => {
        assert.deepEqual(filtros.precio, { min: 79, max: 170 });
        assert.deepEqual(filtros.tallas, { letras: ['M', 'XL', 'XXL'], numericas: ['30', '32', '34', '36'] });
    });

    test('familias: nombre y HEX de la tabla FAMILIAS COLOR (Vino incluido; Blanco Crema cae en Blanco)', () => {
        assert.deepEqual(filtros.familiasColor, [
            { id: 'beige', nombre: 'Beige', hex: '#d4c3b3' },
            { id: 'blanco', nombre: 'Blanco', hex: '#ffffff' },
            { id: 'negro', nombre: 'Negro', hex: '#171717' },
            { id: 'verde', nombre: 'Verde', hex: '#4a5240' },
            { id: 'vino', nombre: 'Vino', hex: '#581825' }
        ]);
    });
});

describe('compatibilidad: documentos del diseño anterior que aún están en Mongo', () => {
    test('la prenda real antigua (sin familia en las variantes) sigue cumpliendo el contrato', () => {
        const dto = toProductDTO(F.mongoPrendaReal);

        assert.deepEqual(validarProductDTO(dto), []);
        assert.equal(dto.id, '6ad800aee46279ad1388e4a1');
        assert.equal(dto.url, '/producto/4-vestido-midi-abertura');
        assert.equal(dto.creadoEn, '2026-10-21T00:00:46.846Z');
        assert.deepEqual(dto.familiasColor, ['negro']);              // respaldo: familiaColor antiguo
        assert.equal(dto.esNuevo, false);                             // sin la casilla, nunca "nuevo"
        assert.equal(dto.publicado, true);                            // sin el campo, se considera publicado
        assert.equal(dto.stockTotal, 15);
    });

    test('el conjunto real antiguo resuelve sus piezas por productosIncluidosIds', () => {
        const antiguos = enMongo().map(d => ({ ...d, familiaColor: undefined }));
        antiguos[5] = F.mongoConjuntoReal;
        const conjunto = toProductDTOList(antiguos).find(d => d.sku === 6);
        assert.deepEqual(validarProductDTO(conjunto), []);
        assert.equal(conjunto.id, '6ad800aee46279ad1388e4a3');
        assert.deepEqual(conjunto.piezas.map(p => p.nombre), ['Blusa Seda Básica', 'Pantalón Sastre Ancho']);
    });
});
