/**
 * services/fotoService.js — AERIS E-commerce
 *
 * Fotos de productos sincronizadas desde Google Drive:
 *  - valida lo que manda el Apps Script (nombre, formato real del archivo, tamaño);
 *  - guarda solo lo nuevo o cambiado (el Apps Script pregunta antes qué versión hay);
 *  - borra las que ya no están en la carpeta (espejo, como el catálogo);
 *  - sirve cada foto con una caché en memoria para no ir a Mongo en cada visita.
 */
const { ErrorSync } = require('./syncService');

/** Mismas reglas que la web: minúsculas, números, puntos, guiones; sin espacios ni tildes. */
const NOMBRE_VALIDO = /^[a-z0-9][a-z0-9._-]*\.(jpe?g|png|webp|avif)$/;
const TIPOS = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };
const MAX_BYTES = 5 * 1024 * 1024;   // 5 MB por foto


/** Revisa los primeros bytes: que el archivo sea de verdad la imagen que dice ser. */
function formatoReal(datos) {
    if (datos[0] === 0xff && datos[1] === 0xd8) return ['jpg', 'jpeg'];
    if (datos.toString('ascii', 1, 4) === 'PNG') return ['png'];
    if (datos.toString('ascii', 0, 4) === 'RIFF' && datos.toString('ascii', 8, 12) === 'WEBP') return ['webp'];
    if (datos.toString('ascii', 4, 12).startsWith('ftypavi')) return ['avif'];
    return [];
}

/**
 * Lista enviada por el Apps Script → fotos listas para guardar, o errores claros.
 * @param {Array<{ nombre: string, version: string, datos: string }>} lista  datos en base64
 */
function prepararFotos(lista) {
    const fotos = [];
    const errores = [];
    (Array.isArray(lista) ? lista : []).forEach((f, i) => {
        const nombre = String((f && f.nombre) || '');
        const donde = nombre || `foto ${i + 1}`;
        if (!NOMBRE_VALIDO.test(nombre)) { errores.push(`"${donde}": el nombre debe ir en minúsculas, sin espacios ni tildes (ej. blusa-seda-negra.jpg).`); return; }
        if (!f.version || typeof f.version !== 'string') { errores.push(`"${nombre}": falta la versión.`); return; }
        const datos = Buffer.from(String(f.datos || ''), 'base64');
        if (!datos.length) { errores.push(`"${nombre}": el archivo llegó vacío.`); return; }
        if (datos.length > MAX_BYTES) { errores.push(`"${nombre}": pesa ${Math.round(datos.length / 1024)} KB; el máximo es ${MAX_BYTES / 1024 / 1024} MB.`); return; }
        // Manda el contenido, no el nombre: un WEBP guardado como ".jpg" se acepta y se sirve como WEBP.
        const real = formatoReal(datos);
        if (!real.length) { errores.push(`"${nombre}": el archivo no es una imagen (JPG, PNG, WEBP o AVIF).`); return; }
        fotos.push({ nombre, tipo: TIPOS[real[0]], version: f.version, datos });
    });
    return { fotos, errores };
}

/**
 * @param {Object} deps
 * @param {Object} deps.repositorio      ver repositories/fotoRepository.js
 * @param {number} [deps.maxCacheBytes]  memoria máxima para la caché de fotos (por defecto 40 MB)
 */
function crearFotoService({ repositorio, maxCacheBytes = 40 * 1024 * 1024 }) {
    const cache = new Map();   // nombre → { tipo, version, datos }; el orden es de uso (la más vieja primero)
    let enCache = 0;

    function guardarEnCache(nombre, foto) {
        if (foto.datos.length > maxCacheBytes) return;
        cache.set(nombre, foto);
        enCache += foto.datos.length;
        for (const [n, f] of cache) {
            if (enCache <= maxCacheBytes) break;
            cache.delete(n);
            enCache -= f.datos.length;
        }
    }
    function olvidar(nombre) {
        const f = cache.get(nombre);
        if (f) { cache.delete(nombre); enCache -= f.datos.length; }
    }

    return {
        NOMBRE_VALIDO,

        /** { nombre: version } de lo que ya está guardado. */
        versiones: () => repositorio.versiones(),

        async nombres() {
            return Object.keys(await repositorio.versiones());
        },

        /** Guarda un lote. Si una sola foto no es válida, no se guarda ninguna del lote. */
        async guardar(lista) {
            const { fotos, errores } = prepararFotos(lista);
            if (errores.length) {
                throw new ErrorSync(400, `Hay ${errores.length} foto(s) con problemas. No se subió este lote.`, { errores });
            }
            await repositorio.guardar(fotos);
            fotos.forEach(f => olvidar(f.nombre));
            return fotos.length;
        },

        /** Espejo de la carpeta: borra lo que ya no está. Nunca con una lista vacía. */
        async limpiar(nombres) {
            const validos = (Array.isArray(nombres) ? nombres : []).map(String).filter(n => NOMBRE_VALIDO.test(n));
            if (!validos.length) throw new ErrorSync(400, 'La carpeta de fotos llegó vacía: no se borró nada.');
            const eliminadas = await repositorio.eliminarAusentes(validos);
            cache.clear();
            enCache = 0;
            return eliminadas;
        },

        /** Foto para mostrar en la web, o null si no existe. */
        async leer(nombre) {
            if (!NOMBRE_VALIDO.test(nombre)) return null;
            const enMemoria = cache.get(nombre);
            if (enMemoria) {
                cache.delete(nombre);           // pasa al final: recién usada
                cache.set(nombre, enMemoria);
                return enMemoria;
            }
            const foto = await repositorio.leer(nombre);
            if (foto) guardarEnCache(nombre, foto);
            return foto;
        }
    };
}

module.exports = { crearFotoService, prepararFotos, NOMBRE_VALIDO, MAX_BYTES };
