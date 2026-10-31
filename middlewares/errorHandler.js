/**
 * ============================================================================
 * MANEJO CENTRALIZADO DE ERRORES — AERIS E-COMMERCE
 * ============================================================================
 * Los controladores NO renderizan páginas de error: llaman a
 *   next(httpError(404, 'mensaje'))
 * y este middleware decide la respuesta (JSON para API/AJAX, vista para páginas).
 */

/** Crea un error con código HTTP (los 4xx se consideran "esperables"). */
function httpError(status, mensaje) {
    const error = new Error(mensaje);
    error.status = status;
    return error;
}

const handle404 = (req, res, next) => {
    next(httpError(404, `Ruta no encontrada: [${req.method}] ${req.originalUrl}`));
};

const esPeticionDeApi = (req) =>
    req.originalUrl.startsWith('/api/') ||
    req.xhr ||
    Boolean(req.headers.accept && req.headers.accept.includes('json'));

const handleErrors = (err, req, res, next) => {
    if (res.headersSent) return next(err);

    const candidato = Number(err.status || err.statusCode);
    const status = candidato >= 400 && candidato < 600 ? candidato : 500;

    if (status >= 500) {
        console.error('\n[AERIS ERROR]', JSON.stringify({
            timestamp: new Date().toISOString(),
            metodo: req.method,
            url: req.originalUrl,
            status,
            mensaje: err.message,
            stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
        }, null, 2));
    } else {
        // Un 404/400 es normal (bots, enlaces viejos): una línea basta.
        console.warn(`[AERIS ${status}] ${req.method} ${req.originalUrl}`);
    }

    const mensaje = status === 404
        ? 'La página que buscas no existe o ha sido movida.'
        : status >= 500
            ? 'Ocurrió un inconveniente al procesar tu solicitud.'
            : 'No pudimos procesar tu solicitud.';

    if (esPeticionDeApi(req)) {
        return res.status(status).json({ ok: false, status, mensaje });
    }

    // Si la propia vista de error falla, se responde en texto plano en vez de entrar en bucle.
    return res.status(status).render(
        'pages/error',
        { pagina: 'error', title: `Error ${status} — AERIS`, mensaje, status },
        (renderError, html) => {
            if (renderError) return res.status(status).type('text/plain').send(mensaje);
            return res.send(html);
        }
    );
};

module.exports = { httpError, handle404, handleErrors };
