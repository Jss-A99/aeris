/**
 * utils/migas.js — AERIS E-commerce
 *
 * Migas de pan de producto y conjunto. Siguen la RUTA por la que llegó la clienta:
 *   desde el inicio           → "Inicio"
 *   desde el catálogo         → "Catálogo / Blusas"  (Catálogo vuelve con los mismos filtros y página)
 *   desde la bolsa / favoritos → "Bolsa" / "Favoritos"
 *   desde otro producto o un conjunto → su nombre (ej. "Set Noir": vuelve al conjunto)
 *   desde fuera de la tienda (WhatsApp, Instagram) o sin dato → "Catálogo / Blusas"
 * Solo se usan rutas del mismo dominio: nunca se enlaza a otro sitio.
 */

const PAGINAS = Object.freeze({ '/': 'Inicio', '/carrito': 'Bolsa', '/favoritos': 'Favoritos', '/pedidos': 'Pedidos', '/nosotros': 'Nosotros' });

/**
 * Referer → ruta interna ("/catalogo?x=1"), o null si no es de esta tienda.
 * @param {string} [referer]
 * @param {string} host  req.get('host')
 */
function rutaInterna(referer, host) {
    try {
        const u = new URL(String(referer || ''));
        return u.host === host ? u.pathname + u.search : null;
    } catch (e) {
        return null;
    }
}

/** "/producto/4-vestido" o "/conjunto/3-set" → { tipo, id }; si no, null. */
function fichaDeRuta(ruta) {
    const m = /^\/(producto|conjunto)\/([^/?#]+)/.exec(ruta || '');
    return m ? { tipo: m[1], id: decodeURIComponent(m[2]) } : null;
}

/**
 * @param {Object} p
 * @param {string|null} p.ruta          ruta interna de donde vino (rutaInterna)
 * @param {{ id: string, nombre: string }|null} p.categoria
 * @param {{ nombre: string, url: string }|null} [p.anterior]   ficha de donde vino (otro producto o un conjunto)
 * @param {string} [p.urlActual]        para no enlazarse a sí misma
 * @returns {{ migas: Array<{ texto: string, href: string }>, categoria: { nombre: string, href: string }|null }}
 */
function armarMigas({ ruta, categoria, anterior, urlActual }) {
    const deCategoria = categoria ? `/catalogo?categoria=${encodeURIComponent(categoria.id)}` : '/catalogo';
    const cat = categoria ? { nombre: categoria.nombre, href: deCategoria } : null;
    const conCategoria = (catalogo) => [{ texto: 'Catálogo', href: catalogo }, ...(cat ? [{ texto: cat.nombre, href: cat.href }] : [])];
    const camino = (ruta || '').split('?')[0];

    let migas;
    if (camino === '/catalogo') migas = conCategoria(ruta);
    else if (PAGINAS[camino]) migas = [{ texto: PAGINAS[camino], href: camino }];
    else if (anterior && anterior.url !== urlActual) migas = [{ texto: anterior.nombre, href: anterior.url }];
    else migas = conCategoria(deCategoria);

    return { migas, categoria: cat };
}

module.exports = { armarMigas, rutaInterna, fichaDeRuta };
