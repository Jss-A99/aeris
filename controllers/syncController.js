/**
 * controllers/syncController.js — AERIS E-commerce
 * Capa HTTP delgada: traduce la petición a syncService y el resultado a JSON.
 * La lógica vive en services/syncService.js.
 */
const fs = require('fs');
const { sincronizar, ErrorSync } = require('../services/syncService');
const { baseFoto } = require('../services/fotoService');

const MAX_AVISOS_FOTOS = 10;

/**
 * Fotos que la hoja menciona pero no están ni sincronizadas desde Drive ni en /public.
 * Es solo un aviso: no impide guardar.
 */
async function fotosFaltantes({ catalogo, fotos, dirFotos }) {
    if (!fotos) return [];
    // Se compara sin extensión: "blusa-seda" en la hoja = "blusa-seda.webp" en Drive.
    const disponibles = new Set((await fotos.nombres()).map(baseFoto));
    try { fs.readdirSync(dirFotos).forEach(n => disponibles.add(baseFoto(n))); } catch (e) { /* sin carpeta local */ }
    const mencionadas = new Set();
    const anotar = (ruta) => {
        const m = /^\/images\/productos\/([^/?#]+)$/.exec(ruta || '');
        if (m) mencionadas.add(decodeURIComponent(m[1]));
    };
    if (catalogo.banners) (await catalogo.banners()).forEach(b => anotar(b.imagen));
    (await catalogo.todos()).forEach(p => {
        p.galeria.forEach(anotar);
        p.colores.forEach(c => anotar(c.imagen));
        p.variantes.forEach(v => anotar(v.imagen));
    });
    const faltan = [...mencionadas].filter(n => !disponibles.has(baseFoto(n))).sort();
    const avisos = faltan.slice(0, MAX_AVISOS_FOTOS).map(n => `Falta la foto "${n}" en la carpeta PRODUCTOS de Drive (o el nombre no coincide con la hoja).`);
    if (faltan.length > MAX_AVISOS_FOTOS) avisos.push(`... y ${faltan.length - MAX_AVISOS_FOTOS} fotos más.`);
    return avisos;
}

/**
 * @param {Object} deps
 * @param {Object} deps.repositorio
 * @param {{ invalidar: () => void, todos: Function }} deps.catalogo   Para refrescar la caché tras sincronizar.
 * @param {Object} [deps.fotos]     fotoService: para avisar de fotos que faltan
 * @param {string} [deps.dirFotos]  carpeta local de fotos (public/images/productos)
 * @param {string[]} [deps.dominios] direcciones de la tienda (config/tienda.js): enlaces de banners sin dominio
 */
function crearSyncController({ repositorio, catalogo, fotos, dirFotos, dominios = [] }) {
    return {
        async sincronizarCatalogo(req, res) {
            const cuerpo = req.body || {};
            try {
                const resultado = await sincronizar(cuerpo, { repositorio, dominios: [...dominios, typeof req.get === 'function' ? req.get('host') : null] });
                catalogo.invalidar();
                try {
                    resultado.advertencias = [...resultado.advertencias, ...await fotosFaltantes({ catalogo, fotos, dirFotos })];
                } catch (e) { /* el aviso de fotos nunca hace fallar el sync */ }

                console.log(`[AERIS SYNC] ${resultado.publicados} publicados, ${resultado.eliminados} eliminados, ${resultado.advertencias.length} advertencias.`);
                return res.status(200).json({
                    status: 'ok',
                    message: 'Sincronización completada con éxito.',
                    publicados: resultado.publicados,
                    noPublicados: resultado.noPublicados,
                    eliminados: resultado.eliminados,
                    advertencias: resultado.advertencias
                });
            } catch (error) {
                if (error instanceof ErrorSync) {
                    return res.status(error.status).json({
                        status: 'error',
                        message: error.message,
                        errores: error.errores,
                        advertencias: error.advertencias
                    });
                }
                console.error('[AERIS SYNC] Error crítico:', error);
                // No se devuelve error.message al exterior (puede revelar detalles internos).
                return res.status(500).json({ status: 'error', message: 'Error interno en el servidor.' });
            }
        }
    };
}

module.exports = { crearSyncController };
