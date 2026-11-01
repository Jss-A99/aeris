const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { armarMigas, rutaInterna, fichaDeRuta } = require('../utils/migas');
const { crearApp } = require('../server');

describe('migas de pan: siguen la ruta de la visita', () => {
    const BLUSAS = { id: 'blusas', nombre: 'Blusas' };
    const textos = (r) => r.migas.map(m => `${m.texto} → ${m.href}`);

    test('desde el catálogo: "Catálogo / Blusas"; Catálogo vuelve a la misma pestaña, filtros y página', () => {
        const r = armarMigas({ ruta: '/catalogo?categoria=blusas&talla=M&pagina=2', categoria: BLUSAS });
        assert.deepEqual(textos(r), ['Catálogo → /catalogo?categoria=blusas&talla=M&pagina=2', 'Blusas → /catalogo?categoria=blusas']);
    });

    test('desde el inicio, la bolsa o la wishlist: solo esa página', () => {
        assert.deepEqual(textos(armarMigas({ ruta: '/', categoria: BLUSAS })), ['Inicio → /']);
        assert.deepEqual(textos(armarMigas({ ruta: '/carrito', categoria: BLUSAS })), ['Bolsa → /carrito']);
        assert.deepEqual(textos(armarMigas({ ruta: '/favoritos', categoria: BLUSAS })), ['Favoritos → /favoritos']);
    });

    test('desde un conjunto (u otro producto): su nombre, para volver a él', () => {
        const r = armarMigas({ ruta: '/conjunto/4-set-noir', categoria: BLUSAS, anterior: { nombre: 'Set Noir', url: '/conjunto/4-set-noir' }, urlActual: '/producto/1-blazer' });
        assert.deepEqual(textos(r), ['Set Noir → /conjunto/4-set-noir']);
        // recargar la misma ficha no se enlaza a sí misma
        const misma = armarMigas({ ruta: '/producto/1-blazer', categoria: BLUSAS, anterior: { nombre: 'Blazer', url: '/producto/1-blazer' }, urlActual: '/producto/1-blazer' });
        assert.deepEqual(textos(misma), ['Catálogo → /catalogo?categoria=blusas', 'Blusas → /catalogo?categoria=blusas']);
    });

    test('desde fuera de la tienda o sin dato: "Catálogo / Blusas"', () => {
        assert.deepEqual(textos(armarMigas({ ruta: null, categoria: BLUSAS })), ['Catálogo → /catalogo?categoria=blusas', 'Blusas → /catalogo?categoria=blusas']);
        assert.deepEqual(textos(armarMigas({ ruta: null, categoria: null })), ['Catálogo → /catalogo']);
    });

    test('rutaInterna solo acepta esta tienda; fichaDeRuta reconoce producto y conjunto', () => {
        assert.equal(rutaInterna('https://aeris.pe/catalogo?x=1', 'aeris.pe'), '/catalogo?x=1');
        assert.equal(rutaInterna('https://otro.com/catalogo', 'aeris.pe'), null);
        assert.equal(rutaInterna(undefined, 'aeris.pe'), null);
        assert.equal(rutaInterna('basura', 'aeris.pe'), null);
        assert.deepEqual(fichaDeRuta('/conjunto/4-set-noir'), { tipo: 'conjunto', id: '4-set-noir' });
        assert.equal(fichaDeRuta('/catalogo'), null);
    });
});

describe('páginas de producto y conjunto', () => {
    const ID = (n) => String(n).padStart(24, '0');
    const v = (color, hex, talla, stock = 3) => ({ color, hex, familia: color.toLowerCase(), talla, stock, imagen: `${color.toLowerCase()}.jpg` });
    const repo = {
        async listarTodos() {
            return [
                { _id: ID(1), idExcel: 1, nombre: 'Blazer corto', descripcion: 'Blazer de sastrería.', precio: 179.9, precioAnterior: 199.9, nuevo: true,
                  categoria: 'blusas', imagenPrincipal: 'blazer.jpg', createdAt: new Date(), variantes: [v('Negro', '#111111', 'M'), v('Camel', '#b08a5e', 'L', 0)] },
                { _id: ID(2), idExcel: 2, nombre: 'Pantalón sastre', descripcion: '-', precio: 129.9, categoria: 'pantalones',
                  imagenPrincipal: 'pantalon.jpg', createdAt: new Date(), variantes: [v('Negro', '#111111', 'L')] },
                { _id: ID(3), idExcel: 3, nombre: 'Blusa seda', descripcion: '-', precio: 79.9, categoria: 'blusas',
                  imagenPrincipal: 'blusa.jpg', createdAt: new Date(), variantes: [v('Blanco', '#ffffff', 'M')] },
                { _id: ID(4), idExcel: 4, nombre: 'Set Noir', descripcion: 'Dos piezas.', precio: 289.9, categoria: 'conjuntos', esConjunto: true,
                  productosIncluidosIds: [1, 2], imagenPrincipal: 'set.jpg', createdAt: new Date(), variantes: [] }
            ];
        },
        async leerMeta() {
            return { categorias: [{ id: 'blusas', nombre: 'Blusas', orden: 1 }, { id: 'pantalones', nombre: 'Pantalones', orden: 2 }, { id: 'conjuntos', nombre: 'Conjuntos', orden: 3 }],
                familiasColor: [], tallas: [], promociones: [] };
        }
    };
    let servidor, base;
    before(async () => {
        const app = crearApp({ repositorio: repo, ttlCatalogoMs: 60000 });
        await new Promise(r => { servidor = app.listen(0, r); });
        base = `http://127.0.0.1:${servidor.address().port}`;
    });
    after(async () => { await new Promise(r => servidor.close(r)); });
    const html = async (ruta, headers = {}) => {
        const res = await fetch(base + ruta, { headers });
        assert.equal(res.status, 200, ruta);
        return res.text();
    };

    test('producto: migas, título, precio tachado SIN porcentaje, "Nuevo", galería y relacionados', async () => {
        const h = await html('/producto/1');                       // redirige a la URL canónica
        assert.match(h, /<a href="\/catalogo\?categoria=blusas">Catálogo<\/a><span aria-hidden="true">\/<\/span><a href="\/catalogo\?categoria=blusas">Blusas<\/a>/);
        assert.match(h, /<h1>Blazer corto<\/h1>/);
        assert.match(h, /<b>S\/ 179.90<\/b>\s*<s>S\/ 199.90<\/s>/);
        assert.doesNotMatch(h, /%\s*OFF|descuentoPct/);
        assert.match(h, /<span class="ficha-nuevo">Nuevo<\/span>/);
        assert.match(h, /<p class="desc">Blazer de sastrería.<\/p>/);
        assert.match(h, /data-principal/);
        assert.match(h, /data-foto="\/images\/productos\/camel.jpg"/);   // foto de cada color en la tira
        assert.match(h, /También te puede gustar/);
        assert.match(h, /Blusa seda/);                              // relacionado de la misma categoría
        assert.match(h, /id="datos-producto"/);
        assert.match(h, /<script src="\/js\/ui\/producto.js"><\/script>/);
    });

    test('migas según la ruta: catálogo filtrado, inicio y desde el conjunto', async () => {
        const desdeCatalogo = await html('/producto/1', { referer: `${base}/catalogo?categoria=blusas&orden=asc&pagina=2` });
        assert.match(desdeCatalogo, /<a href="\/catalogo\?categoria=blusas&amp;orden=asc&amp;pagina=2">Catálogo<\/a>/);
        const desdeInicio = await html('/producto/1', { referer: `${base}/` });
        assert.match(desdeInicio, /<nav class="migas" aria-label="Estás en">\s*<a href="\/">Inicio<\/a>\s*<\/nav>/);
        const desdeConjunto = await html('/producto/1', { referer: `${base}/conjunto/4-set-noir` });
        assert.match(desdeConjunto, /<nav class="migas" aria-label="Estás en">\s*<a href="\/conjunto\/4-set-noir">Set Noir<\/a>\s*<\/nav>/);
    });

    test('producto sin descuento ni "Nuevo" y con descripción "-": no muestra nada de eso', async () => {
        const h = await html('/producto/2');
        assert.match(h, /<div class="precio-fila">\s*<b>S\/ 129.90<\/b>\s*<\/div>/);   // sin tachado en la ficha
        assert.doesNotMatch(h, /ficha-nuevo/);
        assert.doesNotMatch(h, /class="desc"/);
    });

    test('conjunto: una pieza por acordeón ("1.", "2."), piezas por separado y migas Conjuntos', async () => {
        const h = await html('/conjunto/4-set-noir');
        assert.match(h, /<a href="\/catalogo\?categoria=conjuntos">Conjuntos<\/a>/);
        assert.match(h, /Este conjunto consta de 2 piezas\./);
        assert.doesNotMatch(h, /Elige color y talla de cada una/);
        assert.match(h, /<span class="num">1\.<\/span><strong>Blazer corto<\/strong>/);
        assert.match(h, /<span class="num">2\.<\/span><strong>Pantalón sastre<\/strong>/);
        assert.equal((h.match(/class="pieza-acc"/g) || []).length, 2);
        assert.match(h, /Piezas por separado/);
        assert.equal((h.match(/<article class="card/g) || []).length, 2);
        assert.doesNotMatch(h, /Ver prenda/);
    });
});
