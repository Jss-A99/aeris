/**
 * ============================================================================
 * REGLAS DE FILTRO DEL CATÁLOGO — AERIS E-COMMERCE
 * ============================================================================
 * @file public/js/core/catalog-query.js
 *
 * Una sola copia de las reglas, usada en DOS lugares:
 *  - el servidor (utils/catalogPage.js) filtra, ordena y pagina la página;
 *  - el navegador (panel de filtros) cuenta "Ver resultados (n)" mientras eliges.
 * Así el número del botón y lo que muestra la página nunca se desfasan.
 *
 * Estado de la consulta (siempre normalizado con `parsear`):
 *   { categoria, orden, tallas[], colores[], min, max, pagina }
 *   - categoria: 'todo' | 'descuentos' | id de categoría de la hoja
 *   - orden:     null (orden de la hoja) | 'nuevo' | 'asc' | 'desc'
 *   - colores:   ids de FAMILIAS de color (no cada tono)
 *
 * Funciona en el navegador (window.AerisCatalogQuery) y en Node (require).
 * ============================================================================
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AerisCatalogQuery = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const POR_PAGINA = 12;
    const ORDENES = Object.freeze([
        { id: 'nuevo', nombre: 'Novedades' },
        { id: 'asc', nombre: 'Precio ascendente' },
        { id: 'desc', nombre: 'Precio descendente' }
    ]);
    const DESCUENTOS = 'descuentos';
    const TODO = 'todo';

    const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());
    const comoLista = (v) => (Array.isArray(v) ? v : texto(v).split(','))
        .map(texto).filter(Boolean);

    /* ------------------------------------------------------------------ */
    /* Consulta                                                            */
    /* ------------------------------------------------------------------ */

    /**
     * Querystring (o un objeto parecido) → estado válido. Lo que no existe en `filtros`
     * se descarta en silencio (enlaces viejos o editados a mano no rompen la página).
     * @param {Object} query   req.query o un objeto con las mismas claves
     * @param {{ tallas:{letras:string[],numericas:string[]}, familiasColor:{id:string}[], precio:{min:number,max:number} }} filtros
     */
    function parsear(query, filtros) {
        const q = query || {};
        const f = filtros || {};
        const tallasValidas = f.tallas ? [...f.tallas.letras, ...f.tallas.numericas] : [];
        const coloresValidos = (f.familiasColor || []).map(c => c.id);
        const rango = f.precio || { min: 0, max: 0 };

        const pedidasT = new Set(comoLista(q.talla).map(t => t.toUpperCase()));
        const pedidosC = new Set(comoLista(q.color).map(c => c.toLowerCase()));

        const numero = (v, porDefecto) => {
            const n = Number(texto(v));
            return texto(v) !== '' && Number.isFinite(n) ? Math.min(Math.max(n, rango.min), rango.max) : porDefecto;
        };
        let min = numero(q.min, rango.min);
        let max = numero(q.max, rango.max);
        if (min > max) [min, max] = [max, min];

        const pagina = Math.floor(Number(texto(q.pagina)));

        return {
            categoria: texto(q.categoria).toLowerCase() || TODO,
            orden: ORDENES.some(o => o.id === q.orden) ? q.orden : null,
            tallas: tallasValidas.filter(t => pedidasT.has(t)),      // en el orden de la hoja
            colores: coloresValidos.filter(c => pedidosC.has(c)),
            min,
            max,
            pagina: Number.isFinite(pagina) && pagina >= 1 ? pagina : 1
        };
    }

    const precioActivo = (estado, filtros) =>
        estado.min > filtros.precio.min || estado.max < filtros.precio.max;

    /** Filtros marcados en el panel (el orden también cuenta). La categoría no: es la pestaña. */
    function nActivos(estado, filtros) {
        return (estado.orden ? 1 : 0) + estado.tallas.length + estado.colores.length
            + (precioActivo(estado, filtros) ? 1 : 0);
    }

    /**
     * Estado → "?categoria=blusas&talla=M,L&pagina=2" (sin los valores por defecto).
     * @param {Object} [cambios]  se aplican sobre el estado; cambiar algo que no sea la página la vuelve a 1
     */
    function aQuery(estado, filtros, cambios) {
        const e = Object.assign({}, estado, cambios || {});
        if (cambios && !('pagina' in cambios)) e.pagina = 1;
        const partes = [];
        const poner = (k, v) => partes.push(`${k}=${encodeURIComponent(v)}`);
        if (e.categoria && e.categoria !== TODO) poner('categoria', e.categoria);
        if (e.orden) poner('orden', e.orden);
        if (e.tallas.length) poner('talla', e.tallas.join(','));
        if (e.colores.length) poner('color', e.colores.join(','));
        if (e.min > filtros.precio.min) poner('min', e.min);
        if (e.max < filtros.precio.max) poner('max', e.max);
        if (e.pagina > 1) poner('pagina', e.pagina);
        return partes.length ? '?' + partes.join('&') : '';
    }

    /* ------------------------------------------------------------------ */
    /* Filtrar y ordenar                                                   */
    /* ------------------------------------------------------------------ */

    /** Variantes que cuentan para talla/color: las propias o, en un conjunto, las de sus piezas. */
    function variantesDe(p) {
        if (p.tipo === 'conjunto') return (p.piezas || []).flatMap(pz => pz.variantes || []);
        return p.variantes || [];
    }

    function enCategoria(p, categoria) {
        if (categoria === TODO) return true;
        if (categoria === DESCUENTOS) return p.precioAnterior !== null && p.precioAnterior !== undefined;
        return p.categoria === categoria;
    }

    /** Talla y color se cruzan: tiene que existir UNA variante con stock que cumpla ambos. */
    function cumpleTallaColor(p, estado) {
        if (!estado.tallas.length && !estado.colores.length) return true;
        return variantesDe(p).some(v => v.stock > 0
            && (!estado.tallas.length || estado.tallas.includes(v.talla))
            && (!estado.colores.length || estado.colores.includes(v.familia)));
    }

    function cumple(p, estado, categoria) {
        return enCategoria(p, categoria === undefined ? estado.categoria : categoria)
            && cumpleTallaColor(p, estado)
            && p.precio >= estado.min && p.precio <= estado.max;
    }

    const COMPARAR = {
        nuevo: (a, b) => (b.esNuevo ? 1 : 0) - (a.esNuevo ? 1 : 0) || texto(b.creadoEn).localeCompare(texto(a.creadoEn)),
        asc: (a, b) => a.precio - b.precio,
        desc: (a, b) => b.precio - a.precio
    };

    /** Filtra y ordena. Los agotados van siempre al final. Sin orden: el de la hoja. */
    function filtrar(productos, estado) {
        const comparar = estado.orden ? COMPARAR[estado.orden] : () => 0;
        return productos
            .map((p, i) => ({ p, i }))
            .filter(({ p }) => cumple(p, estado))
            .sort((a, b) => (a.p.agotado ? 1 : 0) - (b.p.agotado ? 1 : 0) || comparar(a.p, b.p) || a.i - b.i)
            .map(({ p }) => p);
    }

    /** Página pedida (ajustada al rango válido). */
    function paginar(lista, pagina, porPagina) {
        const tam = porPagina || POR_PAGINA;
        const paginas = Math.max(1, Math.ceil(lista.length / tam));
        const actual = Math.min(Math.max(1, pagina || 1), paginas);
        const desde = (actual - 1) * tam;
        return { items: lista.slice(desde, desde + tam), total: lista.length, pagina: actual, paginas, desde };
    }

    /** 1 … 4 5 6 … 12 (todas si son 7 o menos). '…' marca un salto. */
    function numerosPagina(actual, total) {
        if (total <= 7) return Array.from({ length: total }, (_, k) => k + 1);
        const medio = [actual - 1, actual, actual + 1].filter(n => n > 1 && n < total);
        return [1, ...(medio[0] > 2 ? ['…'] : []), ...medio,
            ...(medio[medio.length - 1] < total - 1 ? ['…'] : []), total];
    }

    /**
     * Lo mínimo que necesita el navegador para contar resultados (no viaja todo el DTO).
     */
    function compactar(p) {
        const v = (x) => ({ talla: x.talla, familia: x.familia, stock: x.stock });
        return {
            tipo: p.tipo,
            categoria: p.categoria,
            precio: p.precio,
            precioAnterior: p.precioAnterior,
            agotado: p.agotado,
            variantes: (p.variantes || []).map(v),
            piezas: (p.piezas || []).map(pz => ({ variantes: (pz.variantes || []).map(v) }))
        };
    }

    return {
        POR_PAGINA, ORDENES, DESCUENTOS, TODO,
        parsear, precioActivo, nActivos, aQuery,
        enCategoria, cumple, filtrar, paginar, numerosPagina, compactar
    };
});
