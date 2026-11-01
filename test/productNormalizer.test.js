const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    toProductDTO, toProductDTOList, idToString, rutaImagen, normalizarHex, ordenarTallas
} = require('../utils/productNormalizer');
const { validarProductDTO, REGLAS } = require('../utils/productContract');
const { jsonParaHtml } = require('../utils/safeJson');

const AHORA = Date.parse('2026-10-29T12:00:00Z');
const haceDias = (n) => new Date(AHORA - n * 24 * 60 * 60 * 1000);

/** Imita un ObjectId de Mongoose: toString() hex y un getter _id que se devuelve a sí mismo. */
const oid = (hex) => {
    const o = { toString: () => hex };
    Object.defineProperty(o, '_id', { get() { return o; } });
    return o;
};

const blusa = (extra = {}) => ({
    _id: oid('aaaaaaaaaaaaaaaaaaaaaa01'),
    idExcel: 1,
    nombre: 'Blusa de seda',
    descripcion: 'Una blusa',
    precio: 120,
    precioAnterior: null,
    categoria: 'Blusas',
    imagenPrincipal: 'blusa-seda-negra.jpg',
    imagenesSecundarias: ['blusa-seda-negra.jpg', 'blusa-seda-blanca.jpg'],
    esConjunto: false,
    variantes: [
        { color: 'Negro', hex: '#000000', familia: 'Negro', talla: 'm', stock: 3, imagen: 'blusa-seda-negra.jpg' },
        { color: 'negro ', hex: '#000', familia: 'negro', talla: 'S', stock: 2, imagen: '' },
        { color: 'Blanco', hex: 'FFFFFF', familia: ' Blanco ', talla: 'M', stock: 0, imagen: 'blusa-seda-blanca.jpg' }
    ],
    createdAt: haceDias(100),
    ...extra
});

const pantalon = (extra = {}) => ({
    _id: oid('aaaaaaaaaaaaaaaaaaaaaa02'),
    idExcel: 2,
    nombre: 'Pantalón sastre',
    descripcion: '',
    precio: 150,
    categoria: 'pantalones',
    imagenPrincipal: 'pantalon-sastre-negro.jpg',
    variantes: [
        { color: 'Negro', hex: '#000000', familia: 'Negro', talla: '38', stock: 4, imagen: 'pantalon-sastre-negro.jpg' },
        { color: 'Negro', hex: '#000000', familia: 'Negro', talla: '36', stock: 1, imagen: 'pantalon-sastre-negro.jpg' }
    ],
    createdAt: haceDias(100),
    ...extra
});

const conjunto = (extra = {}) => ({
    _id: oid('aaaaaaaaaaaaaaaaaaaaaa03'),
    idExcel: 3,
    nombre: 'Conjunto Noir',
    descripcion: 'Set',
    precio: 250,
    categoria: 'conjuntos',
    imagenPrincipal: 'conjunto-noir.jpg',
    esConjunto: true,
    productosIncluidosIds: [2, 1],            // orden de la hoja: pantalón primero
    productosIncluidos: [],                   // caché de ObjectId vacía/obsoleta
    variantes: [],
    createdAt: haceDias(100),
    ...extra
});

describe('toProductDTO — prenda', () => {
    test('cumple el contrato y normaliza los campos básicos', () => {
        const dto = toProductDTO(blusa(), { ahora: AHORA });

        assert.deepEqual(validarProductDTO(dto), []);
        assert.equal(dto.id, 'aaaaaaaaaaaaaaaaaaaaaa01');
        assert.equal(dto.sku, 1);
        assert.equal(dto.tipo, 'prenda');
        assert.equal(dto.categoria, 'blusas');
        assert.deepEqual(dto.familiasColor, ['negro', 'blanco']);      // sale de las variantes
        assert.equal(dto.urlId, '1-blusa-de-seda');
        assert.equal(dto.url, '/producto/1-blusa-de-seda');
        assert.equal(dto.esNuevo, false);
        assert.equal(dto.publicado, true);
        assert.equal(dto.stockTotal, 5);
        assert.equal(dto.agotado, false);
        assert.deepEqual(dto.piezas, []);
        assert.equal(dto.creadoEn, haceDias(100).toISOString());
    });

    test('creadoEn es null si la fecha falta o es inválida (y el DTO sigue siendo válido)', () => {
        for (const createdAt of [undefined, null, 'no-es-fecha']) {
            const dto = toProductDTO(blusa({ createdAt }), { ahora: AHORA });
            assert.equal(dto.creadoEn, null);
            assert.deepEqual(validarProductDTO(dto), []);
        }
    });

    test('una sola grafía de color y tallas en MAYÚSCULAS y ordenadas', () => {
        const dto = toProductDTO(blusa(), { ahora: AHORA });

        assert.deepEqual(dto.colores.map(c => c.nombre), ['Negro', 'Blanco']);
        assert.deepEqual(dto.tallas, ['S', 'M']);
        // "negro " (otra grafía) quedó como "Negro" → comparación estricta posible
        assert.ok(dto.variantes.every(v => ['Negro', 'Blanco'].includes(v.color)));
        assert.equal(dto.colores[1].hex, '#ffffff');           // "FFFFFF" → "#ffffff"
    });

    test('imágenes: relativas se completan, vacías heredan la del producto, galería sin duplicados', () => {
        const dto = toProductDTO(blusa(), { ahora: AHORA });

        assert.equal(dto.imagen, '/images/productos/blusa-seda-negra.jpg');
        assert.deepEqual(dto.galeria, [
            '/images/productos/blusa-seda-negra.jpg',
            '/images/productos/blusa-seda-blanca.jpg'
        ]);
        const sinImagen = dto.variantes.find(v => v.talla === 'S');
        assert.equal(sinImagen.imagen, dto.imagen);
    });

    test('rutaImagen: vacío → placeholder; http y "/" se respetan', () => {
        assert.equal(rutaImagen(''), REGLAS.IMAGEN_PLACEHOLDER);
        assert.equal(rutaImagen(null), REGLAS.IMAGEN_PLACEHOLDER);
        assert.equal(rutaImagen('https://cdn.x/a.jpg'), 'https://cdn.x/a.jpg');
        assert.equal(rutaImagen('/images/a.jpg'), '/images/a.jpg');
        assert.equal(rutaImagen(' a.jpg '), '/images/productos/a.jpg');
    });

    test('sin imágenes ni variantes: usa placeholder y queda agotado, pero sigue siendo válido', () => {
        const dto = toProductDTO({ _id: oid('bbbbbbbbbbbbbbbbbbbbbbbb'), nombre: '', precio: '80' }, { ahora: AHORA });

        assert.deepEqual(validarProductDTO(dto), []);
        assert.equal(dto.imagen, REGLAS.IMAGEN_PLACEHOLDER);
        assert.equal(dto.nombre, 'Prenda AERIS');
        assert.equal(dto.precio, 80);
        assert.equal(dto.agotado, true);
    });

    test('un apóstrofe en el nombre se conserva (y jsonParaHtml no lo rompe)', () => {
        const dto = toProductDTO(blusa({ nombre: "Women's blouse </script><b>" }), { ahora: AHORA });
        const html = jsonParaHtml(dto);

        assert.ok(!html.includes('</script>'));
        assert.ok(!html.includes('<'));
        assert.deepEqual(JSON.parse(html), JSON.parse(JSON.stringify(dto)));   // ida y vuelta intacta
    });
});

describe('toProductDTO — descuento, novedad y últimas unidades (hechos, sin etiquetas)', () => {
    test('descuento real: solo el precio anterior (tachado); sin porcentaje ni badge', () => {
        const dto = toProductDTO(blusa({ precio: 75, precioAnterior: 100 }), { ahora: AHORA });
        assert.equal(dto.precioAnterior, 100);
        assert.ok(!('descuentoPct' in dto));
        assert.ok(!('badge' in dto));
        assert.deepEqual(validarProductDTO(dto), []);
    });

    test('precioAnterior <= precio o inválido NO es descuento', () => {
        for (const precioAnterior of [100, 90, null, '', undefined, 'abc', 0]) {
            const dto = toProductDTO(blusa({ precio: 100, precioAnterior }), { ahora: AHORA });
            assert.equal(dto.precioAnterior, null, `precioAnterior=${precioAnterior}`);
        }
        // Diferencia de menos del 1 %: no se tacha
        assert.equal(toProductDTO(blusa({ precio: 99.7, precioAnterior: 100 }), { ahora: AHORA }).precioAnterior, null);
    });

    test('nuevo y descuento son hechos independientes: pueden darse a la vez', () => {
        const dto = toProductDTO(blusa({ precio: 50, precioAnterior: 100, nuevo: true }), { ahora: AHORA });
        assert.equal(dto.esNuevo, true);
        assert.equal(dto.precioAnterior, 100);
    });

    test('esNuevo viene SOLO de la casilla "Nuevo": ni la fecha ni las etiquetas antiguas cuentan', () => {
        assert.equal(toProductDTO(blusa({ createdAt: haceDias(1) })).esNuevo, false);
        assert.equal(toProductDTO(blusa({ createdAt: haceDias(1), etiquetas: ['NUEVO'] })).esNuevo, false);
        assert.equal(toProductDTO(blusa({ createdAt: haceDias(500), nuevo: true })).esNuevo, true);
        assert.equal(toProductDTO(blusa({ nuevo: 'true' })).esNuevo, false);      // solo el booleano real
    });

    test('createdAt como {$date} (export JSON de Mongo) también se convierte a ISO', () => {
        const iso = haceDias(2).toISOString();
        assert.equal(toProductDTO(blusa({ createdAt: { $date: iso } })).creadoEn, iso);
    });

    test('últimas unidades: stock entre 1 y el umbral, por variante', () => {
        const dto = toProductDTO(blusa({
            variantes: [0, 1, REGLAS.UMBRAL_ULTIMAS_UNIDADES, REGLAS.UMBRAL_ULTIMAS_UNIDADES + 1]
                .map((stock, i) => ({ color: 'Negro', hex: '#000', familia: 'Negro', talla: ['S', 'M', 'L', 'XL'][i], stock, imagen: 'a.jpg' }))
        }));
        assert.equal(REGLAS.UMBRAL_ULTIMAS_UNIDADES, 3);
        assert.deepEqual(dto.variantes.map(v => v.ultimasUnidades), [false, true, true, false]);
        assert.deepEqual(validarProductDTO(dto), []);
    });
});

describe('toProductDTO — familias de color y URL', () => {
    test('la familia es POR VARIANTE: un producto negro con una variante vino expone ambas', () => {
        const dto = toProductDTO(blusa({
            variantes: [
                { color: 'Negro', hex: '#171717', familia: 'Negro', talla: 'M', stock: 5, imagen: 'n.jpg' },
                { color: 'Vino', hex: '#581825', familia: 'Vino', talla: 'XL', stock: 3, imagen: 'v.jpg' }
            ]
        }));
        assert.deepEqual(dto.familiasColor, ['negro', 'vino']);
        assert.deepEqual(dto.colores.map(c => c.familia), ['negro', 'vino']);
    });

    test('varios colores pueden compartir familia ("Verde Kaki" y "Verde Agua" → verde)', () => {
        const dto = toProductDTO(blusa({
            variantes: [
                { color: 'Verde Kaki', hex: '#4a5240', familia: 'Verde', talla: 'M', stock: 1, imagen: 'a.jpg' },
                { color: 'Verde Agua', hex: '#7fd1ae', familia: 'Verde', talla: 'M', stock: 1, imagen: 'b.jpg' }
            ]
        }));
        assert.deepEqual(dto.familiasColor, ['verde']);
        assert.equal(dto.colores.length, 2);
    });

    test('documentos antiguos sin familia en las variantes usan familiaColor como respaldo', () => {
        const dto = toProductDTO(blusa({
            familiaColor: ['Negro', 'negro', ' Blanco '],
            variantes: [{ color: 'Negro', hex: '#000', talla: 'M', stock: 1, imagen: 'a.jpg' }]
        }));
        assert.deepEqual(dto.familiasColor, ['negro', 'blanco']);
    });

    test('urlId = Producto_ID + slug sin tildes ni símbolos; sin nombre usa solo el número', () => {
        assert.equal(toProductDTO(blusa({ idExcel: 4, nombre: 'Vestido Midi Abertura' })).urlId, '4-vestido-midi-abertura');
        assert.equal(toProductDTO(blusa({ idExcel: 2, nombre: 'Pantalón Sastre Ancho' })).urlId, '2-pantalon-sastre-ancho');
        assert.equal(toProductDTO(blusa({ idExcel: 7, nombre: '¡¡!!' })).urlId, '7');
        const sinSku = toProductDTO(blusa({ idExcel: undefined }));
        assert.equal(sinSku.urlId, 'aaaaaaaaaaaaaaaaaaaaaa01');
        assert.deepEqual(validarProductDTO(sinSku), []);
    });
});

describe('toProductDTO — conjuntos', () => {
    const catalogo = () => [blusa(), pantalon(), conjunto()];

    test('resuelve las piezas SIN populate, en el orden de la hoja', () => {
        const [, , raw] = catalogo();
        const dto = toProductDTO(raw, { catalogo: catalogo(), ahora: AHORA });

        assert.deepEqual(validarProductDTO(dto), []);
        assert.equal(dto.tipo, 'conjunto');
        assert.equal(dto.url, '/conjunto/3-conjunto-noir');
        assert.deepEqual(dto.piezas.map(p => p.nombre), ['Pantalón sastre', 'Blusa de seda']);
        assert.deepEqual(dto.variantes, []);
        assert.equal(dto.stockTotal, null);
    });

    test('agrega colores y tallas de las piezas (unión, ordenadas)', () => {
        const [, , raw] = catalogo();
        const dto = toProductDTO(raw, { catalogo: catalogo(), ahora: AHORA });

        assert.deepEqual(dto.colores.map(c => c.nombre), ['Negro', 'Blanco']);
        assert.deepEqual(dto.tallas, ['S', 'M', '36', '38']);
    });

    test('si los ids de la hoja no resuelven, usa la caché de ObjectId (productosIncluidos)', () => {
        const raw = conjunto({
            productosIncluidosIds: [],
            productosIncluidos: [oid('aaaaaaaaaaaaaaaaaaaaaa01'), oid('aaaaaaaaaaaaaaaaaaaaaa02')]
        });
        const dto = toProductDTO(raw, { catalogo: [blusa(), pantalon(), raw], ahora: AHORA });
        assert.deepEqual(dto.piezas.map(p => p.nombre), ['Blusa de seda', 'Pantalón sastre']);
    });

    test('acepta piezas ya pobladas por populate()', () => {
        const raw = conjunto({ productosIncluidosIds: [], productosIncluidos: [blusa(), pantalon()] });
        const dto = toProductDTO(raw, { ahora: AHORA });
        assert.equal(dto.piezas.length, 2);
    });

    test('agotado si alguna pieza está agotada o si no hay piezas', () => {
        const sinStock = pantalon({ variantes: [{ color: 'Negro', hex: '#000', familia: 'Negro', talla: '38', stock: 0, imagen: 'x.jpg' }] });
        const raw = conjunto();
        const a = toProductDTO(raw, { catalogo: [blusa(), sinStock, raw], ahora: AHORA });
        const b = toProductDTO(raw, { catalogo: [raw], ahora: AHORA });

        assert.equal(a.agotado, true);
        assert.deepEqual(validarProductDTO(a), []);
        assert.equal(b.agotado, true);
        assert.deepEqual(b.piezas, []);
        assert.deepEqual(validarProductDTO(b), []);
    });

    test('el conjunto une las familias de sus piezas', () => {
        const [, , raw] = catalogo();
        const dto = toProductDTO(raw, { catalogo: catalogo(), ahora: AHORA });
        assert.deepEqual([...dto.familiasColor].sort(), ['blanco', 'negro']);
    });

    test('una pieza NO publicada deja el conjunto agotado, pero el contrato sigue siendo válido', () => {
        const raw = conjunto();
        const dto = toProductDTO(raw, { catalogo: [blusa({ publicado: false }), pantalon(), raw] });
        assert.equal(dto.piezas.find(p => p.nombre === 'Blusa de seda').agotado, true);
        assert.equal(dto.agotado, true);
        assert.deepEqual(validarProductDTO(dto), []);
    });

    test('se detecta conjunto por la categoría aunque falte esConjunto', () => {
        const raw = conjunto({ esConjunto: false });
        assert.equal(toProductDTO(raw, { catalogo: catalogo(), ahora: AHORA }).tipo, 'conjunto');
    });

    test('un conjunto nunca contiene a otro conjunto (evita recursión)', () => {
        const otro = conjunto({ _id: oid('aaaaaaaaaaaaaaaaaaaaaa09'), idExcel: 9, productosIncluidosIds: [3] });
        const raw = conjunto({ productosIncluidosIds: [9, 1] });
        const dto = toProductDTO(raw, { catalogo: [blusa(), otro, raw], ahora: AHORA });
        assert.deepEqual(dto.piezas.map(p => p.nombre), ['Blusa de seda']);
    });
});

describe('toProductDTOList y utilidades', () => {
    test('descarta documentos sin id y resuelve conjuntos en una pasada', () => {
        const lista = toProductDTOList([blusa(), null, { nombre: 'sin id' }, pantalon(), conjunto()], { ahora: AHORA });
        assert.equal(lista.length, 3);
        assert.deepEqual(lista.flatMap(p => validarProductDTO(p)), []);
        assert.equal(lista[2].piezas.length, 2);
    });

    test('la lista solo trae productos publicados (salvo incluirNoPublicados)', () => {
        const crudos = [blusa(), pantalon({ publicado: false })];
        assert.deepEqual(toProductDTOList(crudos).map(p => p.nombre), ['Blusa de seda']);
        assert.equal(toProductDTOList(crudos, { incluirNoPublicados: true }).length, 2);
    });

    test('toProductDTO(null) → null', () => {
        assert.equal(toProductDTO(null), null);
        assert.equal(toProductDTO('x'), null);
    });

    test('idToString soporta string, ObjectId, {$oid} y documento poblado', () => {
        assert.equal(idToString(' abc '), 'abc');
        assert.equal(idToString(oid('123')), '123');
        assert.equal(idToString({ $oid: '456' }), '456');
        assert.equal(idToString({ _id: oid('789'), nombre: 'x' }), '789');
        assert.equal(idToString(undefined), '');
    });

    test('ordenarTallas: letras, luego números, luego el resto', () => {
        assert.deepEqual(
            ordenarTallas(['XL', 'M', '38', 'S', '36', 'ÚNICA', 'XXS']),
            ['XXS', 'S', 'M', 'XL', '36', '38', 'ÚNICA']
        );
    });

    test('ordenarTallas: manda la columna Orden de TALLAS; lo que no figura va después', () => {
        const orden = new Map([['L', 1], ['M', 2], ['S', 3]]);       // orden "raro" a propósito
        assert.deepEqual(ordenarTallas(['S', 'M', 'L', 'XL', '36'], orden), ['L', 'M', 'S', 'XL', '36']);
        assert.deepEqual(ordenarTallas(['S', 'M'], { M: 1, S: 2 }), ['M', 'S']);   // también acepta objeto
    });

    test('normalizarHex', () => {
        assert.equal(normalizarHex('#FFF'), '#fff');
        assert.equal(normalizarHex('ABCDEF'), '#abcdef');
        assert.equal(normalizarHex('rojo'), REGLAS.HEX_POR_DEFECTO);
        assert.equal(normalizarHex(undefined), REGLAS.HEX_POR_DEFECTO);
    });
});

describe('validarProductDTO detecta violaciones del contrato', () => {
    test('encuentra incoherencias', () => {
        const dto = toProductDTO(blusa(), { ahora: AHORA });
        const roto = { ...dto, precioAnterior: 10, tallas: ['m'], badge: { tipo: 'nuevo', texto: 'NUEVO' } };
        const errores = validarProductDTO(roto);
        assert.ok(errores.length >= 3, errores.join(' | '));
    });
});

describe('jsonParaHtml', () => {
    test('escapa < > & y U+2028/2029; valores raros no rompen', () => {
        const s = jsonParaHtml({ a: '<script>&</script>\u2028\u2029' });
        assert.ok(!/[<>&\u2028\u2029]/.test(s));
        assert.equal(jsonParaHtml(undefined), 'null');
        assert.equal(JSON.parse(jsonParaHtml({ a: "O'Neil" })).a, "O'Neil");
    });
});
