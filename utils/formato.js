/**
 * utils/formato.js — AERIS E-commerce
 * Formatos de presentación compartidos por las vistas.
 */

/** 79.9 → "S/ 79.90" (separador decimal con punto, como se usa en Perú). */
function soles(n) {
    const valor = Number(n);
    return `S/ ${(Number.isFinite(valor) ? valor : 0).toFixed(2)}`;
}

module.exports = { soles };
