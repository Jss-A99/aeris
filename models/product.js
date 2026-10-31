/**
 * Modelo de Datos para Productos — AERIS E-commerce
 * Colección 'products' en MongoDB Atlas.
 *
 * Mongo guarda SOLO los productos marcados "Publicado" en la hoja (ver syncService):
 * despublicar en la hoja = borrar de Mongo en el siguiente envío.
 */
const mongoose = require('mongoose');

/** Variante individual: una combinación color + talla con su stock y foto. */
const variantSchema = new mongoose.Schema({
    color: { type: String, required: true },
    hex: { type: String, required: true },
    /** Familia de color (nombre tal como está en la pestaña FAMILIAS COLOR). Alimenta los filtros. */
    familia: { type: String, required: true },
    talla: { type: String, required: true },
    stock: { type: Number, default: 0, min: 0 },
    /** Vacío = usar la imagen del producto (lo resuelve el mapper). */
    imagen: { type: String, default: '' }
}, { _id: false });

const productSchema = new mongoose.Schema({
    idExcel: { type: Number, required: true, unique: true, index: true },
    nombre: { type: String, required: true },
    descripcion: { type: String, default: '' },
    precio: { type: Number, required: true },
    precioAnterior: { type: Number, default: null },
    categoria: { type: String, required: true },
    /** Casilla "Nuevo" de la hoja. */
    nuevo: { type: Boolean, default: false },
    /** El sync solo escribe documentos publicados; el campo existe para que el mapper sea explícito. */
    publicado: { type: Boolean, default: true },
    imagenPrincipal: { type: String, default: '' },
    imagenesSecundarias: [{ type: String }],
    /** Lo define CATEGORÍAS → "Contiene piezas". */
    esConjunto: { type: Boolean, default: false },
    /** Ids de la hoja de las piezas de un conjunto, en orden (ej: [1, 2]). */
    productosIncluidosIds: [{ type: Number }],
    variantes: [variantSchema],

    /* Campos HEREDADOS del diseño anterior. Ya no se escriben: el sync los elimina ($unset)
       de los documentos antiguos. Siguen declarados para que Mongoose permita ese $unset. */
    familiaColor: [{ type: String }],
    etiquetas: [{ type: String }],
    productosIncluidos: [{ type: mongoose.Schema.Types.ObjectId }]
}, { timestamps: true });

/** Stock total de una prenda (null para conjuntos: depende de sus piezas). */
productSchema.virtual('stockTotal').get(function () {
    if (this.esConjunto) return null;
    if (!this.variantes || this.variantes.length === 0) return 0;
    return this.variantes.reduce((acc, variante) => acc + (variante.stock || 0), 0);
});

productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Product', productSchema, 'products');
