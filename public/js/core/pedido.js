/**
 * ============================================================================
 * PEDIDO POR WHATSAPP — AERIS E-COMMERCE
 * ============================================================================
 * @file public/js/core/pedido.js
 *
 * Arma el mensaje del pedido y el enlace de WhatsApp a partir de las líneas de la bolsa.
 * Funciona en el navegador (window.AerisPedido) y en Node (pruebas).
 *
 * Línea: { titulo, precio, cantidad, color, talla, componentes: [{nombre,color,talla}] }
 * Entrega: 'recojo' | 'lima' | 'provincia'
 * ============================================================================
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AerisPedido = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const soles = (n) => 'S/ ' + Number(n).toFixed(2);
    const redondear = (n) => Math.round(n * 100) / 100;

    /** @returns {{ subtotal:number, descuento:number, total:number }} */
    function totales(lineas, descuento) {
        const subtotal = redondear(lineas.reduce((s, l) => s + l.precio * l.cantidad, 0));
        const desc = Math.min(redondear(Number(descuento) || 0), subtotal);
        return { subtotal, descuento: desc, total: redondear(subtotal - desc) };
    }

    /**
     * Envío gratis en Lima. Se cuenta DESPUÉS del código promocional.
     * @param {number} monto   total con descuento
     * @param {{ gratisDesde:number, avisarDesdeFaltan:number }} regla
     * @returns {{ gratis:boolean, falta:number, avisar:boolean, avance:number }}
     *   avisar: mostrar el aviso (ya es gratis, o falta avisarDesdeFaltan o menos)
     *   avance: 0..1 para la barra
     */
    function envioGratis(monto, regla) {
        if (!regla || !(regla.gratisDesde > 0) || !(monto > 0)) return { gratis: false, falta: 0, avisar: false, avance: 0 };
        const falta = redondear(Math.max(0, regla.gratisDesde - monto));
        return {
            gratis: falta === 0,
            falta,
            avisar: falta === 0 || falta <= (regla.avisarDesdeFaltan || 0),
            avance: Math.min(1, monto / regla.gratisDesde)
        };
    }

    /** "Color: Negro · Talla: M" (sin las partes que no aplican). */
    function opciones(color, talla) {
        return [color ? `Color: ${color}` : '', talla ? `Talla: ${talla}` : ''].filter(Boolean).join(' · ');
    }

    /**
     * @param {Object} p
     * @param {Object[]} p.lineas
     * @param {'recojo'|'lima'|'provincia'} p.entrega
     * @param {{ codigo:string, descuento:number }|null} [p.promo]
     * @param {boolean} [p.envioGratis]  la compra alcanzó el envío gratis en Lima
     */
    function armarMensaje({ lineas, entrega, promo, envioGratis: gratis }) {
        const t = totales(lineas, promo ? promo.descuento : 0);
        const filas = ['Hola AERIS, quiero hacer este pedido:', ''];

        lineas.forEach((l, i) => {
            filas.push(`${i + 1}. ${l.titulo}`);
            if (l.componentes && l.componentes.length) {
                l.componentes.forEach(c => {
                    const o = [c.color, c.talla].filter(Boolean).join(' · ');
                    filas.push(`   ${c.nombre}${o ? ': ' + o : ''}`);
                });
            } else {
                const o = opciones(l.color, l.talla);
                if (o) filas.push(`   ${o}`);
            }
            filas.push(`   ${l.cantidad} × ${soles(l.precio)} = ${soles(l.precio * l.cantidad)}`);
        });

        filas.push('', `Subtotal: ${soles(t.subtotal)}`);
        if (promo && t.descuento > 0) filas.push(`Código ${promo.codigo}: -${soles(t.descuento)}`);
        if (entrega === 'lima' && gratis) {
            filas.push('Entrega: Envío en Lima (gratis)');
            filas.push(`Total: ${soles(t.total)}`);
        } else if (entrega === 'lima') {
            filas.push('Entrega: Envío en Lima (el costo lo coordinamos según mi distrito)');
            filas.push(`Total: ${soles(t.total)} + envío`);
        } else if (entrega === 'provincia') {
            filas.push('Entrega: Envío a provincia (el costo lo coordinamos)');
            filas.push(`Total: ${soles(t.total)} + envío`);
        } else {
            filas.push('Entrega: Recojo en tienda');
            filas.push(`Total: ${soles(t.total)}`);
        }
        return filas.join('\n');
    }

    /** null si el número no es válido (debe ser solo dígitos, con código de país). */
    function enlaceWhatsApp(numero, texto) {
        const n = String(numero || '').replace(/\D/g, '');
        if (n.length < 8) return null;
        return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
    }

    return { totales, envioGratis, armarMensaje, enlaceWhatsApp };
});
