const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { crearProductRepository } = require('../repositories/productRepository');
const { construirCatalogo } = require('../services/syncService');
const Product = require('../models/product');
const CatalogMeta = require('../models/catalogMeta');
const F = require('./fixtures/realCatalog');

const { documentos, meta } = construirCatalogo({
    productos: F.hojaProductos, variantes: F.hojaVariantes,
    categorias: F.hojaCategorias, familiasColor: F.hojaFamilias, tallas: F.hojaTallas
});

/** Modelos de Mongoose falsos que solo anotan lo que se les pide. */
function modelosFalsos({ metaGuardada = null } = {}) {
    const registro = {};
    const Producto = {
        find: (filtro) => { registro.find = filtro; return { lean: async () => [{ idExcel: 1 }] }; },
        bulkWrite: async (ops, opciones) => { registro.bulkWrite = { ops, opciones }; },
        deleteMany: async (filtro) => { registro.deleteMany = filtro; return { deletedCount: 2 }; }
    };
    const Meta = {
        findById: (id) => { registro.findById = id; return { lean: async () => metaGuardada }; },
        replaceOne: async (filtro, doc, opciones) => { registro.replaceOne = { filtro, doc, opciones }; }
    };
    return { Producto, Meta, registro };
}

describe('productRepository — operaciones contra Mongo', () => {
    test('upsertMuchos: un upsert por idExcel, limpia los campos heredados y no se detiene ante un fallo', async () => {
        const { Producto, Meta, registro } = modelosFalsos();
        await crearProductRepository({ Producto, Meta }).upsertMuchos(documentos);

        const { ops, opciones } = registro.bulkWrite;
        assert.equal(ops.length, 6);
        assert.deepEqual(opciones, { ordered: false });
        ops.forEach((op, i) => {
            assert.deepEqual(op.updateOne.filter, { idExcel: documentos[i].idExcel });
            assert.equal(op.updateOne.upsert, true);
            assert.deepEqual(op.updateOne.update.$set, documentos[i]);
            assert.deepEqual(Object.keys(op.updateOne.update.$unset).sort(), ['etiquetas', 'familiaColor', 'productosIncluidos']);
        });
    });

    test('upsertMuchos con lista vacía no llama a la base de datos', async () => {
        const { Producto, Meta, registro } = modelosFalsos();
        await crearProductRepository({ Producto, Meta }).upsertMuchos([]);
        assert.equal(registro.bulkWrite, undefined);
    });

    test('eliminarAusentes: borra todo lo que NO esté en la lista y devuelve cuántos', async () => {
        const { Producto, Meta, registro } = modelosFalsos();
        const n = await crearProductRepository({ Producto, Meta }).eliminarAusentes([1, 2, 3]);
        assert.deepEqual(registro.deleteMany, { idExcel: { $nin: [1, 2, 3] } });
        assert.equal(n, 2);
    });

    test('guardarMeta: reemplaza el documento único de tablas (upsert)', async () => {
        const { Producto, Meta, registro } = modelosFalsos();
        await crearProductRepository({ Producto, Meta }).guardarMeta(meta);
        assert.deepEqual(registro.replaceOne.filtro, { _id: 'tablas' });
        assert.deepEqual(registro.replaceOne.doc, { categorias: meta.categorias, familiasColor: meta.familiasColor, tallas: meta.tallas, promociones: meta.promociones });
        assert.deepEqual(registro.replaceOne.opciones, { upsert: true });
    });

    test('leerMeta: devuelve las tablas guardadas, o tablas vacías si aún no hubo ningún sync', async () => {
        const guardada = modelosFalsos({ metaGuardada: { _id: 'tablas', ...meta, __v: 0 } });
        assert.deepEqual(await crearProductRepository(guardada).leerMeta(), meta);
        assert.equal(guardada.registro.findById, 'tablas');

        const vacia = modelosFalsos({ metaGuardada: null });
        assert.deepEqual(await crearProductRepository(vacia).leerMeta(), { categorias: [], familiasColor: [], tallas: [], promociones: [] });
    });
});

describe('esquemas de Mongoose aceptan lo que produce el sync', () => {
    test('los 6 documentos de la hoja real pasan la validación del modelo Product', () => {
        for (const doc of documentos) {
            const error = new Product(doc).validateSync();
            assert.equal(error, undefined, `producto ${doc.idExcel}: ${error && error.message}`);
        }
    });

    test('las tablas de apoyo pasan la validación del modelo CatalogMeta', () => {
        const error = new CatalogMeta({ _id: 'tablas', ...meta }).validateSync();
        assert.equal(error, undefined, error && error.message);
    });

    test('una variante sin familia (el diseño anterior) ya no es válida para escribir', () => {
        const { familia, ...sinFamilia } = documentos[0].variantes[0];
        const error = new Product({ ...documentos[0], variantes: [sinFamilia] }).validateSync();
        assert.ok(error && /familia/.test(error.message));
    });

    test('los campos heredados siguen declarados en el esquema (para poder hacer $unset)', () => {
        for (const campo of ['familiaColor', 'etiquetas', 'productosIncluidos']) {
            assert.ok(Product.schema.path(campo), campo);
        }
    });
});
