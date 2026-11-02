const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { construirCatalogo, sincronizar, parsearProductosIncluidos, ErrorSync } = require('../services/syncService');
const { toProductDTOList } = require('../utils/productNormalizer');
const { validarProductDTO } = require('../utils/productContract');
const F = require('./fixtures/realCatalog');

/** Cuerpo de la petición con la hoja real; cada prueba lo modifica a su gusto. */
const cuerpo = () => structuredClone({
    productos: F.hojaProductos,
    variantes: F.hojaVariantes,
    categorias: F.hojaCategorias,
    familiasColor: F.hojaFamilias,
    tallas: F.hojaTallas
});

const producto = (c, id) => c.productos.find(p => p['Producto_ID'] === id);
const construir = (c) => construirCatalogo(c);
const soloErrores = (c) => construir(c).errores;
const contiene = (lista, fragmento) => lista.some(m => m.includes(fragmento));

describe('parsearProductosIncluidos', () => {
    test('"1, 2" → [1, 2]; vacío, nulo y basura → []', () => {
        assert.deepEqual(parsearProductosIncluidos('1, 2'), [1, 2]);
        assert.deepEqual(parsearProductosIncluidos('3,4\n'), [3, 4]);
        assert.deepEqual(parsearProductosIncluidos(''), []);
        assert.deepEqual(parsearProductosIncluidos(null), []);
        assert.deepEqual(parsearProductosIncluidos('a, 0, -2'), []);
    });

    test('recupera "1/2" cuando Sheets lo convirtió en la fecha 1 de febrero', () => {
        assert.deepEqual(parsearProductosIncluidos('2026-02-01T00:00:00.000Z'), [1, 2]);
    });
});

describe('construirCatalogo — la hoja real', () => {
    test('no tiene errores ni advertencias y publica los 6 productos', () => {
        const r = construir(cuerpo());
        assert.deepEqual(r.errores, []);
        assert.deepEqual(r.advertencias, []);
        assert.equal(r.documentos.length, 6);
        assert.deepEqual(r.resumen, { publicados: 6, noPublicados: 0 });
    });

    test('prenda (ID 4): documento completo, con la familia de cada variante', () => {
        const doc = construir(cuerpo()).documentos.find(d => d.idExcel === 4);
        assert.deepEqual(doc, {
            idExcel: 4,
            nombre: 'Vestido Midi Abertura',
            descripcion: 'Vestido sofisticado de longitud midi con abertura lateral.',
            precio: 109.9,
            precioAnterior: null,
            categoria: 'vestidos',
            nuevo: false,
            publicado: true,
            imagenPrincipal: 'vestido-midi-negro.jpg',
            imagenesSecundarias: ['vestido-midi-negro.jpg', 'vestido-midi-vino.jpg'],
            esConjunto: false,
            productosIncluidosIds: [],
            variantes: [
                { color: 'Negro', hex: '#171717', familia: 'Negro', talla: 'XXL', stock: 5, imagen: 'vestido-midi-negro.jpg' },
                { color: 'Negro', hex: '#171717', familia: 'Negro', talla: 'M', stock: 7, imagen: 'vestido-midi-negro.jpg' },
                { color: 'Vino', hex: '#581825', familia: 'Vino', talla: 'XL', stock: 3, imagen: 'vestido-midi-vino.jpg' }
            ]
        });
    });

    test('conjunto (ID 6): esConjunto sale de CATEGORÍAS ("Contiene piezas"), con sus piezas y sin variantes', () => {
        const doc = construir(cuerpo()).documentos.find(d => d.idExcel === 6);
        assert.equal(doc.esConjunto, true);
        assert.deepEqual(doc.productosIncluidosIds, [1, 2]);
        assert.deepEqual(doc.variantes, []);
    });

    test('familias de variantes como "Verde Kaki" → "Verde" y "Blanco Crema" → "Blanco"', () => {
        const docs = construir(cuerpo()).documentos;
        assert.equal(docs.find(d => d.idExcel === 3).variantes[0].familia, 'Verde');
        assert.equal(docs.find(d => d.idExcel === 5).variantes[0].familia, 'Blanco');
        assert.equal(docs.find(d => d.idExcel === 5).variantes[0].color, 'Blanco Crema');
    });

    test('tallas numéricas (Sheets las entrega como número) llegan como texto', () => {
        const pantalon = construir(cuerpo()).documentos.find(d => d.idExcel === 2);
        assert.deepEqual(pantalon.variantes.map(v => v.talla), ['36', '30', '32', '30']);
        assert.ok(pantalon.variantes.every(v => typeof v.stock === 'number'));
    });

    test('tablas de apoyo: categorías, familias (HEX en minúsculas) y tallas (texto)', () => {
        const { meta } = construir(cuerpo());
        assert.deepEqual(meta.categorias.map(c => [c.id, c.nombre, c.orden, c.contienePiezas]), [
            ['blusas', 'Blusas', 1, false], ['pantalones', 'Pantalones', 2, false],
            ['vestidos', 'Vestidos', 3, false], ['conjuntos', 'Conjuntos', 4, true]
        ]);
        assert.deepEqual(meta.familiasColor.map(f => [f.id, f.nombre, f.hex]), [
            ['negro', 'Negro', '#171717'], ['blanco', 'Blanco', '#ffffff'], ['beige', 'Beige', '#d4c3b3'],
            ['verde', 'Verde', '#4a5240'], ['vino', 'Vino', '#581825']
        ]);
        assert.deepEqual(meta.tallas.map(t => t.talla), ['S', 'M', 'L', 'XL', 'XXL', '3XL', '28', '30', '32', '34', '36', '38']);
        assert.ok(meta.tallas.every(t => typeof t.talla === 'string' && Number.isFinite(t.orden)));
    });

    test('integración: lo que produce el sync, el mapper lo convierte en DTO válidos (conjunto incluido)', () => {
        const { documentos, meta } = construir(cuerpo());
        const crudos = documentos.map((d, i) => ({ ...d, _id: String(i + 1).padStart(24, '0') }));
        const dtos = toProductDTOList(crudos, { ordenTallas: new Map(meta.tallas.map(t => [t.talla, t.orden])) });

        assert.equal(dtos.length, 6);
        assert.deepEqual(dtos.flatMap(validarProductDTO), []);
        assert.deepEqual(dtos[5].piezas.map(p => p.nombre), ['Blusa Seda Básica', 'Pantalón Sastre Ancho']);
        assert.deepEqual(dtos[3].familiasColor, ['negro', 'vino']);
    });
});

describe('construirCatalogo — filas vacías, encabezados y números de fila', () => {
    test('filas que solo tienen casillas (hasta la fila 1000) se ignoran en silencio', () => {
        const c = cuerpo();
        for (let i = 0; i < 50; i++) c.productos.push({ 'Producto_ID': '', 'Nombre Producto': '', 'Categoría': '', Nuevo: false, Publicado: false });
        c.categorias.push({ 'Categoría': '', 'Nombre visible': '', Orden: '', 'Contiene piezas': false });
        const r = construir(c);
        assert.deepEqual(r.errores, []);
        assert.deepEqual(r.advertencias, []);
        assert.equal(r.documentos.length, 6);
    });

    test('tolera tildes, mayúsculas y el nombre antiguo de la columna de piezas', () => {
        const c = cuerpo();
        const fila = producto(c, 6);
        fila['Productos Incluidos (Solo Conjuntos)'] = fila['Productos Incluidos'];
        delete fila['Productos Incluidos'];
        fila['Categoria'] = fila['Categoría'];             // sin tilde
        delete fila['Categoría'];
        const r = construir(c);
        assert.deepEqual(r.errores, []);
        assert.deepEqual(r.documentos.find(d => d.idExcel === 6).productosIncluidosIds, [1, 2]);
    });

    test('si falta una columna imprescindible (por renombrar un encabezado), lo dice claramente', () => {
        const c = cuerpo();
        c.productos.forEach(p => { p['Publicada'] = p['Publicado']; delete p['Publicado']; });
        const errores = soloErrores(c);
        assert.ok(contiene(errores, 'PRODUCTOS: falta la columna "Publicado"'), errores.join('|'));
    });

    test('los mensajes usan el número de fila real de la hoja (_fila)', () => {
        const c = cuerpo();
        producto(c, 3)['Categoría'] = 'abrigos';
        const errores = soloErrores(c);
        assert.ok(contiene(errores, 'PRODUCTOS fila 4 (ID 3)'), errores.join('|'));
    });

    test('sin _fila usa índice + 2 (la fila 1 son los encabezados)', () => {
        const c = cuerpo();
        c.productos.forEach(p => delete p._fila);
        producto(c, 3)['Categoría'] = 'abrigos';
        assert.ok(contiene(soloErrores(c), 'PRODUCTOS fila 4 (ID 3)'));
    });
});

describe('construirCatalogo — errores que BLOQUEAN el envío', () => {
    test('categoría que no existe en CATEGORÍAS', () => {
        const c = cuerpo();
        producto(c, 1)['Categoría'] = 'abrigos';
        assert.ok(contiene(soloErrores(c), 'la categoría "abrigos" no existe en CATEGORÍAS'));
    });

    test('Producto_ID inválido, repetido o sin nombre', () => {
        const c = cuerpo();
        c.productos.push({ ...producto(c, 1), '_fila': 20 });                         // repetido
        c.productos.push({ ...producto(c, 1), 'Producto_ID': 'abc', '_fila': 21 });   // inválido
        c.productos.push({ ...producto(c, 1), 'Producto_ID': 50, 'Nombre Producto': '', '_fila': 22 });
        const errores = soloErrores(c);
        assert.ok(contiene(errores, 'ID 1): el Producto_ID está repetido'));
        assert.ok(contiene(errores, 'fila 21: Producto_ID debe ser un número entero'));
        assert.ok(contiene(errores, 'ID 50): falta "Nombre Producto"'));
    });

    test('precio inválido o precio anterior que no es número', () => {
        const c = cuerpo();
        producto(c, 1)['Precio'] = 0;
        producto(c, 2)['Precio'] = 'barato';
        producto(c, 3)['Precio Anterior'] = 'abc';
        const errores = soloErrores(c);
        assert.equal(errores.filter(e => e.includes('"Precio" debe ser un número mayor que 0')).length, 2);
        assert.ok(contiene(errores, '"Precio Anterior" no es un número'));
    });

    test('variante con familia que no existe: el mensaje lista las disponibles', () => {
        const c = cuerpo();
        c.variantes[0]['Familia'] = 'Verd';
        const errores = soloErrores(c);
        assert.ok(contiene(errores, 'VARIANTES fila 2 (ID 1): la familia "Verd" no existe en FAMILIAS COLOR (disponibles: Negro, Blanco, Beige, Verde, Vino)'), errores.join('|'));
    });

    test('la familia se compara sin distinguir mayúsculas ("verde" = "Verde")', () => {
        const c = cuerpo();
        c.variantes[0]['Familia'] = ' NEGRO ';
        assert.deepEqual(soloErrores(c), []);
        assert.equal(construir(c).documentos[0].variantes[0].familia, 'Negro');     // se guarda la grafía de la tabla
    });

    test('talla que no existe en TALLAS, o vacía', () => {
        const c = cuerpo();
        c.variantes[0]['Talla'] = '4XL';
        c.variantes[1]['Talla'] = '';
        const errores = soloErrores(c);
        assert.ok(contiene(errores, 'la talla "4XL" no existe en TALLAS'));
        assert.ok(contiene(errores, 'falta la "Talla"'));
    });

    test('HEX inválido en una variante y en una familia', () => {
        const c = cuerpo();
        c.variantes[0]['HEX Variante'] = 'rojo';
        c.familiasColor[0]['HEX muestra'] = '#12';
        const errores = soloErrores(c);
        assert.ok(contiene(errores, 'el HEX "rojo" no es válido'));
        assert.ok(contiene(errores, 'FAMILIAS COLOR fila 2: el HEX "#12"'));
    });

    test('stock negativo, decimal, vacío o texto', () => {
        const c = cuerpo();
        [-1, 2.5, '', 'mucho'].forEach((s, i) => { c.variantes[i]['Stock'] = s; });
        const errores = soloErrores(c);
        assert.equal(errores.filter(e => e.includes('"Stock" debe ser un entero de 0 o más')).length, 4);
    });

    test('variante de un Producto_ID que no existe (huérfana)', () => {
        const c = cuerpo();
        c.variantes.push({ ...c.variantes[0], 'Producto_ID': 99, '_fila': 30 });
        assert.ok(contiene(soloErrores(c), 'VARIANTES fila 30: el Producto_ID 99 no existe en PRODUCTOS'));
    });

    test('variante repetida (mismo producto, color y talla)', () => {
        const c = cuerpo();
        c.variantes.push({ ...c.variantes[0], 'Stock': 1, '_fila': 31 });
        assert.ok(contiene(soloErrores(c), 'ya existe la variante Blanco / XXL'));
    });

    test('conjunto sin piezas, con una pieza inexistente, no publicada o que también es conjunto', () => {
        const casos = [
            ['', 'está vacío o no se entiende'],
            ['1, 77', 'incluye el ID 77, que no existe'],
            ['1, 6', 'un conjunto no puede incluirse a sí mismo']
        ];
        for (const [incluidos, esperado] of casos) {
            const c = cuerpo();
            producto(c, 6)['Productos Incluidos'] = incluidos;
            const errores = soloErrores(c);
            assert.ok(contiene(errores, esperado), `${incluidos} → ${errores.join('|')}`);
        }

        const noPublicada = cuerpo();
        producto(noPublicada, 2)['Publicado'] = false;
        assert.ok(contiene(soloErrores(noPublicada), 'incluye "Pantalón Sastre Ancho" (ID 2), que no está publicado'));

        const otroConjunto = cuerpo();
        otroConjunto.productos.push({ ...producto(otroConjunto, 6), 'Producto_ID': 7, 'Nombre Producto': 'Otro set', 'Productos Incluidos': '1', '_fila': 8 });
        producto(otroConjunto, 6)['Productos Incluidos'] = '1, 7';
        assert.ok(contiene(soloErrores(otroConjunto), 'incluye el ID 7, que también es un conjunto'));
    });

    test('tablas vacías o con duplicados', () => {
        const c = cuerpo();
        c.categorias = [];
        c.tallas.push({ Talla: 'm', Orden: 9, _fila: 40 });
        c.familiasColor.push({ Familia: 'negro', 'HEX muestra': '#000', _fila: 41 });
        const errores = soloErrores(c);
        assert.ok(contiene(errores, 'CATEGORÍAS está vacía'));
        assert.ok(contiene(errores, 'TALLAS fila 40: la talla "M" está repetida'));
        assert.ok(contiene(errores, 'FAMILIAS COLOR fila 41: la familia "negro" está repetida'));
    });

    test('ningún producto publicado: se rechaza para no vaciar la tienda', () => {
        const c = cuerpo();
        c.productos.forEach(p => { p['Publicado'] = false; });
        assert.ok(contiene(soloErrores(c), 'Ningún producto está marcado como Publicado'));
    });

    test('se reportan TODOS los errores de una vez, no solo el primero', () => {
        const c = cuerpo();
        producto(c, 1)['Categoría'] = 'x';
        producto(c, 2)['Precio'] = 0;
        c.variantes[5]['Familia'] = 'y';
        assert.ok(soloErrores(c).length >= 3);
    });
});

describe('construirCatalogo — productos NO publicados (borradores)', () => {
    test('un borrador a medias no bloquea el envío ni se incluye; sus variantes se ignoran', () => {
        const c = cuerpo();
        const p = producto(c, 5);
        p['Publicado'] = false;
        p['Categoría'] = 'categoria-inventada';
        p['Precio'] = '';
        c.variantes.filter(v => v['Producto_ID'] === 5).forEach(v => { v['Familia'] = 'sin-definir'; v['Stock'] = ''; });

        const r = construir(c);
        assert.deepEqual(r.errores, []);
        assert.deepEqual(r.documentos.map(d => d.idExcel), [1, 2, 3, 4, 6]);
        assert.deepEqual(r.resumen, { publicados: 5, noPublicados: 1 });
    });

    test('aun así debe tener Producto_ID y nombre válidos y únicos', () => {
        const c = cuerpo();
        const p = producto(c, 5);
        p['Publicado'] = false;
        p['Nombre Producto'] = '';
        assert.ok(contiene(soloErrores(c), 'ID 5): falta "Nombre Producto"'));
    });

    test('sus variantes siguen exigiendo un Producto_ID que exista', () => {
        const c = cuerpo();
        producto(c, 5)['Publicado'] = false;
        c.variantes.push({ ...c.variantes[0], 'Producto_ID': 99, '_fila': 30 });
        assert.ok(contiene(soloErrores(c), 'no existe en PRODUCTOS'));
    });
});

describe('construirCatalogo — advertencias (no bloquean)', () => {
    test('precio anterior que no es mayor que el precio', () => {
        const c = cuerpo();
        producto(c, 1)['Precio Anterior'] = 50;
        const r = construir(c);
        assert.deepEqual(r.errores, []);
        assert.ok(contiene(r.advertencias, 'no es mayor que "Precio"'));
    });

    test('conjunto con variantes propias: se ignoran', () => {
        const c = cuerpo();
        c.variantes.push({ ...c.variantes[0], 'Producto_ID': 6, '_fila': 30 });
        const r = construir(c);
        assert.deepEqual(r.errores, []);
        assert.ok(contiene(r.advertencias, 'un conjunto no lleva variantes propias'));
        assert.deepEqual(r.documentos.find(d => d.idExcel === 6).variantes, []);
    });

    test('prenda sin variantes y prenda con "Productos Incluidos"', () => {
        const c = cuerpo();
        c.variantes = c.variantes.filter(v => v['Producto_ID'] !== 3);
        producto(c, 1)['Productos Incluidos'] = '2';
        const r = construir(c);
        assert.deepEqual(r.errores, []);
        assert.ok(contiene(r.advertencias, 'ID 3): no tiene variantes; aparecerá como agotado'));
        assert.ok(contiene(r.advertencias, 'ID 1): "Productos Incluidos" solo se usa en conjuntos'));
        assert.deepEqual(r.documentos.find(d => d.idExcel === 1).productosIncluidosIds, []);
    });

    test('sin imagen principal y mismo color con HEX distintos', () => {
        const c = cuerpo();
        producto(c, 1)['Imagen Principal'] = '';
        c.variantes[1]['HEX Variante'] = '#EEEEEE';
        const r = construir(c);
        assert.ok(contiene(r.advertencias, 'sin "Imagen Principal"'));
        assert.ok(contiene(r.advertencias, 'el color "Blanco" aparece con HEX distintos'));
    });

    test('casilla Nuevo marcada llega al documento', () => {
        const c = cuerpo();
        producto(c, 2)['Nuevo'] = true;
        const docs = construir(c).documentos;
        assert.equal(docs.find(d => d.idExcel === 2).nuevo, true);
        assert.equal(docs.find(d => d.idExcel === 1).nuevo, false);
    });
});

/** Repositorio en memoria que además anota el orden de las operaciones. */
function repoMemoria(inicial = []) {
    const repo = {
        datos: structuredClone(inicial), meta: null, llamadas: [],
        async upsertMuchos(docs) {
            repo.llamadas.push('upsert');
            docs.forEach(d => {
                const i = repo.datos.findIndex(x => x.idExcel === d.idExcel);
                if (i >= 0) repo.datos[i] = d; else repo.datos.push(d);
            });
        },
        async guardarMeta(meta) { repo.llamadas.push('meta'); repo.meta = meta; },
        async eliminarAusentes(ids) {
            repo.llamadas.push('eliminar');
            const antes = repo.datos.length;
            repo.datos = repo.datos.filter(d => ids.includes(d.idExcel));
            return antes - repo.datos.length;
        }
    };
    return repo;
}

describe('sincronizar — Mongo es un espejo de lo publicado', () => {
    test('rechaza cuerpos vacíos con 400', async () => {
        for (const vacio of [undefined, null, {}, { productos: [] }, { productos: 'x' }]) {
            await assert.rejects(() => sincronizar(vacio, { repositorio: repoMemoria() }),
                (e) => e instanceof ErrorSync && e.status === 400);
        }
    });

    test('hoja válida: guarda productos, tablas y borra lo que sobre, en ese orden', async () => {
        const repo = repoMemoria([{ idExcel: 99, nombre: 'Antiguo que ya no está en la hoja' }]);
        const r = await sincronizar(cuerpo(), { repositorio: repo });

        assert.deepEqual(repo.llamadas, ['upsert', 'meta', 'eliminar']);
        assert.deepEqual(r, { publicados: 6, noPublicados: 0, eliminados: 1, advertencias: [] });
        assert.deepEqual(repo.datos.map(d => d.idExcel).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
        assert.equal(repo.meta.familiasColor.length, 5);
    });

    test('desmarcar Publicado lo borra de Mongo; volver a marcarlo lo restituye', async () => {
        const repo = repoMemoria();
        await sincronizar(cuerpo(), { repositorio: repo });
        assert.equal(repo.datos.length, 6);

        const sinVestido = cuerpo();
        producto(sinVestido, 5)['Publicado'] = false;
        const r1 = await sincronizar(sinVestido, { repositorio: repo });
        assert.equal(r1.eliminados, 1);
        assert.equal(r1.noPublicados, 1);
        assert.ok(!repo.datos.some(d => d.idExcel === 5));

        const r2 = await sincronizar(cuerpo(), { repositorio: repo });
        assert.equal(r2.eliminados, 0);
        assert.ok(repo.datos.some(d => d.idExcel === 5));
    });

    test('borrar la fila del producto en la hoja también lo quita de Mongo', async () => {
        const repo = repoMemoria();
        await sincronizar(cuerpo(), { repositorio: repo });
        const c = cuerpo();
        c.productos = c.productos.filter(p => p['Producto_ID'] !== 3);
        c.variantes = c.variantes.filter(v => v['Producto_ID'] !== 3);
        assert.equal((await sincronizar(c, { repositorio: repo })).eliminados, 1);
    });

    test('con errores NO se toca Mongo: ni se guarda ni se borra nada', async () => {
        const repo = repoMemoria([{ idExcel: 1, nombre: 'Intacto' }, { idExcel: 99, nombre: 'No debe borrarse' }]);
        const c = cuerpo();
        c.variantes[0]['Familia'] = 'Inexistente';

        await assert.rejects(() => sincronizar(c, { repositorio: repo }), (e) => {
            assert.ok(e instanceof ErrorSync);
            assert.equal(e.status, 400);
            assert.match(e.message, /1 error\(es\). No se guardó nada/);
            assert.ok(e.errores.some(m => m.includes('Inexistente')));
            return true;
        });
        assert.deepEqual(repo.llamadas, []);
        assert.deepEqual(repo.datos.map(d => d.idExcel), [1, 99]);
    });

    test('muchos errores: se informan los primeros 30 y cuántos faltan', async () => {
        const c = cuerpo();
        c.variantes.forEach(v => { v['Familia'] = 'x'; });
        for (let i = 0; i < 40; i++) c.variantes.push({ ...c.variantes[0], 'Talla': `T${i}` });
        await assert.rejects(() => sincronizar(c, { repositorio: repoMemoria() }), (e) => {
            assert.equal(e.errores.length, 31);
            assert.match(e.errores[30], /^\.\.\. y \d+ más\.$/);
            return true;
        });
    });

    test('las advertencias pasan al resultado sin impedir el guardado', async () => {
        const repo = repoMemoria();
        const c = cuerpo();
        producto(c, 1)['Precio Anterior'] = 10;
        const r = await sincronizar(c, { repositorio: repo });
        assert.equal(r.publicados, 6);
        assert.equal(r.advertencias.length, 1);
    });
});

/* ======================================================================== */

describe('pestaña BANNERS (opcional)', () => {
    const { normalizarEnlace, NOMBRE_FOTO } = require('../services/syncService');
    const { NOMBRE_VALIDO } = require('../services/fotoService');
    const fila = (n, datos) => ({ _fila: n, Orden: '', Foto: '', 'Título': '', Enlace: '', 'Texto del enlace': '', Activo: true, ...datos });
    const conBanners = (filas) => { const c = cuerpo(); c.banners = filas; return construirCatalogo(c, { dominios: ['aeris-pe.onrender.com'] }); };

    test('sin la pestaña o vacía: no hay banners y no es un error', () => {
        const r = construirCatalogo(cuerpo());
        assert.deepEqual(r.meta.banners, []);
        assert.deepEqual(r.errores, []);
        assert.deepEqual(conBanners([]).meta.banners, []);
    });

    test('manda "Activo": un solo activo con orden 23 sale igual; empate de orden → el de más arriba', () => {
        let r = conBanners([fila(2, { Orden: 1, Foto: 'a', Activo: false }), fila(3, { Orden: 23, Foto: 'b' })]);
        assert.deepEqual(r.meta.banners.map(b => [b.orden, b.imagen]), [[1, '/images/productos/b']]);
        r = conBanners([fila(2, { Orden: 5, Foto: 'x' }), fila(3, { Orden: 2, Foto: 'y' }), fila(4, { Orden: 5, Foto: 'z' }), fila(5, { Foto: 'sin-orden' })]);
        assert.deepEqual(r.meta.banners.map(b => b.imagen.split('/').pop()), ['y', 'x', 'z', 'sin-orden']);
    });

    test('título, enlace y texto del enlace son opcionales e independientes', () => {
        const r = conBanners([
            fila(2, { Foto: 'solo-imagen' }),
            fila(3, { Foto: 'con-todo', 'Título': 'Sastre Noir', Enlace: 'https://aeris-pe.onrender.com/conjunto/12-sastre-noir', 'Texto del enlace': 'Ver conjunto' }),
            fila(4, { Foto: 'enlace-sin-texto', Enlace: '/catalogo?categoria=conjuntos' }),
            fila(5, { Foto: 'texto-sin-enlace', 'Texto del enlace': 'Ver más' })
        ]);
        assert.deepEqual(r.errores, []);
        assert.deepEqual(r.meta.banners.map(b => [b.titulo, b.enlace, b.textoEnlace]), [
            ['', null, ''],
            ['Sastre Noir', '/conjunto/12-sastre-noir', 'Ver conjunto'],   // sin el dominio
            ['', '/catalogo?categoria=conjuntos', ''],
            ['', null, '']                                                  // texto sin enlace: no se muestra
        ]);
        assert.ok(contiene(r.advertencias, 'BANNERS fila 5: tiene "Texto del enlace" pero no "Enlace"'));
    });

    test('enlaces: propios sin dominio, externos marcados, mal escritos → error con la fila', () => {
        const D = ['aeris-pe.onrender.com'];
        assert.deepEqual(normalizarEnlace('https://www.aeris-pe.onrender.com/p/dia-de-la-madre', D), { enlace: '/p/dia-de-la-madre', externo: false });
        assert.deepEqual(normalizarEnlace('aeris-pe.onrender.com/producto/3-blusa', D), { enlace: '/producto/3-blusa', externo: false });
        assert.deepEqual(normalizarEnlace('https://instagram.com/aeris', D), { enlace: 'https://instagram.com/aeris', externo: true });
        assert.equal(normalizarEnlace('  ', D), null);
        const r = conBanners([fila(7, { Foto: 'a', Enlace: 'javascript:alert(1)' }), fila(8, { Foto: 'b', Enlace: 'conjunto 12' })]);
        assert.equal(r.errores.length, 2);
        assert.ok(contiene(r.errores, 'BANNERS fila 7: el enlace'));
        assert.ok(contiene(r.errores, 'BANNERS fila 8: el enlace'));
    });

    test('foto: obligatoria en los activos y con las mismas reglas de nombre que el servidor de fotos', () => {
        assert.equal(NOMBRE_FOTO.source, NOMBRE_VALIDO.source);
        const r = conBanners([fila(2, { Foto: '', 'Título': 'Sin foto' }), fila(3, { Foto: 'Banner Primavera' }), fila(4, { Foto: 'x', Orden: 'primero' }), fila(5, { Foto: '', Activo: false })]);
        assert.equal(r.errores.length, 3);
        assert.ok(contiene(r.errores, 'BANNERS fila 2: falta la foto'));
        assert.ok(contiene(r.errores, 'BANNERS fila 3: la foto "Banner Primavera" debe ir en minúsculas'));
        assert.ok(contiene(r.errores, 'BANNERS fila 4: "Orden" debe ser un número'));
    });
});
