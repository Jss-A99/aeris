const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { prepararFotos, crearFotoService } = require('../services/fotoService');
const { crearFotoRepositoryMemoria } = require('../repositories/fotoRepository');
const { crearApp } = require('../server');

/* Archivos mínimos con la "firma" real de cada formato */
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 2)]);
const b64 = (buf) => buf.toString('base64');
const foto = (nombre, datos = JPG, version = '2026-11-01T10:00:00.000Z|64') => ({ nombre, version, datos: b64(datos) });

describe('fotos: validación de lo que manda el Apps Script', () => {
    test('acepta JPG y PNG reales con nombre válido', () => {
        const { fotos, errores } = prepararFotos([foto('blusa-negra.jpg'), foto('detalle_1.png', PNG)]);
        assert.deepEqual(errores, []);
        assert.deepEqual(fotos.map(f => [f.nombre, f.tipo]), [['blusa-negra.jpg', 'image/jpeg'], ['detalle_1.png', 'image/png']]);
        assert.ok(fotos[0].datos.equals(JPG));
    });

    test('rechaza nombres con mayúsculas o espacios, archivos que no son la imagen que dicen y vacíos', () => {
        const { fotos, errores } = prepararFotos([
            foto('Blusa Negra.jpg'),
            foto('falsa.jpg', Buffer.from('<script>alert(1)</script>')),
            { nombre: 'vacia.jpg', version: 'v', datos: '' },
            foto('../fuera.jpg')
        ]);
        assert.equal(fotos.length, 0);
        assert.equal(errores.length, 4);
        assert.ok(errores[0].includes('minúsculas'));
        assert.ok(errores[1].includes('no es una imagen (JPG, PNG, WEBP o AVIF)'));
    });

    test('manda el contenido, no el nombre: un WEBP guardado como .jpg se acepta y se sirve como WEBP', () => {
        const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(30, 3)]);
        const { fotos, errores } = prepararFotos([foto('blusa-seda-negra.jpg', WEBP), foto('detalle.png', JPG)]);
        assert.deepEqual(errores, []);
        assert.deepEqual(fotos.map(f => f.tipo), ['image/webp', 'image/jpeg']);
    });

    test('rechaza fotos de más de 5 MB', () => {
        const grande = Buffer.concat([JPG, Buffer.alloc(5 * 1024 * 1024)]);
        assert.match(prepararFotos([foto('enorme.jpg', grande)]).errores[0], /máximo es 5 MB/);
    });
});

describe('fotos: servicio', () => {
    test('un lote con UNA foto mala no guarda ninguna', async () => {
        const repo = crearFotoRepositoryMemoria();
        const s = crearFotoService({ repositorio: repo });
        await assert.rejects(s.guardar([foto('buena.jpg'), foto('Mala.jpg')]), { status: 400 });
        assert.equal(repo.fotos.size, 0);
    });

    test('limpiar es un espejo de la carpeta, pero nunca con la carpeta vacía', async () => {
        const repo = crearFotoRepositoryMemoria();
        const s = crearFotoService({ repositorio: repo });
        await s.guardar([foto('a.jpg'), foto('b.jpg'), foto('c.jpg')]);
        assert.equal(await s.limpiar(['a.jpg', 'c.jpg']), 1);
        assert.deepEqual((await s.nombres()).sort(), ['a.jpg', 'c.jpg']);
        await assert.rejects(s.limpiar([]), { status: 400 });
        assert.equal((await s.nombres()).length, 2);
    });

    test('leer usa la caché y una foto actualizada reemplaza a la vieja', async () => {
        const repo = crearFotoRepositoryMemoria();
        let lecturas = 0;
        const leerOriginal = repo.leer;
        repo.leer = async (n) => { lecturas++; return leerOriginal(n); };
        const s = crearFotoService({ repositorio: repo });
        await s.guardar([foto('a.jpg')]);
        await s.leer('a.jpg');
        await s.leer('a.jpg');
        assert.equal(lecturas, 1);
        await s.guardar([foto('a.jpg', JPG, 'nueva|65')]);
        assert.equal((await s.leer('a.jpg')).version, 'nueva|65');
        assert.equal(await s.leer('../secreto'), null);
    });
});

describe('fotos: sincronización y entrega por HTTP', () => {
    const TOKEN = 'token-de-prueba-fotos';
    const TOKEN_ORIGINAL = process.env.SYNC_TOKEN;
    const ID = (n) => String(n).padStart(24, '0');
    const repo = {
        async listarTodos() {
            return [{ _id: ID(1), idExcel: 1, nombre: 'Blusa', descripcion: '-', precio: 80, categoria: 'blusas',
                imagenPrincipal: 'sincronizada.jpg', imagenesSecundarias: ['no-existe.jpg'], createdAt: new Date(),
                variantes: [{ color: 'Negro', hex: '#000000', familia: 'negro', talla: 'M', stock: 2, imagen: 'sincronizada.jpg' }] }];
        },
        async leerMeta() { return { categorias: [], familiasColor: [], tallas: [], promociones: [] }; }
    };
    const fotoRepositorio = crearFotoRepositoryMemoria();
    let servidor, base;
    const post = (ruta, cuerpo, token = TOKEN) => fetch(base + ruta, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-sync-token': token } : {}) }, body: JSON.stringify(cuerpo)
    });

    before(async () => {
        process.env.SYNC_TOKEN = TOKEN;
        const app = crearApp({ repositorio: repo, fotoRepositorio, ttlCatalogoMs: 60000 });
        await new Promise(r => { servidor = app.listen(0, r); });
        base = `http://127.0.0.1:${servidor.address().port}`;
    });
    after(async () => {
        if (TOKEN_ORIGINAL === undefined) delete process.env.SYNC_TOKEN; else process.env.SYNC_TOKEN = TOKEN_ORIGINAL;
        await new Promise(r => servidor.close(r));
    });

    test('sin token: 401 en las tres rutas', async () => {
        for (const ruta of ['/api/sync-fotos/estado', '/api/sync-fotos', '/api/sync-fotos/limpiar']) {
            assert.equal((await post(ruta, {}, null)).status, 401, ruta);
        }
    });

    test('estado → subir → la web la muestra con caché del navegador y 304 si no cambió', async () => {
        assert.deepEqual((await (await post('/api/sync-fotos/estado', {})).json()).fotos, {});
        const r = await post('/api/sync-fotos', { fotos: [foto('sincronizada.jpg')] });
        assert.deepEqual(await r.json(), { status: 'ok', guardadas: 1 });
        assert.deepEqual((await (await post('/api/sync-fotos/estado', {})).json()).fotos, { 'sincronizada.jpg': '2026-11-01T10:00:00.000Z|64' });

        const img = await fetch(`${base}/images/productos/sincronizada.jpg`);
        assert.equal(img.status, 200);
        assert.equal(img.headers.get('content-type'), 'image/jpeg');
        assert.equal(img.headers.get('cache-control'), 'public, max-age=86400');
        assert.ok(Buffer.from(await img.arrayBuffer()).equals(JPG));
        const igual = await fetch(`${base}/images/productos/sincronizada.jpg`, { headers: { 'if-none-match': img.headers.get('etag') } });
        assert.equal(igual.status, 304);
    });

    test('una foto que no está en Mongo sigue a /public (y si tampoco está, 404)', async () => {
        assert.equal((await fetch(`${base}/images/productos/no-existe.jpg`)).status, 404);
        assert.equal((await fetch(`${base}/images/placeholder.svg`)).status, 200);
    });

    test('lote inválido → 400 con la lista de errores; limpiar con lista vacía → 400', async () => {
        const r = await post('/api/sync-fotos', { fotos: [foto('Mal Nombre.jpg')] });
        assert.equal(r.status, 400);
        assert.equal((await r.json()).errores.length, 1);
        assert.equal((await post('/api/sync-fotos/limpiar', { nombres: [] })).status, 400);
    });

    test('el sync del catálogo avisa qué fotos de la hoja faltan en Drive', async () => {
        const controller = require('../controllers/syncController').crearSyncController;
        const { crearCatalogService } = require('../services/catalogService');
        const catalogo = crearCatalogService({ repositorio: repo, ttlMs: 60000 });
        const fotos = crearFotoService({ repositorio: fotoRepositorio });
        const res = { codigo: 0, json(b) { this.cuerpo = b; return this; }, status(c) { this.codigo = c; return this; } };
        const repoSync = { upsertMuchos: async () => {}, guardarMeta: async () => {}, eliminarAusentes: async () => 0 };
        const F = require('./fixtures/realCatalog');
        await controller({ repositorio: repoSync, catalogo, fotos, dirFotos: '/no/existe' }).sincronizarCatalogo({
            body: { productos: F.hojaProductos, variantes: F.hojaVariantes, categorias: F.hojaCategorias, familiasColor: F.hojaFamilias, tallas: F.hojaTallas }
        }, res);
        assert.equal(res.codigo, 200);
        assert.ok(res.cuerpo.advertencias.some(a => a.includes('"no-existe.jpg"')));
        assert.ok(!res.cuerpo.advertencias.some(a => a.includes('"sincronizada.jpg"')));
    });
});
