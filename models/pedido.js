/**
 * Modelo de PEDIDOS — AERIS E-commerce
 *
 * Se crea un pedido cuando la clienta toca "Finalizar orden" (antes de abrir WhatsApp).
 * NO descuenta stock: el stock se descuenta en la hoja cuando se confirma el pago
 * (pestaña PEDIDOS → casilla Pagado → menú "Descontar stock de pedidos pagados").
 * `filas` ya viene en el formato de la pestaña PEDIDOS: una fila por prenda (un conjunto,
 * una fila por pieza), porque el stock es por pieza.
 */
const mongoose = require('mongoose');

const filaSchema = new mongoose.Schema({
    productoId: { type: Number, default: null },   // Producto_ID de la hoja (en conjuntos, el de la pieza)
    producto: { type: String, required: true },
    conjunto: { type: String, default: '' },
    color: { type: String, default: '' },
    talla: { type: String, default: '' },
    cantidad: { type: Number, required: true },
    importe: { type: Number, default: null }       // lo cobrado por esta fila (conjunto repartido, con su parte del descuento)
}, { _id: false });

const pedidoSchema = new mongoose.Schema({
    codigo: { type: String, required: true, unique: true },   // "AER-0042"
    fecha: { type: Date, required: true },
    entrega: { type: String, enum: ['recojo', 'lima', 'provincia'], required: true },
    envioGratis: { type: Boolean, default: false },
    codigoPromo: { type: String, default: '' },
    subtotal: { type: Number, required: true },
    descuento: { type: Number, default: 0 },
    total: { type: Number, required: true },
    filas: [filaSchema],
    importado: { type: Boolean, default: false, index: true }  // ya se llevó a la hoja
}, { timestamps: true });

const contadorSchema = new mongoose.Schema({ _id: String, valor: Number });

module.exports = {
    Pedido: mongoose.model('Pedido', pedidoSchema, 'pedidos'),
    Contador: mongoose.model('Contador', contadorSchema, 'contadores')
};
