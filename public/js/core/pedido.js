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

    /** "Negro · Talla M" (sin las partes que no aplican). */
    function opciones(color, talla) {
        return [color || '', talla ? `Talla ${talla}` : ''].filter(Boolean).join(' · ');
    }

    const SEPARADOR = '────────────';

    /** Texto de la entrega para el mensaje. */
    function textoEntrega(entrega, gratis) {
        if (entrega === 'recojo') return 'Recojo en tienda';
        if (entrega === 'lima') return gratis ? 'Envío en Lima, gratis' : 'Envío en Lima, costo por coordinar';
        return 'Envío a provincia, costo por coordinar';
    }

    /**
     * Mensaje del pedido para WhatsApp (en WhatsApp, *texto* se ve en negrita).
     *
     *   Hola, AERIS. Me gustaría hacer este pedido:
     *
     *   *PEDIDO AER-0042*
     *   ────────────
     *
     *   *Blusa Seda Básica*
     *   Negro · Talla M
     *   Cantidad: 2 · S/ 159.80
     *   …
     *   ────────────
     *   Subtotal: S/ 449.70
     *   Descuento (AERIS10): −S/ 44.97
     *   Entrega: Envío en Lima, costo por coordinar
     *   *Total: S/ 404.73 + envío*
     *
     * @param {Object} p
     * @param {Object[]} p.lineas
     * @param {'recojo'|'lima'|'provincia'} p.entrega
     * @param {{ codigo:string, descuento:number }|null} [p.promo]
     * @param {boolean} [p.envioGratis]  la compra alcanzó el envío gratis en Lima
     * @param {string} [p.codigo]        código del pedido (AER-0042); sin código, solo "PEDIDO"
     */
    function armarMensaje({ lineas, entrega, promo, envioGratis: gratis, codigo }) {
        const t = totales(lineas, promo ? promo.descuento : 0);
        const filas = ['Hola, AERIS. Me gustaría hacer este pedido:', '', `*PEDIDO${codigo ? ' ' + codigo : ''}*`, SEPARADOR];

        lineas.forEach(l => {
            filas.push('', `*${l.titulo}*`);
            if (l.componentes && l.componentes.length) {
                l.componentes.forEach(c => {
                    const o = opciones(c.color, c.talla);
                    filas.push(o ? `${c.nombre} — ${o}` : c.nombre);
                });
            } else {
                const o = opciones(l.color, l.talla);
                if (o) filas.push(o);
            }
            filas.push(`Cantidad: ${l.cantidad} · ${soles(l.precio * l.cantidad)}`);
        });

        filas.push('', SEPARADOR, `Subtotal: ${soles(t.subtotal)}`);
        if (promo && t.descuento > 0) filas.push(`Descuento (${promo.codigo}): −${soles(t.descuento)}`);
        filas.push(`Entrega: ${textoEntrega(entrega, gratis)}`);
        const conEnvioAparte = entrega === 'provincia' || (entrega === 'lima' && !gratis);
        filas.push(`*Total: ${soles(t.total)}${conEnvioAparte ? ' + envío' : ''}*`);
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
