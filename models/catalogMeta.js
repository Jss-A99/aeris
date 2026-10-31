/**
 * Modelo de las TABLAS DE APOYO del catálogo — AERIS E-commerce
 *
 * Las pestañas CATEGORÍAS, FAMILIAS COLOR y TALLAS de la hoja viajan juntas en UN solo
 * documento (_id: 'tablas'). Son pocas filas, se leen siempre juntas y así se reemplazan
 * de forma atómica en cada sync.
 */
const mongoose = require('mongoose');

const catalogMetaSchema = new mongoose.Schema({
    _id: { type: String },
    categorias: [new mongoose.Schema({
        id: { type: String, required: true },          // minúsculas: "vestidos"
        nombre: { type: String, required: true },      // "Vestidos"
        orden: { type: Number, required: true },
        contienePiezas: { type: Boolean, default: false }
    }, { _id: false })],
    familiasColor: [new mongoose.Schema({
        id: { type: String, required: true },          // minúsculas: "verde"
        nombre: { type: String, required: true },      // "Verde"
        hex: { type: String, required: true }          // "#4a5240"
    }, { _id: false })],
    tallas: [new mongoose.Schema({
        talla: { type: String, required: true },       // MAYÚSCULAS: "XL", "32"
        orden: { type: Number, required: true }
    }, { _id: false })]
}, { timestamps: true });

module.exports = mongoose.model('CatalogMeta', catalogMetaSchema, 'catalogo_meta');
