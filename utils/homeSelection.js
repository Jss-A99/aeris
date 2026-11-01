/**
 * utils/homeSelection.js — AERIS E-commerce
 *
 * Qué prendas salen en las pestañas del inicio. Se calcula EN CADA VISITA (fuera de la caché
 * del catálogo), así cada cliente ve una mezcla distinta.
 *
 * Reglas:
 *  - Hasta 8 por pestaña, elegidas al azar dentro de la categoría.
 *  - Nunca salen agotados.
 *  - En "Todo" se reparten por turnos entre categorías (no 8 blusas seguidas).
 *  - El número de la pestaña es el total REAL de la categoría, no los 8 que se muestran.
 */
const MAX_POR_PESTANA = 8;
const MAX_LOOKS = 3;

function barajar(lista, azar) {
    const a = [...lista];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(azar() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * @param {import('./productContract').ProductDTO[]} prendas   solo prendas (sin conjuntos)
 * @param {Array<{id:string,nombre:string}>} categorias          en el orden de la hoja
 * @param {{ max?: number, azar?: () => number }} [opciones]     azar inyectable para tests
 * @returns {Array<{ id:string, nombre:string, total:number, items:Object[] }>}
 */
function elegirPestanas(prendas, categorias, opciones = {}) {
    const max = opciones.max || MAX_POR_PESTANA;
    const azar = opciones.azar || Math.random;

    const conProductos = categorias.filter(c => prendas.some(p => p.categoria === c.id));
    const disponibles = (id) => prendas.filter(p => p.categoria === id && !p.agotado);

    const porCategoria = conProductos.map(c => ({
        id: c.id,
        nombre: c.nombre,
        total: prendas.filter(p => p.categoria === c.id).length,
        items: barajar(disponibles(c.id), azar).slice(0, max)
    }));

    // "Todo": por turnos, una de cada categoría, hasta llenar.
    const montones = conProductos.map(c => barajar(disponibles(c.id), azar));
    const mezcla = [];
    while (mezcla.length < max && montones.some(m => m.length)) {
        montones.forEach(m => { if (m.length && mezcla.length < max) mezcla.push(m.shift()); });
    }

    return [{ id: 'todo', nombre: 'Todo', total: prendas.length, items: barajar(mezcla, azar) }, ...porCategoria];
}

/** Conjuntos del inicio: hasta 3 con stock, los marcados "Nuevo" primero. */
function elegirLooks(conjuntos, max = MAX_LOOKS) {
    return conjuntos
        .filter(c => !c.agotado)
        .map((c, i) => ({ c, i }))
        .sort((a, b) => (b.c.esNuevo ? 1 : 0) - (a.c.esNuevo ? 1 : 0) || a.i - b.i)
        .slice(0, max)
        .map(({ c }) => c);
}

/**
 * "Te puede interesar" (favoritos): artículos al azar con stock, prendas y conjuntos.
 * Se mandan algunos de más: el navegador oculta los que ya están en favoritos.
 */
function elegirSugerencias(productos, max = 8, azar = Math.random) {
    return barajar(productos.filter(p => !p.agotado), azar).slice(0, max);
}

module.exports = { elegirPestanas, elegirLooks, elegirSugerencias, MAX_POR_PESTANA };
