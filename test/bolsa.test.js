const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { evaluarPromo, normalizarCodigo } = require('../utils/promo');
const { construirCatalogo } = require('../services/syncService');
const P = require('../public/js/core/pedido');
const F = require('./fixtures/realCatalog');
const { crearApp } = require('../server');

/* ======================================================================== */

describe('códigos promocionales: reglas', () => {
    const PROMOS = [
        { codigo: 'AERIS10', tipo: 'porcentaje', valor: 10, minimo: 0, vence: null, activo: true },
        { codigo: 'MENOS20', tipo: 'monto', valor: 20, minimo: 100, vence: '2026-12-31', activo: true },
        { codigo: 'APAGADO', tipo: 'monto', valor: 5, minimo: 0, vence: null, activo: false }
    ];
    const AHORA = Date.parse('2026-11-15T12:00:00-05:00');

    test('se escribe como sea: espacios y minúsculas no importan', () => {
        assert.equal(normalizarCodigo(' aeris 10 '), 'AERIS10');
        const r = evaluarPromo(PROMOS, 'aeris10', 200, AHORA);
        assert.deepEqual(r, { ok: true, codigo: 'AERIS10', descuento: 20, etiqueta: '-10%' });
    });

    test('porcentaje redondea a céntimos; monto nunca supera el subtotal', () => {
        assert.equal(evaluarPromo(PROMOS, 'AERIS10', 79.9, AHORA).descuento, 7.99);
        assert.equal(evaluarPromo(PROMOS, 'MENOS20', 150, AHORA).descuento, 20);
    });

    test('compra mínima, inexistente, desactivado y vencido (el día de vencimiento todavía vale)', () => {
        assert.match(evaluarPromo(PROMOS, 'MENOS20', 99, AHORA).mensaje, /desde S\/ 100.00/);
        assert.equal(evaluarPromo(PROMOS, 'NOEXISTE', 99, AHORA).ok, false);
        assert.equal(evaluarPromo(PROMOS, 'APAGADO', 99, AHORA).ok, false);
        assert.equal(evaluarPromo(PROMOS, 'MENOS20', 150, Date.parse('2026-12-31T23:00:00-05:00')).ok, true);
        assert.match(evaluarPromo(PROMOS, 'MENOS20', 150, Date.parse('2027-01-01T00:00:01-05:00')).mensaje, /venció/);
        assert.equal(evaluarPromo(PROMOS, '', 150, AHORA).ok, false);
        assert.equal(evaluarPromo(PROMOS, 'AERIS10', 0, AHORA).ok, false);
    });
});

describe('pestaña PROMOCIONES en el sync', () => {
    const cuerpo = (promociones) => structuredClone({
        productos: F.hojaProductos, variantes: F.hojaVariantes, categorias: F.hojaCategorias,
        familiasColor: F.hojaFamilias, tallas: F.hojaTallas, promociones
    });

    test('es opcional: sin pestaña no hay códigos y no hay errores', () => {
        const r = construirCatalogo(cuerpo(undefined));
        assert.deepEqual(r.errores, []);
        assert.deepEqual(r.meta.promociones, []);
    });

    test('lee las filas: tipo, valor, mínimo, fecha (de Apps Script o escrita) y casilla Activo', () => {
        const r = construirCatalogo(cuerpo([
            { 'Código': 'aeris 10', 'Tipo': 'Porcentaje', 'Valor': 10, 'Compra mínima': '', 'Vence': '', 'Activo': true, _fila: 2 },
            { 'Código': 'MENOS20', 'Tipo': 'Monto', 'Valor': '20', 'Compra mínima': 100, 'Vence': '2026-12-31T00:00:00.000Z', 'Activo': true, _fila: 3 },   // así la envía el Apps Script
            { 'Código': 'NAVIDAD', 'Tipo': 'monto', 'Valor': 15, 'Compra mínima': 0, 'Vence': '24/12/2026', 'Activo': false, _fila: 4 },
            { 'Código': '', 'Tipo': '', 'Valor': '', 'Compra mínima': '', 'Vence': '', 'Activo': false, _fila: 5 }
        ]));
        assert.deepEqual(r.errores, []);
        assert.deepEqual(r.meta.promociones, [
            { codigo: 'AERIS10', tipo: 'porcentaje', valor: 10, minimo: 0, vence: null, activo: true },
            { codigo: 'MENOS20', tipo: 'monto', valor: 20, minimo: 100, vence: '2026-12-31', activo: true },
            { codigo: 'NAVIDAD', tipo: 'monto', valor: 15, minimo: 0, vence: '2026-12-24', activo: false }
        ]);
    });

    test('errores claros: repetido, tipo inválido, porcentaje > 100, fecha ilegible', () => {
        const { errores } = construirCatalogo(cuerpo([
            { 'Código': 'A', 'Tipo': 'Porcentaje', 'Valor': 10, _fila: 2 },
            { 'Código': 'a', 'Tipo': 'Porcentaje', 'Valor': 10, _fila: 3 },
            { 'Código': 'B', 'Tipo': 'Regalo', 'Valor': 10, _fila: 4 },
            { 'Código': 'C', 'Tipo': 'Porcentaje', 'Valor': 150, _fila: 5 },
            { 'Código': 'D', 'Tipo': 'Monto', 'Valor': 10, 'Vence': 'pronto', _fila: 6 }
        ]));
        assert.equal(errores.length, 4);
        assert.ok(errores.some(e => e.includes('fila 3') && e.includes('repetido')));
        assert.ok(errores.some(e => e.includes('"Regalo"')));
        assert.ok(errores.some(e => e.includes('como máximo 100')));
        assert.ok(errores.some(e => e.includes('"pronto"')));
    });
});

describe('mensaje de WhatsApp', () => {
    const lineas = [
        { titulo: 'Blusa seda', precio: 79.9, cantidad: 2, color: 'Negro', talla: 'M', componentes: [] },
        { titulo: 'Set Noir', precio: 200, cantidad: 1, color: null, talla: null,
          componentes: [{ nombre: 'Blazer', color: 'Negro', talla: 'S' }, { nombre: 'Pantalón', color: 'Negro', talla: 'M' }] }
    ];

    test('totales con descuento (nunca negativo)', () => {
        assert.deepEqual(P.totales(lineas, 35.98), { subtotal: 359.8, descuento: 35.98, total: 323.82 });
        assert.equal(P.totales(lineas, 9999).total, 0);
    });

    test('formato "Ficha": coma vocativa, código, un espacio entre artículos, piezas y total', () => {
        const m = P.armarMensaje({ codigo: 'AER-0042', lineas, entrega: 'recojo', promo: { codigo: 'AERIS10', descuento: 35.98 } });
        assert.equal(m, [
            'Hola, AERIS. Me gustaría hacer este pedido:',
            '',
            '*PEDIDO AER-0042*',
            '────────────',
            '',
            '*Blusa seda*',
            'Negro · Talla M',
            'Cantidad: 2 · S/ 159.80',
            '',
            '*Set Noir*',
            'Blazer — Negro · Talla S',
            'Pantalón — Negro · Talla M',
            'Cantidad: 1 · S/ 200.00',
            '',
            '────────────',
            'Subtotal: S/ 359.80',
            'Descuento (AERIS10): −S/ 35.98',
            'Entrega: Recojo en tienda',
            '*Total: S/ 323.82*'
        ].join('\n'));
    });

    test('sin código (la tienda no respondió) dice solo PEDIDO; prenda sin color ni talla no deja línea vacía', () => {
        const m = P.armarMensaje({ lineas: [{ titulo: 'Bolso', precio: 50, cantidad: 1, color: null, talla: null, componentes: [] }], entrega: 'recojo' });
        assert.match(m, /\*PEDIDO\*\n/);
        assert.match(m, /\*Bolso\*\nCantidad: 1 · S\/ 50\.00/);
    });

    test('envío en Lima o a provincia: el total avisa que falta el envío; Lima gratis no', () => {
        const lima = P.armarMensaje({ lineas: lineas.slice(0, 1), entrega: 'lima', promo: null });
        assert.match(lima, /Entrega: Envío en Lima, costo por coordinar/);
        assert.match(lima, /\*Total: S\/ 159.80 \+ envío\*$/);
        assert.doesNotMatch(lima, /Descuento/);
        assert.match(P.armarMensaje({ lineas, entrega: 'provincia' }), /Envío a provincia, costo por coordinar[\s\S]*\+ envío\*$/);
        const gratis = P.armarMensaje({ lineas, entrega: 'lima', envioGratis: true });
        assert.match(gratis, /Entrega: Envío en Lima, gratis\n\*Total: S\/ 359.80\*$/);
    });

    test('envío gratis: se avisa solo cuando faltan S/ 30 o menos (después del descuento)', () => {
        const regla = { gratisDesde: 199, avisarDesdeFaltan: 30 };
        assert.deepEqual(P.envioGratis(150, regla), { gratis: false, falta: 49, avisar: false, avance: 150 / 199 });
        assert.equal(P.envioGratis(169, regla).avisar, true);
        assert.equal(P.envioGratis(169, regla).falta, 30);
        assert.deepEqual(P.envioGratis(199, regla), { gratis: true, falta: 0, avisar: true, avance: 1 });
        // S/ 210 con 10% de descuento = 189: no es gratis, faltan 10
        const total = P.totales([{ precio: 210, cantidad: 1 }], 21).total;
        assert.deepEqual([P.envioGratis(total, regla).gratis, P.envioGratis(total, regla).falta], [false, 10]);
        assert.equal(P.envioGratis(0, regla).avisar, false);
    });

    test('enlace: solo dígitos y texto codificado; sin número válido → null', () => {
        assert.equal(P.enlaceWhatsApp('+51 987 654 321', 'Hola & chau'), 'https://wa.me/51987654321?text=Hola%20%26%20chau');
        assert.equal(P.enlaceWhatsApp(null, 'x'), null);
    });
});

/* ======================================================================== */

describe('API y página de la bolsa', () => {
    const ID = (n) => String(n).padStart(24, '0');
    const repo = {
        async listarTodos() {
            return [{ _id: ID(1), idExcel: 1, nombre: 'Blusa', descripcion: '-', precio: 80, categoria: 'blusas',
                imagenPrincipal: 'b.jpg', createdAt: new Date(), variantes: [{ color: 'Negro', hex: '#000000', familia: 'negro', talla: 'M', stock: 2, imagen: 'b.jpg' }] }];
        },
        async leerMeta() {
            return { categorias: [], familiasColor: [], tallas: [],
                promociones: [{ codigo: 'AERIS10', tipo: 'porcentaje', valor: 10, minimo: 0, vence: null, activo: true }] };
        }
    };
    let servidor, base;
    before(async () => {
        const app = crearApp({ repositorio: repo, ttlCatalogoMs: 60000 });
        await new Promise(r => { servidor = app.listen(0, r); });
        base = `http://127.0.0.1:${servidor.address().port}`;
    });
    after(async () => { await new Promise(r => servidor.close(r)); });

    test('/api/bolsa/productos devuelve los DTO actuales (y nada para ids que no existen)', async () => {
        const res = await fetch(`${base}/api/bolsa/productos?ids=${ID(1)},no-existe`);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        const { productos } = await res.json();
        assert.deepEqual(Object.keys(productos), [ID(1)]);
        assert.equal(productos[ID(1)].variantes[0].stock, 2);
    });

    test('/api/promo valida en el servidor; la lista de códigos nunca se expone', async () => {
        const ok = await (await fetch(`${base}/api/promo?codigo=aeris10&subtotal=80`)).json();
        assert.deepEqual(ok, { ok: true, codigo: 'AERIS10', descuento: 8, etiqueta: '-10%' });
        const no = await (await fetch(`${base}/api/promo?codigo=OTRO&subtotal=80`)).json();
        assert.equal(no.ok, false);
        const html = await (await fetch(`${base}/catalogo`)).text();
        assert.ok(!html.includes('AERIS10'));
    });

    test('la página "Tu bolsa" trae título, entrega, código y Enviar pedido', async () => {
        const res = await fetch(`${base}/carrito`);
        assert.equal(res.status, 200);
        const h = await res.text();
        assert.match(h, /<title>Tu bolsa — AERIS<\/title>/);
        assert.match(h, /<span data-ajustar>TU BOLSA<\/span>/);
        assert.match(h, /Recojo en tienda/);
        assert.match(h, /Envío en Lima/);
        assert.match(h, /Envío a provincia/);
        assert.match(h, /Gratis desde S\/ 199/);
        assert.ok(h.indexOf('id="formPromo"') < h.indexOf('id="grupoEntrega"'), 'el código va antes de la entrega');
        assert.match(h, /"gratisDesde":199,"avisarDesdeFaltan":30/);
        assert.match(h, /id="codigo"/);
        assert.match(h, /id="finalizar">[\s\S]*?<\/svg>\s*Enviar pedido<\/button>/);   // con el logo de WhatsApp
        assert.doesNotMatch(h, /Finalizar orden/);
        assert.match(h, /Volver al catálogo/);
        assert.match(h, /<script src="\/js\/ui\/bolsa.js"><\/script>/);
    });
});
