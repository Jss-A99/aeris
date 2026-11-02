/**
 * middlewares/limitePorMinuto.js — AERIS E-commerce
 *
 * Límite simple de peticiones por IP (en memoria). Frena que alguien llene la tabla de pedidos
 * a propósito. Una persona real nunca llega al límite. Con varias instancias del servidor el
 * límite sería por instancia; para la tienda (una sola instancia) es suficiente.
 */
function limitePorMinuto(maximo, ventanaMs = 60 * 1000) {
    const visitas = new Map();   // ip → [marcas de tiempo]
    return (req, res, next) => {
        const ahora = Date.now();
        const ip = req.ip || 'desconocida';
        const recientes = (visitas.get(ip) || []).filter(t => ahora - t < ventanaMs);
        if (recientes.length >= maximo) {
            return res.status(429).json({ ok: false, mensaje: 'Demasiados intentos seguidos. Espera un minuto e inténtalo de nuevo.' });
        }
        recientes.push(ahora);
        visitas.set(ip, recientes);
        if (visitas.size > 5000) visitas.clear();   // nunca crece sin control
        return next();
    };
}

module.exports = { limitePorMinuto };
