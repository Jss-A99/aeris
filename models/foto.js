/**
 * Modelo de FOTOS de productos — AERIS E-commerce
 *
 * Las fotos llegan desde la carpeta PRODUCTOS de Google Drive (botón de sincronizar en la hoja)
 * y se guardan aquí, en MongoDB: Render gratis borra sus archivos al reiniciarse, Mongo no.
 * Un documento por foto; el _id es el nombre del archivo (el mismo que se escribe en la hoja).
 */
const mongoose = require('mongoose');

const fotoSchema = new mongoose.Schema({
    _id: { type: String },                        // "blusa-seda-negra.jpg"
    tipo: { type: String, required: true },       // "image/jpeg"
    version: { type: String, required: true },    // fecha de modificación en Drive + tamaño: si cambia, se vuelve a subir
    bytes: { type: Number, required: true },
    datos: { type: Buffer, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Foto', fotoSchema, 'fotos');
