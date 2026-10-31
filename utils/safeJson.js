/**
 * utils/safeJson.js — AERIS E-commerce
 *
 * Serializa a JSON de forma segura para incrustarlo en HTML.
 * Escapa < > & y los separadores de línea U+2028/U+2029, de modo que un
 * nombre como "</script><script>alert(1)" o "Women's blazer" no pueda
 * romper el <script type="application/json"> ni inyectar código.
 *
 * Uso en EJS (después de exponerla con app.locals.jsonParaHtml):
 *   <script id="product-data" type="application/json"><%- jsonParaHtml(producto) %></script>
 *
 * Lectura en el cliente (JSON.parse devuelve el valor original intacto):
 *   const dato = JSON.parse(document.getElementById('product-data').textContent);
 */

const ESCAPES = {
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029'
};

function jsonParaHtml(valor) {
    const json = JSON.stringify(valor);
    if (json === undefined) return 'null';
    return json.replace(/[<>&\u2028\u2029]/g, (c) => ESCAPES[c]);
}

module.exports = { jsonParaHtml };
