/**
 * services/catalogService.js — AERIS E-commerce
 *
 * Dueño de las REGLAS DE LECTURA del catálogo. Los controladores le piden
 * ProductDTO ya listos; no conocen Mongo, ni el mapper, ni la caché.
 *
 *   repositorio.listarTodos() + leerMeta() → productNormalizer → ProductDTO[] → caché en memoria
 *
 * Caché (pensada para hosting gratuito):
 *  - Evita golpear MongoDB Atlas en cada visita (límites del plan gratis).
 *  - TTL configurable (por defecto 60 s). Se invalida sola tras un sync exitoso.
 *  - Si recargar falla (Atlas lento o pausado) y hay datos viejos, SIRVE los
 *    viejos y reintenta en unos segundos, en vez de tumbar la tienda.
 *  - Varias peticiones simultáneas comparten una sola carga.
 *  - Vive en memoria: si Render duerme el servicio, se reconstruye al despertar.
 *
 * Los DTO de la caché son COMPARTIDOS: ningún consumidor debe mutarlos.
 */
const { toProductDTOList } = require('../utils/productNormalizer');
const { calcularFiltros } = require('../utils/catalogFacets');

const REINTENTO_TRAS_ERROR_MS = 10 * 1000;

/**
 * @param {Object} deps
 * @param {{ listarTodos: () => Promise<Object[]>, leerMeta: () => Promise<Object> }} deps.repositorio
 * @param {number} [deps.ttlMs=60000]
 * @param {() => number} [deps.ahora=Date.now]   Reloj inyectable (tests).
 * @param {{ error: Function }} [deps.logger=console]
 */
function crearCatalogService({ repositorio, ttlMs = 60 * 1000, ahora = Date.now, logger = console }) {
    let cache = null;       // { dtos, meta, porId, porSku, cargadoEn }
    let enCurso = null;     // promesa de la carga en vuelo
    let generacion = 0;     // sube con cada invalidar(): descarta cargas anteriores

    async function cargar() {
        const [crudos, meta] = await Promise.all([repositorio.listarTodos(), repositorio.leerMeta()]);
        const ordenTallas = new Map(((meta && meta.tallas) || []).map(t => [t.talla, t.orden]));
        const dtos = toProductDTOList(crudos, { ordenTallas });
        return {
            dtos,
            meta: meta || { categorias: [], familiasColor: [], tallas: [] },
            porId: new Map(dtos.map(d => [d.id, d])),
            porSku: new Map(dtos.filter(d => d.sku !== null).map(d => [String(d.sku), d])),
            cargadoEn: ahora()
        };
    }

    async function obtener() {
        if (cache && ahora() - cache.cargadoEn < ttlMs) return cache;
        if (enCurso) return enCurso;

        const miGeneracion = generacion;
        const promesa = cargar()
            .then(nuevo => {
                if (miGeneracion === generacion) cache = nuevo;
                return nuevo;
            })
            .catch(error => {
                if (!cache) throw error;                      // sin datos viejos: que falle
                logger.error('[AERIS] No se pudo refrescar el catálogo; se sirven datos anteriores:', error.message);
                cache = { ...cache, cargadoEn: ahora() - ttlMs + REINTENTO_TRAS_ERROR_MS };
                return cache;
            })
            .finally(() => {
                if (enCurso === promesa) enCurso = null;
            });

        enCurso = promesa;
        return promesa;
    }

    return {
        /** Todo el catálogo (prendas y conjuntos), en el orden de la base de datos. */
        async todos() {
            return (await obtener()).dtos;
        },

        /**
         * Busca por cualquiera de las formas con que se llega a un producto:
         *  - urlId actual   "4-vestido-midi-abertura"  (también con un slug viejo: manda el número)
         *  - SKU numérico   "4"
         *  - id interno     "6ad800aee46279ad1388e4a1"  (enlaces antiguos)
         * null si no existe (o no está publicado).
         */
        async porIdOSku(valor) {
            const clave = String(valor === undefined || valor === null ? '' : valor).trim();
            if (!clave) return null;
            const { porId, porSku } = await obtener();
            const delUrlId = /^(\d+)(?:-|$)/.exec(clave);
            return porId.get(clave) || porSku.get(clave) || (delUrlId ? porSku.get(delUrlId[1]) : null) || null;
        },

        /** Datos del home: prendas sueltas, conjuntos y las categorías de las prendas (orden de la hoja). */
        async home() {
            const { dtos, meta } = await obtener();
            const prendas = dtos.filter(d => d.tipo === 'prenda');
            return {
                prendas,
                conjuntos: dtos.filter(d => d.tipo === 'conjunto'),
                categorias: calcularFiltros(prendas, meta).categorias
            };
        },

        /** Datos de la página de catálogo: todos los productos y los datos de sus filtros. */
        async paginaCatalogo() {
            const { dtos, meta } = await obtener();
            return { productos: dtos, filtros: calcularFiltros(dtos, meta) };
        },

        /** Misma categoría (hasta `limite`); si no hay, los más recientes. Nunca incluye al propio producto. */
        async relacionados(dto, limite = 4) {
            const { dtos } = await obtener();
            const otros = dtos.filter(d => d.id !== dto.id);

            const mismaCategoria = dto.categoria ? otros.filter(d => d.categoria === dto.categoria) : [];
            if (mismaCategoria.length > 0) return mismaCategoria.slice(0, limite);

            return [...otros]
                .sort((a, b) => (b.creadoEn || '').localeCompare(a.creadoEn || ''))
                .slice(0, limite);
        },

        /** Códigos promocionales (solo para validar en el servidor; nunca se envían al navegador). */
        async promociones() {
            const { meta } = await obtener();
            return (meta && meta.promociones) || [];
        },

        /** Descarta la caché (llamar tras un sync exitoso). */
        invalidar() {
            generacion++;
            cache = null;
            enCurso = null;
        }
    };
}

module.exports = { crearCatalogService };
