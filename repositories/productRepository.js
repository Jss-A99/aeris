/**
 * repositories/productRepository.js — AERIS E-commerce
 *
 * ÚNICO archivo (junto con models/) que habla con MongoDB. El resto del servidor depende
 * de esta interfaz, de modo que los servicios se prueban con un repositorio falso.
 *
 * Interfaz:
 *   listarTodos()                → productos crudos (.lean())
 *   leerMeta()                   → { categorias, familiasColor, tallas, promociones } (vacío si aún no hubo sync)
 *   upsertMuchos(documentos)     → inserta/actualiza por idExcel (y limpia campos heredados)
 *   guardarMeta(meta)            → reemplaza las tablas de apoyo
 *   eliminarAusentes(idExcels)   → borra todo lo que NO esté en la lista; devuelve cuántos
 */
const META_ID = 'tablas';
const META_VACIA = Object.freeze({ categorias: [], familiasColor: [], tallas: [], promociones: [] });

/** Campos del diseño anterior que el sync nuevo ya no escribe. */
const CAMPOS_HEREDADOS = Object.freeze({ familiaColor: '', etiquetas: '', productosIncluidos: '' });

/**
 * @param {{ Producto: Object, Meta: Object }} modelos  Inyectables para pruebas.
 */
function crearProductRepository({ Producto, Meta }) {
    return {
        listarTodos() {
            return Producto.find({}).lean();
        },

        async leerMeta() {
            const doc = await Meta.findById(META_ID).lean();
            if (!doc) return { ...META_VACIA };
            return {
                categorias: doc.categorias || [],
                familiasColor: doc.familiasColor || [],
                tallas: doc.tallas || [],
                promociones: doc.promociones || []
            };
        },

        async upsertMuchos(documentos) {
            if (documentos.length === 0) return;
            await Producto.bulkWrite(
                documentos.map(doc => ({
                    updateOne: {
                        filter: { idExcel: doc.idExcel },
                        update: { $set: doc, $unset: CAMPOS_HEREDADOS },
                        upsert: true
                    }
                })),
                { ordered: false }
            );
        },

        async guardarMeta(meta) {
            await Meta.replaceOne(
                { _id: META_ID },
                {
                    categorias: meta.categorias,
                    familiasColor: meta.familiasColor,
                    tallas: meta.tallas,
                    promociones: meta.promociones || []
                },
                { upsert: true }
            );
        },

        async eliminarAusentes(idExcels) {
            const resultado = await Producto.deleteMany({ idExcel: { $nin: idExcels } });
            return resultado.deletedCount || 0;
        }
    };
}

// Instancia por defecto (la que usa server.js).
const productRepository = crearProductRepository({
    Producto: require('../models/product'),
    Meta: require('../models/catalogMeta')
});
productRepository.crearProductRepository = crearProductRepository;

module.exports = productRepository;
