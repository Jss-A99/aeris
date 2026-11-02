const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { crearApp } = require('../server');

/**
 * Renderiza las VISTAS REALES (layout + parciales) con un repositorio en memoria.
 * Comprueba que cada página responde, que los textos clave están y que los datos
 * de los productos viajan escapados.
 */
const ID = (n) => String(n).padStart(24, '0');
const hoy = new Date();
const v = (color, hex, familia, talla, stock = 3) => ({ color, hex, familia, talla, stock, imagen: `${color}.jpg` });

const repo = {
    async listarTodos() {
        return [
            { _id: ID(1), idExcel: 1, nombre: 'Blusa </script><b>x</b>', descripcion: '-', precio: 79.9, categoria: 'blusas', nuevo: true,
              imagenPrincipal: 'blusa.jpg', createdAt: hoy, variantes: [v('Negro', '#000000', 'negro', 'M'), v('Blanco', '#ffffff', 'blanco', 'L')] },
            { _id: ID(2), idExcel: 2, nombre: 'Pantalón sastre', descripcion: '-', precio: 99.9, precioAnterior: 129.9, categoria: 'pantalones',
              imagenPrincipal: 'pantalon.jpg', createdAt: hoy, variantes: [v('Negro', '#000000', 'negro', 'XL')] },
            { _id: ID(3), idExcel: 3, nombre: 'Blusa agotada', descripcion: '-', precio: 70, categoria: 'blusas',
              imagenPrincipal: 'b.jpg', createdAt: hoy, variantes: [v('Negro', '#000000', 'negro', 'M', 0)] },
            { _id: ID(4), idExcel: 4, nombre: 'Set Noir', descripcion: 'Dos piezas.', precio: 200, categoria: 'conjuntos', esConjunto: true,
              productosIncluidosIds: [1, 2], imagenPrincipal: 'set.jpg', createdAt: hoy, variantes: [] }
        ];
    },
    async leerMeta() {
        return {
            categorias: [{ id: 'blusas', nombre: 'Blusas', orden: 1 }, { id: 'pantalones', nombre: 'Pantalones', orden: 2 }, { id: 'conjuntos', nombre: 'Conjuntos', orden: 3 }],
            familiasColor: [{ id: 'negro', nombre: 'Negro', hex: '#171717' }, { id: 'blanco', nombre: 'Blanco', hex: '#FFFFFF' }],
            tallas: [{ talla: 'M', orden: 1 }, { talla: 'L', orden: 2 }, { talla: 'XL', orden: 3 }]
        };
    }
};

describe('vistas reales', () => {
    let servidor, base;
    const consola = console.warn;
    before(async () => {
        console.warn = () => {};
        const app = crearApp({ repositorio: repo, ttlCatalogoMs: 60000 });
        await new Promise(r => { servidor = app.listen(0, r); });
        base = `http://127.0.0.1:${servidor.address().port}`;
    });
    after(async () => {
        console.warn = consola;
        await new Promise(r => servidor.close(r));
    });
    const html = async (ruta, status = 200) => {
        const res = await fetch(base + ruta, { redirect: 'manual' });
        assert.equal(res.status, status, ruta);
        return res.text();
    };

    test('inicio: hero con AERIS, pestañas, "Ver más en Catálogo" y conjuntos', async () => {
        const h = await html('/');
        assert.match(h, /<h1 class="marca-grande"><span data-ajustar>AERIS<\/span><\/h1>/);
        assert.match(h, /<a id="verMas" href="\/catalogo">Ver catálogo<\/a>\s*<\/div>/);   // en la cabecera de Categorías
        assert.match(h, /data-catalogo="\/catalogo\?categoria=blusas"/);
        assert.match(h, /Set Noir/);
        assert.ok(!h.includes('Blusa agotada'), 'en el inicio no salen agotados');
        assert.match(h, /<span class="nota nuevo">Nuevo<\/span>/);
        assert.match(h, /<link rel="stylesheet" href="\/css\/aeris\.css\?v=[\w]+">/);
        // Tipografía propia (sin Google) y títulos ajustados antes de pintarse
        assert.match(h, /<link rel="preload" href="\/fonts\/plus-jakarta-sans-latin.woff2" as="font" type="font\/woff2" crossorigin>/);
        assert.doesNotMatch(h, /fonts\.googleapis/);
        assert.match(h, /<span data-ajustar>AERIS<\/span><\/h1>\s*<script>aerisAjustar\(\)<\/script>/);
        const fuente = await fetch(`${base}/fonts/plus-jakarta-sans-latin.woff2`);
        assert.equal(fuente.status, 200);
        assert.equal(Buffer.from(await fuente.arrayBuffer()).toString('ascii', 0, 4), 'wOF2');
    });

    test('el nombre con </script> y etiquetas sale escapado en el HTML y en el JSON', async () => {
        const h = await html('/catalogo');
        assert.ok(!h.includes('Blusa </script>'), 'nunca debe aparecer sin escapar');
        assert.ok(!h.includes('<b>x</b>'));
        assert.match(h, /Blusa &lt;\/script&gt;&lt;b&gt;x&lt;\/b&gt;/);
        assert.match(h, /Blusa \\u003c\/script\\u003e/);
    });

    test('catálogo: título, pestañas con Conjuntos y Descuentos, "artículos", agotado al final', async () => {
        const h = await html('/catalogo');
        assert.match(h, /CATÁLOGO/);
        for (const t of ['Todo', 'Blusas', 'Pantalones', 'Conjuntos', 'Descuentos']) assert.match(h, new RegExp(`>${t}<sup>`));
        assert.match(h, /4 artículos/);
        assert.ok(h.lastIndexOf('Blusa agotada') > h.lastIndexOf('Set Noir'), 'el agotado va al final');
        assert.match(h, /aria-label="Ver conjunto Set Noir"/);
        // Tarjeta de conjunto: nombre → piezas → precio
        assert.match(h, /Set Noir<\/a>[\s\S]{0,400}?<span class="nota">Conjunto · 2 piezas<\/span>\s*<span class="precio">S\/ 200\.00/);
        assert.match(h, /<s>S\/ 129.90<\/s>/);
        assert.match(h, /Eliminar filtros \(0\)/);
    });

    test('catálogo filtrado: chips y contador de filtros', async () => {
        const h = await html('/catalogo?categoria=blusas&orden=asc&talla=M');
        assert.match(h, /1 artículo</);
        assert.match(h, /aria-label="Quitar filtro: Precio ascendente"/);
        assert.match(h, /Eliminar filtros \(2\)/);
    });

    test('favoritos: título, pestañas Bolsa · Favoritos y "Te puede interesar" sin agotados', async () => {
        const h = await html('/favoritos');
        assert.match(h, /<title>Favoritos — AERIS<\/title>/);
        assert.match(h, /<span data-ajustar>FAVORITOS<\/span>/);
        assert.match(h, /<a href="\/carrito">Bolsa<sup data-cuenta="bolsa">0<\/sup><\/a>/);
        assert.match(h, /<a href="\/favoritos" aria-current="page">Favoritos<sup data-cuenta="wish">0<\/sup><\/a>/);
        assert.match(h, /Te puede interesar/);
        assert.ok(!h.includes('Blusa agotada'), 'no se sugieren agotados');
        assert.match(h, /<script src="\/js\/ui\/favoritos.js\?v=[\w]+"><\/script>/);
        assert.doesNotMatch(h, /Wishlist/);                       // en la interfaz se dice "Favoritos"
        // Tu bolsa lleva las mismas pestañas, con Bolsa activa
        assert.match(await html('/carrito'), /<a href="\/carrito" aria-current="page">Bolsa<sup/);
    });

    test('pedidos: título PEDIDOS, pestañas Bolsa · Favoritos · Pedidos, vacío y scripts', async () => {
        const h = await html('/pedidos');
        assert.match(h, /<title>Pedidos — AERIS<\/title>/);
        assert.match(h, /<span data-ajustar>PEDIDOS<\/span>/);
        assert.match(h, /<a href="\/carrito">Bolsa<sup data-cuenta="bolsa">0<\/sup><\/a>/);
        assert.match(h, /<a href="\/favoritos">Favoritos<sup data-cuenta="wish">0<\/sup><\/a>/);
        assert.match(h, /<a href="\/pedidos" aria-current="page">Pedidos<sup data-cuenta="pedidos">0<\/sup><\/a>/);
        assert.match(h, /Aún no tienes pedidos\./);
        assert.match(h, /<a class="enlace" href="\/catalogo">Ver catálogo<\/a>/);
        assert.match(h, /<script src="\/js\/core\/pedidos-store.js\?v=[\w]+"><\/script>/);
        assert.match(h, /<script src="\/js\/ui\/pedidos.js\?v=[\w]+"><\/script>/);
        assert.match(h, /"whatsapp":"51966796407"/);
        assert.doesNotMatch(h, /Mis pedidos|Esperando pago|Pagado/);   // sin estados de pago
        assert.doesNotMatch(h, /Volver a pedir|Volver a abrir WhatsApp|se guardan en este navegador/);   // quitados a pedido de la tienda
        // Bolsa y Favoritos también llevan la pestaña Pedidos
        assert.match(await html('/carrito'), /<a href="\/pedidos">Pedidos<sup data-cuenta="pedidos">0<\/sup><\/a>/);
        assert.match(await html('/favoritos'), /<a href="\/pedidos">Pedidos<sup data-cuenta="pedidos">0<\/sup><\/a>/);
    });

    test('Bolsa, Favoritos y Pedidos: el título tiene el mismo tamaño en las tres (se mide con la palabra más larga)', async () => {
        for (const [ruta, palabra] of [['/carrito', 'TU BOLSA'], ['/favoritos', 'FAVORITOS'], ['/pedidos', 'PEDIDOS']]) {
            const h = await html(ruta);
            assert.match(h, new RegExp(`<h1 class="titulo" data-tope data-compacto data-igualar="TU BOLSA\\|FAVORITOS\\|PEDIDOS"><span data-ajustar>${palabra}</span></h1>`), ruta);
        }
        assert.match(await html('/'), /data-igualar/);   // el script de ajuste lo sabe leer
    });

    test('nosotros: título, historia tipo revista, mapa de Google Maps con el punto y contacto', async () => {
        const h = await html('/nosotros');
        assert.match(h, /<span data-ajustar>NOSOTROS<\/span>/);
        assert.match(h, /<blockquote class="frase"><p>“Ropa simple, hecha con cuidado en Lima\.”<\/p><\/blockquote>/);
        assert.match(h, /<iframe src="https:\/\/www\.google\.com\/maps\?q=Galer%C3%ADa%20El%20Triunfo%2C%20Av\.%20Horacio%20Urteaga%201376%2C%20Lima%2015072%2C%20Per%C3%BA&amp;z=16&amp;output=embed"/);
        assert.match(h, /<p>Galería El Triunfo<br>Av\. Horacio Urteaga 1376<br>Lima 15072, Perú<\/p>/);
        assert.match(h, /href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;destination=/);   // Cómo llegar
        assert.match(h, /<p>\+51 966 796 407<\/p>/);
        assert.match(h, /href="https:\/\/wa\.me\/51966796407\?text=Hola%20AERIS" target="_blank" rel="noopener"/);
        assert.match(h, /Escríbenos por WhatsApp/);
    });

    test('sistema de diseño: navegar = texto subrayado, títulos compactos, escala de letra y 3 velocidades', async () => {
        const bolsa = await html('/carrito');
        assert.match(bolsa, /<a class="enlace" href="\/catalogo">Ver catálogo<\/a>/);       // no un botón rubí
        assert.match(bolsa, /<h1 class="titulo" data-tope data-compacto[ >]/);
        assert.match(bolsa, /class="linea esqueleto"/);                                      // carga sin saltos
        assert.match(await html("/favoritos"), /<h1 class="titulo" data-tope data-compacto[ >]/);
        assert.match(await html('/'), /<a class="enlace" href="\/conjunto\/4-set-noir">Ver conjunto<\/a>/);

        const css = await (await fetch(`${base}/css/aeris.css`)).text();
        const sueltos = (css.match(/font-size: \.\d+rem/g) || []).filter(t => t !== 'font-size: .62rem');   // .62 = número del contador
        assert.deepEqual(sueltos, [], 'los tamaños de letra salen de la escala (--t-*), nada por debajo de 12 px');
        const tiempos = new Set((css.match(/(?<![\d.])\.\d+s\b/g) || []));
        assert.deepEqual([...tiempos].sort(), ['.25s', '.45s', '.75s'], 'solo las tres velocidades (--r-*)');
        assert.doesNotMatch(css, /\.ver-mas/);
        assert.match(css, /button\.enlace \{[^}]*border: 0; border-bottom: 1\.5px solid currentColor;/);   // acciones de texto: subrayadas, sin recuadro
        assert.match(css, /\.card-texto \{ display: grid; gap: 6px;/);                                     // misma separación entre líneas
        assert.doesNotMatch(css, /\.btn-sec:hover \{ background: var\(--a-tinta\)/);           // sin negro relleno
        // Menú del celular: con el menú abierto, el navbar no lleva desenfoque (si no, el menú se recorta)
        assert.match(css, /\.nav\.abierto \{[^}]*backdrop-filter: none;/);
    });

    test('páginas pendientes de diseño y página de error renderizan con el layout', async () => {
        for (const ruta of ['/nosotros', '/favoritos', '/carrito', '/conjunto/4-set-noir']) {
            const h = await html(ruta);
            assert.match(h, /class="nav"/, ruta);
            assert.match(h, /class="pie"/, ruta);
        }
        assert.match(await html('/no-existe', 404), /No encontrada/);
    });
});

describe('inicio: banners de la hoja', () => {
    const conBanners = {
        ...repo,
        async leerMeta() {
            return { ...(await repo.leerMeta()), banners: [
                { orden: 1, imagen: '/images/productos/banner-solo', titulo: '', enlace: null, externo: false, textoEnlace: '' },
                { orden: 2, imagen: '/images/productos/banner-noir', titulo: 'Sastre Noir', enlace: '/conjunto/4-set-noir', externo: false, textoEnlace: 'Ver conjunto' },
                { orden: 3, imagen: '/images/productos/banner-ig', titulo: '', enlace: 'https://instagram.com/aeris', externo: true, textoEnlace: '' }
            ] };
        }
    };
    const servir = async (repositorio, fn) => {
        const consola = console.warn; console.warn = () => {};
        const app = crearApp({ repositorio, ttlCatalogoMs: 60000 });
        const servidor = await new Promise(r => { const s = app.listen(0, () => r(s)); });
        try { return await fn(`http://127.0.0.1:${servidor.address().port}`); } finally { console.warn = consola; await new Promise(r => servidor.close(r)); }
    };

    test('sin banners: fondo liso, sin leyenda ni flechas', async () => {
        await servir(repo, async (base) => {
            const h = await (await fetch(base + '/')).text();
            assert.equal((h.match(/class="slide/g) || []).length, 1);
            assert.match(h, /<div class="leyenda" hidden>/);
            assert.doesNotMatch(h, /id="heroPrev"/);
            assert.doesNotMatch(h, /Colección Primavera 2026/);   // ya no hay banners de muestra
        });
    });

    test('solo imagen, con enlace interno y título, y con enlace externo sin texto', async () => {
        await servir(conBanners, async (base) => {
            const h = await (await fetch(base + '/')).text();
            // 1: solo imagen → no es enlace
            assert.match(h, /<div class="slide on" style="background-image: url\('\/images\/productos\/banner-solo'\)"/);
            // 2: toda la imagen lleva al conjunto
            assert.match(h, /<a class="slide" style="background-image: url\('\/images\/productos\/banner-noir'\)" href="\/conjunto\/4-set-noir" aria-label="Sastre Noir" aria-hidden=true tabindex=-1/);
            // 3: externo → otra pestaña
            assert.match(h, /href="https:\/\/instagram\.com\/aeris" target="_blank" rel="noopener"/);
            // La leyenda arranca con el primero: sin título ni texto (ocultos), pero con contador y flechas
            assert.match(h, /<span id="heroTitulo" hidden><\/span>/);
            assert.match(h, /<a class="ir" id="heroEnlace" href="#" hidden><\/a>/);
            assert.match(h, /01 \/ 03/);
            assert.match(h, /id="heroNext"/);
        });
    });
});
