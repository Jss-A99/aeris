const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { crearCatalogService } = require('../services/catalogService');
const { toProductDTOList } = require('../utils/productNormalizer');
const { validarProductDTO } = require('../utils/productContract');

const AHORA = Date.parse('2026-10-29T12:00:00Z');
const dias = (n) => new Date(AHORA - n * 86400000);
const oid = (hex) => ({ toString: () => hex });

const variante = (color, hex, familia, talla, stock = 3) => ({ color, hex, familia, talla, stock, imagen: `${color.toLowerCase()}.jpg` });

const catalogoCrudo = () => [
    {
        _id: oid('a'.repeat(23) + '1'), idExcel: 1, nombre: 'Blusa', descripcion: '-', precio: 120, categoria: 'blusas',
        imagenPrincipal: 'blusa.jpg', createdAt: dias(100),
        variantes: [variante('Negro', '#000', 'Negro', 'M'), variante('Negro', '#000', 'Negro', 'S')]
    },
    {
        _id: oid('a'.repeat(23) + '2'), idExcel: 2, nombre: 'Pantalón', descripcion: '-', precio: 80.5, categoria: 'pantalones',
        imagenPrincipal: 'pantalon.jpg', createdAt: dias(5),
        variantes: [variante('Beige', '#d2b48c', 'Beige', '38'), variante('Beige', '#d2b48c', 'Beige', '36')]
    },
    {
        _id: oid('a'.repeat(23) + '3'), idExcel: 3, nombre: 'Falda', descripcion: '-', precio: 200, categoria: 'blusas',
        imagenPrincipal: 'falda.jpg', createdAt: dias(50),
        variantes: [variante('Rojo', '#8b0000', 'Rojo', 'XL')]
    },
    {
        _id: oid('a'.repeat(23) + '4'), idExcel: 4, nombre: 'Set Noir', descripcion: '-', precio: 190, categoria: 'conjuntos',
        esConjunto: true, productosIncluidosIds: [1, 2], imagenPrincipal: 'set.jpg', createdAt: dias(2), variantes: []
    }
];

const metaCruda = () => ({
    categorias: [
        { id: 'blusas', nombre: 'Blusas', orden: 1, contienePiezas: false },
        { id: 'pantalones', nombre: 'Pantalones', orden: 2, contienePiezas: false },
        { id: 'conjuntos', nombre: 'Conjuntos', orden: 4, contienePiezas: true }
    ],
    familiasColor: [
        { id: 'negro', nombre: 'Negro', hex: '#171717' },
        { id: 'beige', nombre: 'Beige', hex: '#D4C3B3' },
        { id: 'rojo', nombre: 'Rojo', hex: '#8B0000' }
    ],
    tallas: [{ talla: 'S', orden: 1 }, { talla: 'M', orden: 2 }, { talla: 'XL', orden: 4 }, { talla: '36', orden: 24 }, { talla: '38', orden: 25 }]
});

/** Repositorio falso que cuenta llamadas y puede fallar o demorarse a voluntad. */
function repoFalso(datos = catalogoCrudo) {
    const repo = {
        llamadas: 0,
        fallar: false,
        retraso: null,           // promesa que hay que resolver para terminar la carga
        async listarTodos() {
            repo.llamadas++;
            const foto = datos();                        // la consulta "lee" los datos al empezar…
            if (repo.retraso) await repo.retraso;        // …y la respuesta puede tardar en llegar
            if (repo.fallar) throw new Error('Atlas no responde');
            return foto;
        },
        async leerMeta() {
            return metaCruda();
        }
    };
    return repo;
}

const silencio = { error() {} };

describe('catalogService — lectura', () => {
    test('devuelve DTO válidos y resuelve las piezas de los conjuntos', async () => {
        const catalogo = crearCatalogService({ repositorio: repoFalso(), ahora: () => AHORA, logger: silencio });
        const todos = await catalogo.todos();

        assert.equal(todos.length, 4);
        assert.deepEqual(todos.flatMap(validarProductDTO), []);
        assert.deepEqual(todos[3].piezas.map(p => p.nombre), ['Blusa', 'Pantalón']);
    });

    test('porIdOSku: por id público, por SKU numérico, y null si no existe o viene vacío', async () => {
        const catalogo = crearCatalogService({ repositorio: repoFalso(), ahora: () => AHORA, logger: silencio });

        assert.equal((await catalogo.porIdOSku('a'.repeat(23) + '2')).nombre, 'Pantalón');    // enlaces antiguos
        assert.equal((await catalogo.porIdOSku('3')).nombre, 'Falda');
        assert.equal((await catalogo.porIdOSku(3)).nombre, 'Falda');
        assert.equal((await catalogo.porIdOSku('3-falda')).nombre, 'Falda');                  // urlId actual
        assert.equal((await catalogo.porIdOSku('3-un-slug-viejo')).nombre, 'Falda');          // manda el número
        assert.equal(await catalogo.porIdOSku('999'), null);
        assert.equal(await catalogo.porIdOSku(''), null);
        assert.equal(await catalogo.porIdOSku(undefined), null);
    });

    test('solo se sirven productos publicados', async () => {
        const catalogo = crearCatalogService({
            repositorio: repoFalso(() => catalogoCrudo().map(p => (p.idExcel === 3 ? { ...p, publicado: false } : p))),
            ahora: () => AHORA, logger: silencio
        });
        assert.deepEqual((await catalogo.todos()).map(p => p.nombre), ['Blusa', 'Pantalón', 'Set Noir']);
        assert.equal(await catalogo.porIdOSku('3'), null);
    });

    test('las tallas de cada producto salen ordenadas según la tabla TALLAS', async () => {
        const catalogo = crearCatalogService({ repositorio: repoFalso(), ahora: () => AHORA, logger: silencio });
        const [blusa, pantalon] = await catalogo.todos();
        assert.deepEqual(blusa.tallas, ['S', 'M']);
        assert.deepEqual(pantalon.tallas, ['36', '38']);
    });

    test('home separa prendas y conjuntos', async () => {
        const catalogo = crearCatalogService({ repositorio: repoFalso(), ahora: () => AHORA, logger: silencio });
        const { prendas, conjuntos } = await catalogo.home();
        assert.equal(prendas.length, 3);
        assert.equal(conjuntos.length, 1);
        assert.ok(prendas.every(p => p.tipo === 'prenda'));
    });

    test('paginaCatalogo devuelve todo + filtros', async () => {
        const catalogo = crearCatalogService({ repositorio: repoFalso(), ahora: () => AHORA, logger: silencio });
        const { productos, filtros } = await catalogo.paginaCatalogo();
        assert.equal(productos.length, 4);
        assert.deepEqual(filtros.precio, { min: 80, max: 200 });
        // salen de las variantes y su nombre/HEX de la tabla FAMILIAS COLOR
        assert.deepEqual(filtros.familiasColor, [
            { id: 'beige', nombre: 'Beige', hex: '#d4c3b3' },
            { id: 'negro', nombre: 'Negro', hex: '#171717' },
            { id: 'rojo', nombre: 'Rojo', hex: '#8b0000' }
        ]);
        assert.deepEqual(filtros.categorias.map(c => c.nombre), ['Blusas', 'Pantalones', 'Conjuntos']);
        assert.deepEqual(filtros.tallas, { letras: ['S', 'M', 'XL'], numericas: ['36', '38'] });
    });

    test('relacionados: misma categoría sin incluir el propio; si no hay, los más recientes', async () => {
        const catalogo = crearCatalogService({ repositorio: repoFalso(), ahora: () => AHORA, logger: silencio });

        const blusa = await catalogo.porIdOSku(1);
        assert.deepEqual((await catalogo.relacionados(blusa)).map(p => p.nombre), ['Falda']);

        const pantalon = await catalogo.porIdOSku(2);       // categoría única → cae a "más recientes"
        const rel = await catalogo.relacionados(pantalon, 2);
        assert.deepEqual(rel.map(p => p.nombre), ['Set Noir', 'Falda']);     // los 2 más recientes de los demás
        assert.ok(rel.every(p => p.id !== pantalon.id));
    });
});

describe('catalogService — caché', () => {
    test('dentro del TTL no vuelve a consultar la base de datos', async () => {
        const repo = repoFalso();
        let t = AHORA;
        const catalogo = crearCatalogService({ repositorio: repo, ttlMs: 60000, ahora: () => t, logger: silencio });

        await catalogo.todos();
        t += 59000;
        await catalogo.todos();
        await catalogo.porIdOSku(1);
        assert.equal(repo.llamadas, 1);

        t += 2000;                                          // 61 s: vencida
        await catalogo.todos();
        assert.equal(repo.llamadas, 2);
    });

    test('peticiones simultáneas comparten UNA sola carga', async () => {
        const repo = repoFalso();
        let liberar;
        repo.retraso = new Promise(r => { liberar = r; });
        const catalogo = crearCatalogService({ repositorio: repo, ahora: () => AHORA, logger: silencio });

        const pendientes = [catalogo.todos(), catalogo.home(), catalogo.porIdOSku(1), catalogo.paginaCatalogo()];
        liberar();
        await Promise.all(pendientes);
        assert.equal(repo.llamadas, 1);
    });

    test('si recargar falla y hay datos viejos, los sirve y reintenta en ~10 s', async () => {
        const repo = repoFalso();
        let t = AHORA;
        const errores = [];
        const catalogo = crearCatalogService({
            repositorio: repo, ttlMs: 60000, ahora: () => t, logger: { error: (...a) => errores.push(a.join(' ')) }
        });

        const primera = await catalogo.todos();
        t += 61000;
        repo.fallar = true;

        const servida = await catalogo.todos();             // no lanza
        assert.equal(servida.length, primera.length);
        assert.equal(errores.length, 1);
        assert.match(errores[0], /Atlas no responde/);

        const llamadasTrasFallo = repo.llamadas;
        t += 5000;
        await catalogo.todos();                             // aún dentro de la ventana de espera: no reintenta
        assert.equal(repo.llamadas, llamadasTrasFallo);

        t += 6000;                                          // pasaron >10 s: reintenta
        repo.fallar = false;
        await catalogo.todos();
        assert.equal(repo.llamadas, llamadasTrasFallo + 1);
    });

    test('si falla y NO hay datos previos, el error se propaga', async () => {
        const repo = repoFalso();
        repo.fallar = true;
        const catalogo = crearCatalogService({ repositorio: repo, ahora: () => AHORA, logger: silencio });
        await assert.rejects(() => catalogo.todos(), /Atlas no responde/);
        // y la siguiente petición vuelve a intentarlo (no queda "envenenada")
        repo.fallar = false;
        assert.equal((await catalogo.todos()).length, 4);
    });

    test('invalidar() fuerza recarga y una carga en vuelo anterior NO reinstala datos viejos', async () => {
        let version = 'v1';
        const repo = repoFalso(() => catalogoCrudo().map(p => ({ ...p, nombre: `${p.nombre} ${version}` })));
        let liberar;
        repo.retraso = new Promise(r => { liberar = r; });
        const catalogo = crearCatalogService({ repositorio: repo, ahora: () => AHORA, logger: silencio });

        const cargaVieja = catalogo.todos();                // empieza con v1 y queda en vuelo
        version = 'v2';
        catalogo.invalidar();                               // llega un sync a mitad de la carga
        repo.retraso = null;
        const nueva = await catalogo.todos();               // debe iniciar una carga NUEVA
        assert.match(nueva[0].nombre, /v2$/);

        liberar();                                          // termina la carga vieja…
        await cargaVieja;
        const despues = await catalogo.todos();             // …y no debe pisar la caché nueva
        assert.match(despues[0].nombre, /v2$/);
    });
});
