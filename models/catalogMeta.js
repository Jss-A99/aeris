/**
 * Modelo de las TABLAS DE APOYO del catálogo — AERIS E-commerce
 *
 * Las pestañas CATEGORÍAS, FAMILIAS COLOR, TALLAS, PROMOCIONES y BANNERS de la hoja viajan juntas en UN solo
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
    }, { _id: false })],
    promociones: [new mongoose.Schema({
        codigo: { type: String, required: true },      // MAYÚSCULAS sin espacios: "AERIS10"
        tipo: { type: String, enum: ['porcentaje', 'monto'], required: true },
        valor: { type: Number, required: true },       // 10 (%) o 20 (S/)
        minimo: { type: Number, default: 0 },          // compra mínima en S/
        vence: { type: String, default: null },        // "2026-12-31" (día en Lima) o null
        activo: { type: Boolean, default: true }
    }, { _id: false })],
    // Pestaña BANNERS: solo los activos, ya ordenados
    banners: [new mongoose.Schema({
        orden: { type: Number, required: true },
        imagen: { type: String, required: true },      // "/images/productos/banner-primavera"
        titulo: { type: String, default: '' },
        enlace: { type: String, default: null },       // "/conjunto/12-…" o "https://…" (externo)
        externo: { type: Boolean, default: false },
        textoEnlace: { type: String, default: '' }
    }, { _id: false })]
}, { timestamps: true });

module.exports = mongoose.model('CatalogMeta', catalogMetaSchema, 'catalogo_meta');
