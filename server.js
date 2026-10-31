/**
 * ============================================================================
 * AERIS E-COMMERCE — RAÍZ DE COMPOSICIÓN (EXPRESS)
 * ============================================================================
 * @file server.js
 *
 * Aquí solo se ENSAMBLAN las piezas; ninguna regla de negocio vive en este archivo:
 *
 *   repositorio ──▶ catalogService ──▶ pagesController ──▶ routes ──▶ vistas EJS
 *        └─────────▶ syncController ──▶ routes (/api)
 *
 * `crearApp()` acepta dependencias inyectadas para poder probar toda la app
 * (rutas, redirecciones, errores) sin MongoDB.
 * ============================================================================
 */
require('dotenv').config({ quiet: true });

const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');

const { handle404, handleErrors } = require('./middlewares/errorHandler');
const { crearCatalogService } = require('./services/catalogService');
const { crearPagesController } = require('./controllers/pagesController');
const { crearSyncController } = require('./controllers/syncController');
const { crearSyncRoutes } = require('./routes/syncRoutes');
const { crearRutas } = require('./routes/index');
const { jsonParaHtml } = require('./utils/safeJson');

/**
 * @param {Object} [opciones]
 * @param {Object} [opciones.repositorio]  Por defecto, el de MongoDB.
 * @param {Object} [opciones.catalogo]     Por defecto, catalogService sobre el repositorio.
 * @param {string} [opciones.viewsDir]     Por defecto ./views
 * @param {boolean} [opciones.layouts=true] Usa express-ejs-layouts (views/layout.ejs).
 * @param {number} [opciones.ttlCatalogoMs]
 */
function crearApp(opciones = {}) {
    const repositorio = opciones.repositorio || require('./repositories/productRepository');
    const ttlMs = opciones.ttlCatalogoMs !== undefined
        ? opciones.ttlCatalogoMs
        : (Number(process.env.CATALOG_TTL_MS) || 60 * 1000);
    const catalogo = opciones.catalogo || crearCatalogService({ repositorio, ttlMs });

    const app = express();

    app.disable('x-powered-by');
    app.set('trust proxy', 1);                       // Render va detrás de un proxy
    app.set('view engine', 'ejs');
    app.set('views', opciones.viewsDir || path.join(__dirname, 'views'));
    if (opciones.layouts !== false) app.use(expressLayouts);

    // Disponible en TODAS las vistas: <%- jsonParaHtml(dato) %>
    app.locals.jsonParaHtml = jsonParaHtml;

    // Cabeceras mínimas. La CSP completa se define con el diseño (depende de fuentes y scripts).
    app.use((req, res, next) => {
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('X-Frame-Options', 'SAMEORIGIN');
        res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
        next();
    });

    app.use(express.static(path.join(__dirname, 'public'), {
        maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
    }));

    const pages = crearPagesController({ catalogo });
    const syncController = crearSyncController({ repositorio, catalogo });
    app.use('/', crearRutas({ pages, syncRouter: crearSyncRoutes(syncController) }));

    app.use(handle404);
    app.use(handleErrors);

    return app;
}

async function iniciar() {
    const { aplicarDnsOpcional, conectar, desconectar } = require('./config/database');
    const PORT = process.env.PORT || 3001;

    aplicarDnsOpcional();
    await conectar();                                // si falla, el proceso termina con error (ver abajo)

    const servidor = crearApp().listen(PORT, () => {
        console.log(`[AERIS] Servidor activo en http://localhost:${PORT}`);
    });

    // Render envía SIGTERM al reiniciar/desplegar: cerrar limpio evita peticiones cortadas.
    const apagar = (senal) => {
        console.log(`[AERIS] ${senal} recibido, cerrando...`);
        servidor.close(async () => {
            await desconectar();
            process.exit(0);
        });
    };
    process.on('SIGTERM', () => apagar('SIGTERM'));
    process.on('SIGINT', () => apagar('SIGINT'));
}

if (require.main === module) {
    iniciar().catch(error => {
        console.error('[AERIS] No se pudo iniciar:', error.message);
        process.exit(1);
    });
}

module.exports = { crearApp };
