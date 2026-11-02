const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { crearApp } = require('../server');
const F = require('./fixtures/realCatalog');

/**
 * Prueba la app COMPLETA (rutas → controladores → servicios → mapper) con:
 *  - vistas "stub" que devuelven en JSON las variables que recibieron,
 *  - un repositorio en memoria en lugar de MongoDB.
 * Así se verifica el contrato de cada vista (view model) sin depender del diseño.
 */
const VISTAS = ['index', 'catalogo', 'producto', 'conjunto-detalle', 'favoritos', 'carrito', 'pedidos', 'nosotros', 'error'];
const STUB = '<%- jsonParaHtml(Object.fromEntries(Object.entries(locals).filter(([k]) => !["settings","_locals","cache"].includes(k)))) %>';

const ID = (n) => String(n).padStart(24, '0');
const URL_BLUSA = '1-blusa-d-ete-script';      // "Blusa d'été </script>" → slug sin tildes ni símbolos
const URL_SET = '3-set-noir';
const TOKEN = 'token-de-prueba';

function datosIniciales() {
    const hoy = new Date();
    const v = (color, hex, talla, stock = 3) => ({ color, hex, familia: color, talla, stock, imagen: `${color}.jpg` });
    return [
        { _id: ID(1), idExcel: 1, nombre: "Blusa d'été </script>", descripcion: '-', precio: 120, categoria: 'blusas',
          imagenPrincipal: 'blusa.jpg', createdAt: hoy, variantes: [v('Negro', '#000', 'M')] },
        { _id: ID(2), idExcel: 2, nombre: 'Falda', descripcion: '-', precio: 90, categoria: 'blusas',
          imagenPrincipal: 'falda.jpg', createdAt: hoy, variantes: [v('Rojo', '#8b0000', 'S')] },
        { _id: ID(3), idExcel: 3, nombre: 'Set Noir', descripcion: '-', precio: 200, categoria: 'conjuntos', esConjunto: true,
          productosIncluidosIds: [1, 2], imagenPrincipal: 'set.jpg', createdAt: hoy, variantes: [] }
    ];
}

function repoEnMemoria() {
    const repo = {
        datos: datosIniciales(),
        meta: { categorias: [], familiasColor: [], tallas: [] },
        fallar: false,
        upserts: 0,
        async listarTodos() {
            if (repo.fallar) throw new Error('detalle-interno-secreto de Mongo');
            return structuredClone(repo.datos);
        },
        async leerMeta() {
            if (repo.fallar) throw new Error('detalle-interno-secreto de Mongo');
            return structuredClone(repo.meta);
        },
        async guardarMeta(meta) {
            repo.meta = structuredClone(meta);
        },
        async upsertMuchos(docs) {
            repo.upserts++;
            docs.forEach(doc => {
                const i = repo.datos.findIndex(d => d.idExcel === doc.idExcel);
                if (i >= 0) repo.datos[i] = { ...repo.datos[i], ...doc };
                else repo.datos.push({ ...doc, _id: ID(100 + doc.idExcel), createdAt: new Date() });
            });
        },
        async eliminarAusentes(ids) {
            const antes = repo.datos.length;
            repo.datos = repo.datos.filter(d => ids.includes(d.idExcel));
            return antes - repo.datos.length;
        }
    };
    return repo;
}

describe('app completa', () => {
    let servidor, base, repo, viewsDir;
    const TOKEN_ORIGINAL = process.env.SYNC_TOKEN;
    const consola = { warn: console.warn, error: console.error };

    before(async () => {
        viewsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeris-views-'));
        fs.mkdirSync(path.join(viewsDir, 'pages'));
        VISTAS.forEach(v => fs.writeFileSync(path.join(viewsDir, 'pages', `${v}.ejs`), STUB));
        process.env.SYNC_TOKEN = TOKEN;
        console.warn = () => {};      // silencia los logs esperables de 404/500
        console.error = () => {};
    });

    after(() => {
        console.warn = consola.warn;
        console.error = consola.error;
        if (TOKEN_ORIGINAL === undefined) delete process.env.SYNC_TOKEN;
        else process.env.SYNC_TOKEN = TOKEN_ORIGINAL;
        fs.rmSync(viewsDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
        if (servidor) await new Promise(r => servidor.close(r));
        repo = repoEnMemoria();
        const app = crearApp({ repositorio: repo, viewsDir, layouts: false, ttlCatalogoMs: 60000 });
        await new Promise(r => { servidor = app.listen(0, r); });
        base = `http://127.0.0.1:${servidor.address().port}`;
    });

    after(async () => { if (servidor) await new Promise(r => servidor.close(r)); });

    const get = (ruta, headers = {}) => fetch(base + ruta, { redirect: 'manual', headers });
    const vista = async (ruta) => JSON.parse(await (await get(ruta)).text());
    const sync = (cuerpo, headers = {}) => fetch(`${base}/api/sync-catalog`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)
    });

    describe('páginas y view models', () => {
        test('home: pestañas (Todo + categorías de prendas) y looks de conjuntos', async () => {
            const v = await vista('/');
            assert.equal(v.pagina, 'home');
            assert.deepEqual(v.pestanas.map(t => t.id), ['todo', 'blusas']);
            assert.equal(v.pestanas[0].items.length, 2);
            assert.ok(v.pestanas[0].items.every(p => p.tipo === 'prenda'));
            assert.equal(v.looks.length, 1);
            assert.equal(v.looks[0].piezas.length, 2);
        });

        test('catálogo: categoría normalizada (o "todo") y filtros calculados', async () => {
            const blusas = await vista('/catalogo?categoria=%20Blusas');
            assert.equal(blusas.categoriaSeleccionada, 'blusas');
            assert.equal(blusas.resultado.total, 2);
            const v = await vista('/catalogo');
            assert.equal(v.categoriaSeleccionada, 'todo');
            assert.equal(v.resultado.total, 3);
            assert.equal(v.datosConteo.length, 3);
            assert.deepEqual(v.filtros.precio, { min: 90, max: 200 });
            assert.equal((await vista('/catalogo?orden=asc&pagina=99')).resultado.pagina, 1);
        });

        test('producto: DTO + relacionados (sin incluirse a sí mismo)', async () => {
            const v = await vista(`/producto/${URL_BLUSA}`);
            assert.equal(v.pagina, 'producto');
            assert.equal(v.producto.id, ID(1));
            assert.deepEqual(v.relacionados.map(p => p.nombre), ['Falda']);
        });

        test('conjunto: DTO con sus piezas', async () => {
            const v = await vista(`/conjunto/${URL_SET}`);
            assert.equal(v.pagina, 'conjunto');
            assert.equal(v.conjunto.piezas.length, 2);
        });

        test('páginas estáticas', async () => {
            for (const [ruta, pagina] of [['/favoritos', 'favoritos'], ['/carrito', 'carrito'], ['/pedidos', 'pedidos'], ['/nosotros', 'nosotros']]) {
                assert.equal((await vista(ruta)).pagina, pagina);
            }
        });

        test('el nombre con apóstrofe y </script> viaja intacto y escapado en el HTML', async () => {
            const res = await get(`/producto/${URL_BLUSA}`);
            const html = await res.text();
            assert.ok(!html.includes('</script>'), 'jsonParaHtml debe escapar < y >');
            assert.equal(JSON.parse(html).producto.nombre, "Blusa d'été </script>");
        });
    });

    describe('URL canónica y enlaces antiguos', () => {
        const redirige = async (ruta, destino) => {
            const res = await get(ruta);
            assert.equal(res.status, 301, ruta);
            assert.equal(res.headers.get('location'), destino, ruta);
        };

        test('la URL canónica (Producto_ID + slug) responde 200', async () => {
            assert.equal((await get(`/producto/${URL_BLUSA}`)).status, 200);
            assert.equal((await get(`/conjunto/${URL_SET}`)).status, 200);
        });

        test('SKU suelto, slug viejo e id interno de Mongo → redirigen a la URL canónica', async () => {
            await redirige('/producto/1', `/producto/${URL_BLUSA}`);
            await redirige('/producto/1-un-nombre-anterior', `/producto/${URL_BLUSA}`);
            await redirige(`/producto/${ID(1)}`, `/producto/${URL_BLUSA}`);
        });

        test('un conjunto pedido en /producto/ → /conjunto/; una prenda en /conjunto/ → /producto/', async () => {
            await redirige(`/producto/${URL_SET}`, `/conjunto/${URL_SET}`);
            await redirige(`/producto/${ID(3)}`, `/conjunto/${URL_SET}`);
            await redirige(`/conjunto/${URL_BLUSA}`, `/producto/${URL_BLUSA}`);
        });

        test('/productos/:id (enlaces viejos de WhatsApp) → /producto/:id → URL canónica', async () => {
            await redirige(`/productos/${ID(2)}`, `/producto/${ID(2)}`);
            await redirige(`/producto/${ID(2)}`, '/producto/2-falda');
        });
    });

    describe('errores', () => {
        test('producto inexistente → 404 con la vista de error (sin vistas 404/500 separadas)', async () => {
            const res = await get('/producto/no-existe');
            assert.equal(res.status, 404);
            const v = JSON.parse(await res.text());
            assert.equal(v.pagina, 'error');
            assert.equal(v.status, 404);
        });

        test('ruta inexistente: HTML para navegadores, JSON para /api y para Accept: json', async () => {
            assert.equal((await get('/nada')).status, 404);

            const api = await get('/api/nada');
            assert.equal(api.status, 404);
            assert.equal((await api.json()).ok, false);

            const ajax = await get('/nada', { accept: 'application/json' });
            assert.equal((await ajax.json()).status, 404);
        });

        test('si Mongo falla sin caché: 500 sin filtrar detalles internos', async () => {
            repo.fallar = true;
            const res = await get('/');
            assert.equal(res.status, 500);
            const cuerpo = await res.text();
            assert.ok(!cuerpo.includes('detalle-interno-secreto'));
        });

        test('si Mongo falla DESPUÉS de tener caché, la tienda sigue sirviendo', async () => {
            await get('/');                                   // llena la caché
            repo.fallar = true;
            assert.equal((await get('/')).status, 200);
        });
    });

    describe('infraestructura', () => {
        test('/healthz responde sin tocar la base de datos', async () => {
            repo.fallar = true;
            const res = await get('/healthz');
            assert.equal(res.status, 200);
            assert.equal(await res.text(), 'ok');
        });

        test('cabeceras de seguridad básicas y sin X-Powered-By', async () => {
            const res = await get('/healthz');
            assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
            assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
            assert.equal(res.headers.get('x-powered-by'), null);
        });

        test('sirve archivos estáticos (el placeholder nuevo existe)', async () => {
            const res = await get('/images/placeholder.svg');
            assert.equal(res.status, 200);
            assert.match(res.headers.get('content-type'), /svg/);
        });
    });

    describe('POST /api/sync-catalog', () => {
        /** Cuerpo completo con la hoja real (6 productos publicados). */
        const hoja = () => structuredClone({
            productos: F.hojaProductos, variantes: F.hojaVariantes,
            categorias: F.hojaCategorias, familiasColor: F.hojaFamilias, tallas: F.hojaTallas
        });

        test('sin token → 401, y sin leer el cuerpo (ni siquiera un JSON roto llega al parser)', async () => {
            const res = await sync('{esto no es json', {});
            assert.equal(res.status, 401);
            assert.equal(repo.upserts, 0);
        });

        test('con token y JSON roto → 400 en JSON (no una página HTML)', async () => {
            const res = await sync('{esto no es json', { 'x-sync-token': TOKEN });
            assert.equal(res.status, 400);
            assert.equal((await res.json()).ok, false);
        });

        test('sync válido: guarda, devuelve el conteo y la tienda refleja el cambio de inmediato (caché invalidada)', async () => {
            assert.equal((await vista('/')).pestanas[0].total, 2);           // llena la caché (TTL 60 s)

            const res = await sync(hoja(), { 'x-sync-token': TOKEN });
            const cuerpo = await res.json();
            assert.equal(res.status, 200);
            assert.equal(cuerpo.status, 'ok');
            assert.equal(cuerpo.publicados, 6);
            assert.equal(cuerpo.noPublicados, 0);
            assert.deepEqual(cuerpo.advertencias, []);

            const home = await vista('/');
            assert.equal(home.pestanas[0].total, 5);                       // 5 prendas

            // Las tablas de apoyo también se guardaron y alimentan los filtros
            const catalogo = await vista('/catalogo');
            assert.equal(catalogo.resultado.total, 6);                     // 5 prendas + 1 conjunto
            assert.ok(catalogo.resultado.items.some(p => p.nombre === 'Vestido Lino Cruzado'));
            assert.deepEqual(catalogo.filtros.familiasColor.map(f => f.nombre), ['Beige', 'Blanco', 'Negro', 'Verde', 'Vino']);
            assert.deepEqual(catalogo.filtros.categorias.map(c => c.nombre), ['Blusas', 'Pantalones', 'Vestidos', 'Conjuntos']);
        });

        test('desmarcar Publicado: el producto desaparece de la tienda en el siguiente envío', async () => {
            await sync(hoja(), { 'x-sync-token': TOKEN });
            assert.equal((await get('/producto/5-vestido-lino-cruzado')).status, 200);

            const c = hoja();
            c.productos.find(p => p['Producto_ID'] === 5)['Publicado'] = false;
            const res = await sync(c, { 'x-sync-token': TOKEN });
            const cuerpo = await res.json();
            assert.equal(cuerpo.eliminados, 1);
            assert.equal(cuerpo.noPublicados, 1);
            assert.equal((await get('/producto/5-vestido-lino-cruzado')).status, 404);
        });

        test('hoja con errores → 400 con la lista de errores, y la tienda NO cambia', async () => {
            const c = hoja();
            c.variantes[0]['Familia'] = 'Inexistente';
            const antes = repo.datos.length;

            const res = await sync(c, { 'x-sync-token': TOKEN });
            const cuerpo = await res.json();
            assert.equal(res.status, 400);
            assert.equal(cuerpo.status, 'error');
            assert.ok(cuerpo.errores.some(e => e.includes('Inexistente')));
            assert.equal(repo.upserts, 0);
            assert.equal(repo.datos.length, antes);
        });

        test('acepta cuerpos de más de 100 KB (el límite por defecto de Express lo rechazaría)', async () => {
            const c = hoja();
            for (let i = 0; i < 2500; i++) {
                c.variantes.push({ 'Producto_ID': 1, 'Color Variante': `Color ${i}`, 'HEX Variante': '#123456', 'Familia': 'Negro', 'Talla': 'M', 'Stock': 1, 'Imagen Variante': 'x.jpg' });
            }
            assert.ok(JSON.stringify(c).length > 200 * 1024);

            const res = await sync(c, { 'x-sync-token': TOKEN });
            assert.equal(res.status, 200);
        });

        test('catálogo vacío → 400 con mensaje; error interno → 500 sin filtrar detalles', async () => {
            const vacio = await sync({ productos: [] }, { 'x-sync-token': TOKEN });
            assert.equal(vacio.status, 400);

            repo.upsertMuchos = async () => { throw new Error('detalle-interno-secreto'); };
            const roto = await sync(hoja(), { 'x-sync-token': TOKEN });
            assert.equal(roto.status, 500);
            assert.ok(!(await roto.text()).includes('detalle-interno-secreto'));
        });
    });
});
