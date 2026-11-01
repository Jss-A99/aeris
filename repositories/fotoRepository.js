/**
 * repositories/fotoRepository.js — AERIS E-commerce
 *
 * Único archivo que lee y escribe las fotos en MongoDB.
 *   versiones()                 → { nombre: version } (sin los datos: es liviano)
 *   guardar(fotos)              → inserta o reemplaza [{ nombre, tipo, version, datos: Buffer }]
 *   leer(nombre)                → { tipo, version, datos: Buffer } | null
 *   eliminarAusentes(nombres)   → borra las que NO estén en la lista; devuelve cuántas
 *
 * crearFotoRepositoryMemoria(): misma interfaz en memoria (pruebas y app sin Mongo).
 */

const aBuffer = (d) => (Buffer.isBuffer(d) ? d : Buffer.from(d && d.buffer ? d.buffer : d));

/** @param {{ Foto: Object }} modelos  Inyectable para pruebas. */
function crearFotoRepository({ Foto }) {
    return {
        async versiones() {
            const docs = await Foto.find({}, { version: 1 }).lean();
            return Object.fromEntries(docs.map(d => [d._id, d.version]));
        },

        async guardar(fotos) {
            if (!fotos.length) return;
            await Foto.bulkWrite(fotos.map(f => ({
                replaceOne: {
                    filter: { _id: f.nombre },
                    replacement: { _id: f.nombre, tipo: f.tipo, version: f.version, bytes: f.datos.length, datos: f.datos },
                    upsert: true
                }
            })), { ordered: false });
        },

        async leer(nombre) {
            const doc = await Foto.findById(nombre).lean();
            return doc ? { tipo: doc.tipo, version: doc.version, datos: aBuffer(doc.datos) } : null;
        },

        async eliminarAusentes(nombres) {
            const r = await Foto.deleteMany({ _id: { $nin: nombres } });
            return r.deletedCount || 0;
        }
    };
}

function crearFotoRepositoryMemoria(inicial = []) {
    const fotos = new Map(inicial.map(f => [f.nombre, { ...f }]));
    return {
        fotos,
        async versiones() { return Object.fromEntries([...fotos].map(([n, f]) => [n, f.version])); },
        async guardar(lista) { lista.forEach(f => fotos.set(f.nombre, { ...f })); },
        async leer(nombre) { const f = fotos.get(nombre); return f ? { tipo: f.tipo, version: f.version, datos: f.datos } : null; },
        async eliminarAusentes(nombres) {
            const quedan = new Set(nombres);
            let n = 0;
            [...fotos.keys()].forEach(k => { if (!quedan.has(k)) { fotos.delete(k); n++; } });
            return n;
        }
    };
}

// Instancia por defecto (la que usa server.js).
const fotoRepository = crearFotoRepository({ Foto: require('../models/foto') });
fotoRepository.crearFotoRepository = crearFotoRepository;
fotoRepository.crearFotoRepositoryMemoria = crearFotoRepositoryMemoria;

module.exports = fotoRepository;
