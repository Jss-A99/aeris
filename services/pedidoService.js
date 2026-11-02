/**
 * services/pedidoService.js — AERIS E-commerce
 *
 * "Finalizar orden" → registrar(): el servidor NO confía en el navegador. Con el catálogo
 * actual vuelve a validar cada línea (que exista, la combinación y el stock, con las mismas
 * reglas de la bolsa), toma los precios actuales, aplica el código promocional y el envío
 * gratis, y guarda el pedido con su código (AER-0042). No descuenta stock.
 *
 * La hoja trae los pedidos con pendientes() y los marca con marcarImportados().
 *
 * IMPORTE de cada fila = lo que realmente se cobró por ella, para que en la hoja el total de
 * ventas sea simplemente la suma de la columna:
 *  - un conjunto reparte su precio entre sus piezas, según el precio de cada pieza suelta;
 *  - el descuento del código promocional se reparte entre todas las filas del pedido.
 * Se reparte en céntimos: la suma de las filas da EXACTO el total del pedido.
 */
const C = require('../public/js/core/contracts');
const P = require('../public/js/core/pedido');
const { evaluarPromo } = require('../utils/promo');

const ENTREGAS = Object.freeze(['recojo', 'lima', 'provincia']);
const MAX_LINEAS = 30;
const MAX_CANTIDAD = 20;
const redondear = (n) => Math.round(n * 100) / 100;

/** Reparte `total` en partes proporcionales a `pesos`, en céntimos, sin perder ni sobrar uno. */
function repartir(total, pesos) {
    const centimos = Math.round(total * 100);
    const suma = pesos.reduce((s, p) => s + Math.max(0, p), 0);
    const base = suma > 0 ? pesos.map(p => Math.max(0, p) / suma) : pesos.map(() => 1 / pesos.length);
    const partes = base.map(b => Math.floor(centimos * b));
    let resto = centimos - partes.reduce((s, p) => s + p, 0);
    for (let i = 0; resto > 0; i = (i + 1) % partes.length, resto--) partes[i] += 1;
    return partes.map(c => c / 100);
}

class ErrorPedido extends Error {
    constructor(status, mensaje) {
        super(mensaje);
        this.name = 'ErrorPedido';
        this.status = status;
    }
}

/** Texto de la entrega para la hoja. */
function textoEntrega(p) {
    if (p.entrega === 'recojo') return 'Recojo en tienda';
    if (p.entrega === 'lima') return p.envioGratis ? 'Envío en Lima (gratis)' : 'Envío en Lima';
    return 'Envío a provincia';
}

/**
 * @param {Object} deps
 * @param {Object} deps.repositorio   repositories/pedidoRepository.js
 * @param {Object} deps.catalogo      catalogService (porIdOSku, promociones)
 * @param {{ gratisDesde:number, avisarDesdeFaltan:number }} deps.envio  config/tienda.js → envio
 * @param {() => Date} [deps.ahora]
 */
function crearPedidoService({ repositorio, catalogo, envio, ahora = () => new Date() }) {
    async function registrar(cuerpo) {
        const b = cuerpo || {};
        if (!ENTREGAS.includes(b.entrega)) throw new ErrorPedido(400, 'Elige cómo quieres recibir tu pedido.');
        const entrantes = Array.isArray(b.lineas) ? b.lineas : [];
        if (!entrantes.length) throw new ErrorPedido(400, 'Tu bolsa está vacía.');
        if (entrantes.length > MAX_LINEAS) throw new ErrorPedido(400, 'Tu pedido tiene demasiadas líneas. Escríbenos por WhatsApp y te ayudamos.');

        const lineas = [];   // para el mensaje de WhatsApp
        const filas = [];    // para la pestaña PEDIDOS
        for (const l of entrantes) {
            const cantidad = Math.floor(Number(l && l.cantidad));
            if (!(cantidad >= 1 && cantidad <= MAX_CANTIDAD)) throw new ErrorPedido(400, 'Hay una cantidad no válida en tu bolsa.');

            const id = String((l && l.id) || '');
            const dto = await catalogo.porIdOSku(id);
            if (!dto || dto.id !== id) throw new ErrorPedido(409, 'Un artículo de tu bolsa ya no está disponible. Revisa tu bolsa.');

            const seleccion = dto.tipo === 'conjunto'
                ? { componentes: (Array.isArray(l.componentes) ? l.componentes : []).map(c => ({ id: String((c && c.id) || ''), color: c && c.color, talla: c && c.talla })) }
                : { color: l.color, talla: l.talla };
            let item;
            try {
                item = C.buildCartItem(dto, seleccion, cantidad);   // mismas reglas de stock que la bolsa
            } catch (e) {
                throw new ErrorPedido(409, `${e.message} Revisa tu bolsa.`);
            }

            lineas.push({
                titulo: item.titulo, precio: item.precio, cantidad,
                color: item.color, talla: item.talla,
                componentes: item.componentes.map(c => ({ nombre: c.nombre, color: c.color, talla: c.talla }))
            });

            const importe = redondear(item.precio * cantidad);
            if (dto.tipo === 'conjunto') {
                const piezas = [];
                for (const c of item.componentes) piezas.push(await catalogo.porIdOSku(c.id));
                // El precio del conjunto se reparte según lo que cuesta cada pieza suelta
                const partes = repartir(importe, piezas.map(p => (p ? p.precio : 0)));
                item.componentes.forEach((c, i) => {
                    filas.push({ productoId: piezas[i] ? piezas[i].sku : null, producto: c.nombre, conjunto: item.titulo,
                        color: c.color || '', talla: c.talla || '', cantidad, importe: partes[i] });
                });
            } else {
                filas.push({ productoId: dto.sku, producto: item.titulo, conjunto: '',
                    color: item.color || '', talla: item.talla || '', cantidad, importe });
            }
        }

        const subtotal = P.totales(lineas, 0).subtotal;
        let promo = null;
        if (b.codigoPromo) {
            const r = evaluarPromo(await catalogo.promociones(), b.codigoPromo, subtotal);
            if (r.ok) promo = { codigo: r.codigo, descuento: r.descuento };
        }
        const totales = P.totales(lineas, promo ? promo.descuento : 0);
        const envioGratis = b.entrega === 'lima' && P.envioGratis(totales.total, envio).gratis;

        // Importe final de cada fila (con su parte del descuento): la suma da el total del pedido.
        if (totales.descuento > 0) {
            const finales = repartir(totales.total, filas.map(f => f.importe));
            filas.forEach((f, i) => { f.importe = finales[i]; });
        }

        const codigo = await repositorio.siguienteCodigo();
        await repositorio.crear({
            codigo, fecha: ahora(), entrega: b.entrega, envioGratis,
            codigoPromo: promo ? promo.codigo : '',
            subtotal: totales.subtotal, descuento: totales.descuento, total: totales.total,
            filas, importado: false
        });
        return { codigo, lineas, promo, envioGratis, totales };
    }

    return {
        registrar,

        /** Pedidos aún no llevados a la hoja, con el texto de entrega listo. */
        async pendientes() {
            return (await repositorio.pendientes()).map(p => ({ ...p, entregaTexto: textoEntrega(p) }));
        },

        async marcarImportados(codigos) {
            const lista = (Array.isArray(codigos) ? codigos : []).map(String).filter(c => /^AER-\d+$/.test(c));
            return lista.length ? repositorio.marcarImportados(lista) : 0;
        }
    };
}

module.exports = { crearPedidoService, ErrorPedido, textoEntrega, repartir, MAX_CANTIDAD };
