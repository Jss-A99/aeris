/**
 * utils/promo.js — AERIS E-commerce
 *
 * Reglas de los códigos promocionales (pestaña PROMOCIONES de la hoja). Función PURA.
 * La lista de códigos NUNCA viaja al navegador: el navegador solo pregunta por un código
 * y recibe si vale y cuánto descuenta.
 *
 * Promoción guardada: { codigo, tipo: 'porcentaje'|'monto', valor, minimo, vence: 'AAAA-MM-DD'|null, activo }
 */

/** "aeris 10" → "AERIS10" (sin espacios, en mayúsculas). */
const normalizarCodigo = (c) => String(c === null || c === undefined ? '' : c).trim().toUpperCase().replace(/\s+/g, '');

const redondear = (n) => Math.round(n * 100) / 100;

/** Último instante del día de vencimiento en Lima (UTC−5). */
const finDelDia = (fecha) => Date.parse(`${fecha}T23:59:59.999-05:00`);

/**
 * @param {Object[]} promociones
 * @param {string} codigo
 * @param {number} subtotal
 * @param {number} [ahora=Date.now()]
 * @returns {{ ok: true, codigo: string, descuento: number, etiqueta: string }
 *         | { ok: false, mensaje: string }}
 */
function evaluarPromo(promociones, codigo, subtotal, ahora = Date.now()) {
    const c = normalizarCodigo(codigo);
    if (!c) return { ok: false, mensaje: 'Escribe un código.' };

    const p = (promociones || []).find(x => x.codigo === c);
    if (!p || !p.activo) return { ok: false, mensaje: 'Ese código no existe o ya no está activo.' };
    if (p.vence && finDelDia(p.vence) < ahora) return { ok: false, mensaje: 'Este código ya venció.' };

    const monto = Number(subtotal);
    if (!Number.isFinite(monto) || monto <= 0) return { ok: false, mensaje: 'Tu bolsa está vacía.' };
    if (p.minimo > 0 && monto < p.minimo) {
        return { ok: false, mensaje: `Este código es para compras desde S/ ${p.minimo.toFixed(2)}.` };
    }

    const descuento = p.tipo === 'porcentaje'
        ? redondear(monto * p.valor / 100)
        : redondear(Math.min(p.valor, monto));
    const etiqueta = p.tipo === 'porcentaje' ? `-${p.valor}%` : `-S/ ${p.valor.toFixed(2)}`;
    return { ok: true, codigo: c, descuento, etiqueta };
}

module.exports = { evaluarPromo, normalizarCodigo };
