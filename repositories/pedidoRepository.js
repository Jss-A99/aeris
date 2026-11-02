/**
 * repositories/pedidoRepository.js — AERIS E-commerce
 *
 *   siguienteCodigo()            → "AER-0042" (correlativo, a prueba de pedidos simultáneos)
 *   crear(pedido)
 *   pendientes(limite)           → pedidos que aún no se llevaron a la hoja, del más antiguo al más nuevo
 *   marcarImportados(codigos)    → cuántos se marcaron
 *
 * crearPedidoRepositoryMemoria(): misma interfaz en memoria (pruebas).
 */
const codigoDe = (n) => 'AER-' + String(n).padStart(4, '0');

/** @param {{ Pedido: Object, Contador: Object }} modelos */
function crearPedidoRepository({ Pedido, Contador }) {
    return {
        async siguienteCodigo() {
            const c = await Contador.findOneAndUpdate({ _id: 'pedidos' }, { $inc: { valor: 1 } }, { upsert: true, new: true }).lean();
            return codigoDe(c.valor);
        },
        async crear(pedido) {
            await Pedido.create(pedido);
        },
        async pendientes(limite = 200) {
            return Pedido.find({ importado: false }, { _id: 0, __v: 0 }).sort({ fecha: 1 }).limit(limite).lean();
        },
        async marcarImportados(codigos) {
            const r = await Pedido.updateMany({ codigo: { $in: codigos } }, { $set: { importado: true } });
            return r.modifiedCount || 0;
        }
    };
}

function crearPedidoRepositoryMemoria() {
    let n = 0;
    const pedidos = [];
    return {
        pedidos,
        async siguienteCodigo() { n += 1; return codigoDe(n); },
        async crear(pedido) { pedidos.push(structuredClone(pedido)); },
        async pendientes(limite = 200) { return structuredClone(pedidos.filter(p => !p.importado).slice(0, limite)); },
        async marcarImportados(codigos) {
            let m = 0;
            pedidos.forEach(p => { if (codigos.includes(p.codigo) && !p.importado) { p.importado = true; m++; } });
            return m;
        }
    };
}

const modelos = require('../models/pedido');
const pedidoRepository = crearPedidoRepository(modelos);
pedidoRepository.crearPedidoRepository = crearPedidoRepository;
pedidoRepository.crearPedidoRepositoryMemoria = crearPedidoRepositoryMemoria;

module.exports = pedidoRepository;
