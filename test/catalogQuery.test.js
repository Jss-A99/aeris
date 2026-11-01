const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const Q = require('../public/js/core/catalog-query');
const { armarPaginaCatalogo } = require('../utils/catalogPage');
const { elegirPestanas, elegirLooks } = require('../utils/homeSelection');

/* ---------- Datos de ejemplo (solo los campos que usan las reglas) ---------- */
const v = (familia, talla, stock = 2) => ({ color: familia, familia, talla, stock });
let sec = 0;
const prenda = (nombre, categoria, precio, variantes, extra = {}) => ({
    id: `id-${++sec}`, tipo: 'prenda', nombre, categoria, precio, precioAnterior: null,
    esNuevo: false, creadoEn: '2026-01-01T00:00:00.000Z', piezas: [], variantes,
    agotado: variantes.every(x => x.stock <= 0), ...extra
});
const conjunto = (nombre, precio, piezas, extra = {}) => ({
    id: `id-${++sec}`, tipo: 'conjunto', nombre, categoria: 'conjuntos', precio, precioAnterior: null,
    esNuevo: false, creadoEn: '2026-01-01T00:00:00.000Z', variantes: [],
    piezas: piezas.map(vs => ({ variantes: vs })), agotado: false, ...extra
});

const catalogo = () => {
    sec = 0;
    return [
        prenda('Blusa negra', 'blusas', 80, [v('negro', 'M'), v('blanco', 'L')]),
        prenda('Blusa agotada', 'blusas', 70, [v('negro', 'M', 0)]),
        prenda('Pantalón', 'pantalones', 120, [v('negro', 'L'), v('beige', 'M', 0)], { precioAnterior: 150, esNuevo: true, creadoEn: '2026-03-01T00:00:00.000Z' }),
        prenda('Vestido', 'vestidos', 100, [v('rojo', 'XL')], { esNuevo: true, creadoEn: '2026-05-01T00:00:00.000Z' }),
        conjunto('Set', 200, [[v('beige', 'M')], [v('beige', 'L')]])
    ];
};

const FILTROS = {
    categorias: [{ id: 'blusas', nombre: 'Blusas' }, { id: 'pantalones', nombre: 'Pantalones' },
        { id: 'vestidos', nombre: 'Vestidos' }, { id: 'conjuntos', nombre: 'Conjuntos' }],
    precio: { min: 70, max: 200 },
    tallas: { letras: ['M', 'L', 'XL'], numericas: [] },
    familiasColor: [{ id: 'beige', nombre: 'Beige', hex: '#d4c3b3' }, { id: 'blanco', nombre: 'Blanco', hex: '#ffffff' },
        { id: 'negro', nombre: 'Negro', hex: '#171717' }, { id: 'rojo', nombre: 'Rojo', hex: '#8b0000' }]
};
const estado = (query) => Q.parsear(query, FILTROS);
const nombres = (lista) => lista.map(p => p.nombre);

/* ======================================================================== */

describe('catalog-query: leer la URL', () => {
    test('sin nada: todo, sin orden, rango completo, página 1', () => {
        assert.deepEqual(estado({}), { categoria: 'todo', orden: null, tallas: [], colores: [], min: 70, max: 200, pagina: 1 });
    });

    test('descarta lo que no existe y normaliza mayúsculas; acepta coma o repetido', () => {
        const e = estado({ orden: 'barato', talla: ['l', 'XXXL'], color: 'NEGRO,morado', pagina: '-3' });
        assert.equal(e.orden, null);
        assert.deepEqual(e.tallas, ['L']);
        assert.deepEqual(e.colores, ['negro']);
        assert.equal(e.pagina, 1);
    });

    test('precio: se ajusta al rango real y se ordena si viene al revés', () => {
        const e = estado({ min: '500', max: '10' });
        assert.deepEqual([e.min, e.max], [70, 200]);
        const f = estado({ min: '150', max: '90' });
        assert.deepEqual([f.min, f.max], [90, 150]);
        assert.deepEqual([estado({ min: 'abc' }).min], [70]);
    });

    test('aQuery omite los valores por defecto y cambiar un filtro vuelve a la página 1', () => {
        assert.equal(Q.aQuery(estado({}), FILTROS), '');
        const e = estado({ categoria: 'blusas', talla: 'M,L', pagina: '3' });
        assert.equal(Q.aQuery(e, FILTROS), '?categoria=blusas&talla=M%2CL&pagina=3');
        assert.equal(Q.aQuery(e, FILTROS, { orden: 'asc' }), '?categoria=blusas&orden=asc&talla=M%2CL');
        assert.equal(Q.aQuery(e, FILTROS, { pagina: 2 }), '?categoria=blusas&talla=M%2CL&pagina=2');
    });

    test('"Eliminar filtros" cuenta también el orden; la categoría no cuenta', () => {
        assert.equal(Q.nActivos(estado({ categoria: 'blusas' }), FILTROS), 0);
        assert.equal(Q.nActivos(estado({ orden: 'nuevo' }), FILTROS), 1);
        assert.equal(Q.nActivos(estado({ orden: 'asc', talla: 'M', color: 'negro', max: '150' }), FILTROS), 4);
    });
});

describe('catalog-query: filtrar y ordenar', () => {
    test('talla y color se cruzan: tiene que existir esa combinación con stock', () => {
        const p = catalogo();
        assert.deepEqual(nombres(Q.filtrar(p, estado({ talla: 'M', color: 'negro' }))), ['Blusa negra']);
        // Pantalón: negro solo en L; beige M sin stock → no aparece con M
        assert.deepEqual(nombres(Q.filtrar(p, estado({ talla: 'L', color: 'blanco' }))), ['Blusa negra']);
        assert.deepEqual(nombres(Q.filtrar(p, estado({ color: 'beige' }))), ['Set']);
    });

    test('un conjunto cumple talla y color por sus piezas', () => {
        assert.deepEqual(nombres(Q.filtrar(catalogo(), estado({ categoria: 'conjuntos', talla: 'L' }))), ['Set']);
    });

    test('Descuentos: solo los que tienen precio anterior', () => {
        assert.deepEqual(nombres(Q.filtrar(catalogo(), estado({ categoria: 'descuentos' }))), ['Pantalón']);
    });

    test('sin orden: el de la hoja, con los agotados al final', () => {
        assert.deepEqual(nombres(Q.filtrar(catalogo(), estado({}))), ['Blusa negra', 'Pantalón', 'Vestido', 'Set', 'Blusa agotada']);
    });

    test('Novedades: los "Nuevo" primero (el más reciente antes); precio ascendente y descendente', () => {
        assert.deepEqual(nombres(Q.filtrar(catalogo(), estado({ orden: 'nuevo' }))).slice(0, 2), ['Vestido', 'Pantalón']);
        assert.deepEqual(nombres(Q.filtrar(catalogo(), estado({ orden: 'asc' }))), ['Blusa negra', 'Vestido', 'Pantalón', 'Set', 'Blusa agotada']);
        assert.deepEqual(nombres(Q.filtrar(catalogo(), estado({ orden: 'desc' }))), ['Set', 'Pantalón', 'Vestido', 'Blusa negra', 'Blusa agotada']);
    });

    test('rango de precio', () => {
        assert.deepEqual(nombres(Q.filtrar(catalogo(), estado({ min: '90', max: '130' }))), ['Pantalón', 'Vestido']);
    });

    test('paginar ajusta una página fuera de rango; numerosPagina marca los saltos', () => {
        const lista = Array.from({ length: 30 }, (_, i) => i);
        const r = Q.paginar(lista, 9, 12);
        assert.deepEqual([r.pagina, r.paginas, r.desde, r.items.length], [3, 3, 24, 6]);
        assert.deepEqual(Q.numerosPagina(1, 3), [1, 2, 3]);
        assert.deepEqual(Q.numerosPagina(6, 12), [1, '…', 5, 6, 7, '…', 12]);
        assert.deepEqual(Q.numerosPagina(2, 12), [1, 2, 3, '…', 12]);
    });

    test('compactar deja lo justo para contar en el navegador, con el mismo resultado', () => {
        const p = catalogo();
        const e = estado({ talla: 'L', min: '100' });
        assert.equal(p.map(Q.compactar).filter(x => Q.cumple(x, e)).length, Q.filtrar(p, e).length);
        assert.equal('nombre' in Q.compactar(p[0]), false);
    });
});

describe('página de catálogo (view model)', () => {
    const armar = (query) => armarPaginaCatalogo({ productos: catalogo(), filtros: FILTROS, query });

    test('pestañas: Todo, las de la hoja y Descuentos; los números respetan los demás filtros', () => {
        const v = armar({ talla: 'M' });
        assert.deepEqual(v.pestanas.map(t => t.nombre), ['Todo', 'Blusas', 'Pantalones', 'Vestidos', 'Conjuntos', 'Descuentos']);
        assert.deepEqual(v.pestanas.map(t => t.total), [2, 1, 0, 0, 1, 0]);
        assert.equal(v.pestanas.find(t => t.id === 'blusas').href, '/catalogo?categoria=blusas&talla=M');
    });

    test('Conjuntos va después de las prendas aunque la hoja diga otro orden', () => {
        const alfabetico = { ...FILTROS, categorias: [{ id: 'blusas', nombre: 'Blusas' }, { id: 'conjuntos', nombre: 'Conjuntos' },
            { id: 'pantalones', nombre: 'Pantalones' }, { id: 'vestidos', nombre: 'Vestidos' }] };
        const v = armarPaginaCatalogo({ productos: catalogo(), filtros: alfabetico, query: {} });
        assert.deepEqual(v.pestanas.map(t => t.nombre), ['Todo', 'Blusas', 'Pantalones', 'Vestidos', 'Conjuntos', 'Descuentos']);
    });

    test('sin descuentos no hay pestaña Descuentos; una categoría inventada cae en Todo', () => {
        const productos = catalogo().map(p => ({ ...p, precioAnterior: null }));
        const v = armarPaginaCatalogo({ productos, filtros: FILTROS, query: { categoria: 'inventada' } });
        assert.equal(v.pestanas.some(t => t.id === 'descuentos'), false);
        assert.equal(v.consulta.categoria, 'todo');
        assert.equal(v.pestanas[0].activa, true);
    });

    test('chips con enlace para quitar cada filtro, y enlace para quitarlos todos', () => {
        const v = armar({ categoria: 'blusas', orden: 'asc', talla: 'M,L', color: 'negro' });
        assert.deepEqual(v.chips.map(c => c.texto), ['Precio ascendente', 'Talla M', 'Talla L', 'Negro']);
        assert.equal(v.chips[1].href, '/catalogo?categoria=blusas&orden=asc&talla=L&color=negro');
        assert.equal(v.chips[3].hex, '#171717');
        assert.equal(v.hrefLimpiar, '/catalogo?categoria=blusas');
        assert.equal(v.nActivos, 4);
    });

    test('12 por página: paginación solo cuando hace falta', () => {
        const muchos = Array.from({ length: 25 }, (_, i) => prenda(`P${i}`, 'blusas', 100, [v('negro', 'M')]));
        const pag = armarPaginaCatalogo({ productos: muchos, filtros: FILTROS, query: { pagina: '2' } });
        assert.equal(pag.resultado.items.length, 12);
        assert.equal(pag.resultado.items[0].nombre, 'P12');
        assert.equal(pag.paginacion.anterior, '/catalogo');
        assert.equal(pag.paginacion.siguiente, '/catalogo?pagina=3');
        assert.deepEqual(pag.paginacion.numeros.map(n => n.actual), [false, true, false]);
        assert.equal(armar({}).paginacion, null);
    });
});

describe('selección del inicio', () => {
    // azar fijo: siempre elige el último → barajar deja el orden original
    const sinAzar = () => 0.999999;
    const muchas = () => {
        sec = 0;
        return [
            ...Array.from({ length: 10 }, (_, i) => prenda(`Blusa ${i}`, 'blusas', 80, [v('negro', 'M')])),
            prenda('Blusa agotada', 'blusas', 80, [v('negro', 'M', 0)]),
            ...Array.from({ length: 3 }, (_, i) => prenda(`Pantalón ${i}`, 'pantalones', 90, [v('negro', 'M')]))
        ];
    };
    const CATS = [{ id: 'blusas', nombre: 'Blusas' }, { id: 'pantalones', nombre: 'Pantalones' }, { id: 'vestidos', nombre: 'Vestidos' }];

    test('hasta 8 por pestaña, sin agotados; el número es el total real', () => {
        const [todo, blusas, pantalones] = elegirPestanas(muchas(), CATS, { azar: sinAzar });
        assert.equal(blusas.items.length, 8);
        assert.equal(blusas.total, 11);
        assert.ok(blusas.items.every(p => !p.agotado));
        assert.equal(pantalones.items.length, 3);
        assert.equal(todo.total, 14);
    });

    test('las categorías sin prendas no salen', () => {
        assert.deepEqual(elegirPestanas(muchas(), CATS, { azar: sinAzar }).map(t => t.id), ['todo', 'blusas', 'pantalones']);
    });

    test('"Todo" reparte entre categorías (no 8 blusas)', () => {
        const [todo] = elegirPestanas(muchas(), CATS, { azar: sinAzar });
        assert.equal(todo.items.length, 8);
        assert.equal(todo.items.filter(p => p.categoria === 'pantalones').length, 3);
    });

    test('es al azar: con otro azar sale otra mezcla', () => {
        let s = 1;
        const otroAzar = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        const a = elegirPestanas(muchas(), CATS, { azar: sinAzar })[1].items.map(p => p.nombre);
        const b = elegirPestanas(muchas(), CATS, { azar: otroAzar })[1].items.map(p => p.nombre);
        assert.notDeepEqual(a, b);
    });

    test('looks: hasta 3 con stock, los "Nuevo" primero', () => {
        sec = 0;
        const lista = [conjunto('A', 1, []), conjunto('B', 1, [], { agotado: true }), conjunto('C', 1, [], { esNuevo: true }),
            conjunto('D', 1, []), conjunto('E', 1, [])];
        assert.deepEqual(elegirLooks(lista).map(c => c.nombre), ['C', 'A', 'D']);
    });
});
