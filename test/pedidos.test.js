const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { crearApp } = require('../server');
const { crearPedidoRepositoryMemoria } = require('../repositories/pedidoRepository');

/* Catálogo de prueba: una blusa (stock 3 en Negro M), un pantalón y un conjunto con ambos */
const ID = (n) => String(n).padStart(24, '0');
const v = (color, talla, stock) => ({ color, hex: '#111111', familia: color.toLowerCase(), talla, stock, imagen: 'x.jpg' });
const repo = {
    async listarTodos() {
        return [
            { _id: ID(1), idExcel: 1, nombre: 'Blusa Seda', descripcion: '-', precio: 80, categoria: 'blusas', imagenPrincipal: 'b.jpg', createdAt: new Date(), variantes: [v('Negro', 'M', 3)] },
            { _id: ID(2), idExcel: 2, nombre: 'Pantalón Sastre', descripcion: '-', precio: 120, categoria: 'pantalones', imagenPrincipal: 'p.jpg', createdAt: new Date(), variantes: [v('Negro', 'L', 2)] },
            { _id: ID(3), idExcel: 3, nombre: 'Set Noir', descripcion: '-', precio: 180, categoria: 'conjuntos', esConjunto: true, productosIncluidosIds: [1, 2], imagenPrincipal: 's.jpg', createdAt: new Date(), variantes: [] }
        ];
    },
    async leerMeta() {
        return { categorias: [], familiasColor: [], tallas: [],
            promociones: [{ codigo: 'AERIS10', tipo: 'porcentaje', valor: 10, minimo: 0, vence: null, activo: true }] };
    }
};

describe('repartir montos en céntimos', () => {
    const { repartir } = require('../services/pedidoService');
    test('proporcional y sin perder ni sobrar un céntimo', () => {
        assert.deepEqual(repartir(180, [80, 120]), [72, 108]);
        assert.deepEqual(repartir(100, [1, 1, 1]), [33.34, 33.33, 33.33]);
        assert.deepEqual(repartir(10, [0, 0]), [5, 5]);
        const partes = repartir(289.9, [179.9, 129.9]);
        assert.equal(Math.round(partes.reduce((s, p) => s + p, 0) * 100), 28990);
    });
});

describe('pedidos: "Finalizar orden" y la pestaña PEDIDOS', () => {
    const TOKEN = 'token-de-prueba-pedidos';
    const TOKEN_ORIGINAL = process.env.SYNC_TOKEN;
    const pedidoRepositorio = crearPedidoRepositoryMemoria();
    let servidor, base;
    const post = (ruta, cuerpo, token) => fetch(base + ruta, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-sync-token': token } : {}) }, body: JSON.stringify(cuerpo)
    });
    const pedir = (cuerpo) => post('/api/pedidos', cuerpo);

    before(async () => {
        process.env.SYNC_TOKEN = TOKEN;
        const app = crearApp({ repositorio: repo, pedidoRepositorio, ttlCatalogoMs: 60000 });
        await new Promise(r => { servidor = app.listen(0, r); });
        base = `http://127.0.0.1:${servidor.address().port}`;
    });
    after(async () => {
        if (TOKEN_ORIGINAL === undefined) delete process.env.SYNC_TOKEN; else process.env.SYNC_TOKEN = TOKEN_ORIGINAL;
        await new Promise(r => servidor.close(r));
    });

    test('registra el pedido con código correlativo, precios del servidor y descuento validado', async () => {
        const r = await (await pedir({
            entrega: 'lima', codigoPromo: 'aeris10',
            lineas: [
                { id: ID(1), cantidad: 2, color: 'Negro', talla: 'M', precio: 1 },    // el precio del navegador se ignora
                { id: ID(3), cantidad: 1, componentes: [{ id: ID(1), color: 'Negro', talla: 'M' }, { id: ID(2), color: 'Negro', talla: 'L' }] }
            ]
        })).json();
        assert.equal(r.ok, true);
        assert.equal(r.codigo, 'AER-0001');
        assert.deepEqual(r.totales, { subtotal: 340, descuento: 34, total: 306 });
        assert.deepEqual(r.promo, { codigo: 'AERIS10', descuento: 34 });
        assert.equal(r.envioGratis, true);                   // 306 ≥ 199
        assert.equal(r.lineas[1].componentes.length, 2);

        const guardado = pedidoRepositorio.pedidos[0];
        // Una fila por prenda; el conjunto, una por pieza. Importe = lo cobrado por la fila:
        // el conjunto (180) se reparte según las piezas sueltas (80 y 120 → 72 y 108) y el 10 % de
        // descuento se reparte entre todas las filas. La suma da EXACTO el total (306).
        assert.deepEqual(guardado.filas, [
            { productoId: 1, producto: 'Blusa Seda', conjunto: '', color: 'Negro', talla: 'M', cantidad: 2, importe: 144 },
            { productoId: 1, producto: 'Blusa Seda', conjunto: 'Set Noir', color: 'Negro', talla: 'M', cantidad: 1, importe: 64.8 },
            { productoId: 2, producto: 'Pantalón Sastre', conjunto: 'Set Noir', color: 'Negro', talla: 'L', cantidad: 1, importe: 97.2 }
        ]);
        assert.equal(Math.round(guardado.filas.reduce((s, f) => s + f.importe, 0) * 100) / 100, guardado.total);
        assert.equal((await (await pedir({ entrega: 'recojo', lineas: [{ id: ID(2), cantidad: 1, color: 'Negro', talla: 'L' }] })).json()).codigo, 'AER-0002');
    });

    test('rechaza con un mensaje claro: sin entrega, bolsa vacía, sin stock suficiente, artículo inexistente', async () => {
        const sinEntrega = await pedir({ lineas: [{ id: ID(1), cantidad: 1, color: 'Negro', talla: 'M' }] });
        assert.equal(sinEntrega.status, 400);
        assert.equal((await pedir({ entrega: 'recojo', lineas: [] })).status, 400);
        const sinStock = await pedir({ entrega: 'recojo', lineas: [{ id: ID(1), cantidad: 5, color: 'Negro', talla: 'M' }] });
        assert.equal(sinStock.status, 409);
        assert.match((await sinStock.json()).mensaje, /Solo quedan 3 unidades[\s\S]*Revisa tu bolsa/);
        assert.equal((await pedir({ entrega: 'recojo', lineas: [{ id: 'no-existe', cantidad: 1 }] })).status, 409);
    });

    test('la hoja trae los pendientes (con token) y los marca; no se vuelven a traer', async () => {
        assert.equal((await post('/api/pedidos/pendientes', {})).status, 401);
        const { pedidos } = await (await post('/api/pedidos/pendientes', {}, TOKEN)).json();
        assert.deepEqual(pedidos.map(p => p.codigo), ['AER-0001', 'AER-0002']);
        assert.equal(pedidos[0].entregaTexto, 'Envío en Lima (gratis)');
        assert.equal(pedidos[1].entregaTexto, 'Recojo en tienda');

        const marcar = await (await post('/api/pedidos/importados', { codigos: ['AER-0001', 'AER-0002', 'inventado'] }, TOKEN)).json();
        assert.equal(marcar.marcados, 2);
        assert.deepEqual((await (await post('/api/pedidos/pendientes', {}, TOKEN)).json()).pedidos, []);
    });

    test('límite de intentos: más de 10 pedidos por minuto desde la misma conexión → 429', async () => {
        let ultimo;
        for (let i = 0; i < 12; i++) ultimo = await pedir({ entrega: 'recojo', lineas: [] });
        assert.equal(ultimo.status, 429);
    });
});
