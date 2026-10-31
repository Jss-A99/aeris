/**
 * config/database.js — AERIS E-commerce
 * Conexión a MongoDB Atlas y ajuste opcional de DNS.
 */
const dns = require('dns');
const mongoose = require('mongoose');

/**
 * Algunas redes (típicamente en Windows) no resuelven los registros SRV de Atlas
 * ("querySrv ECONNREFUSED"). Antes se forzaba 8.8.8.8 SIEMPRE, también en producción.
 * Ahora es opcional: define en tu .env LOCAL  DNS_SERVERS=8.8.8.8,8.8.4.4
 * y no lo definas en Render.
 */
function aplicarDnsOpcional(valor = process.env.DNS_SERVERS) {
    const servidores = String(valor || '').split(',').map(s => s.trim()).filter(Boolean);
    if (servidores.length > 0) {
        dns.setServers(servidores);
        console.log(`[AERIS] DNS personalizado: ${servidores.join(', ')}`);
    }
}

async function conectar(uri = process.env.MONGO_URI) {
    if (!uri) throw new Error('Falta la variable de entorno MONGO_URI.');
    await mongoose.connect(uri);
    console.log('[AERIS] MongoDB conectado.');
}

async function desconectar() {
    await mongoose.disconnect();
}

module.exports = { aplicarDnsOpcional, conectar, desconectar };
