const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { crearSyncRoutes } = require('../routes/syncRoutes');
const { crearSyncController } = require('../controllers/syncController');

/**
 * Usa el router y el controlador REALES con un repositorio falso. Con un token válido y cuerpo vacío el controlador responde
 * 400 ("catálogo vacío") ANTES de tocar MongoDB; así probamos que el middleware
 * deja pasar sin necesitar base de datos.
 */
describe('POST /api/sync-catalog protegido', () => {
    let servidor;
    let base;
    const TOKEN_ORIGINAL = process.env.SYNC_TOKEN;

    before(async () => {
        const app = express();
        const controlador = crearSyncController({
            repositorio: { upsertMuchos: async () => {}, eliminarAusentes: async () => 0 },
            catalogo: { invalidar() {} }
        });
        app.use('/api', crearSyncRoutes(controlador));
        await new Promise(resolve => { servidor = app.listen(0, resolve); });
        base = `http://127.0.0.1:${servidor.address().port}/api/sync-catalog`;
    });

    after(async () => {
        if (TOKEN_ORIGINAL === undefined) delete process.env.SYNC_TOKEN;
        else process.env.SYNC_TOKEN = TOKEN_ORIGINAL;
        await new Promise(resolve => servidor.close(resolve));
    });

    const post = (headers = {}) => fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ productos: [] })
    });

    test('sin SYNC_TOKEN configurado el endpoint queda desactivado (503), aunque envíen algo', async () => {
        delete process.env.SYNC_TOKEN;
        assert.equal((await post()).status, 503);
        assert.equal((await post({ 'x-sync-token': '' })).status, 503);
    });

    test('sin header o con token incorrecto → 401', async () => {
        process.env.SYNC_TOKEN = 'secreto-de-prueba';
        assert.equal((await post()).status, 401);
        assert.equal((await post({ 'x-sync-token': 'otro' })).status, 401);
        assert.equal((await post({ 'x-sync-token': 'secreto-de-prueba-largo' })).status, 401);
    });

    test('con el token correcto pasa al controlador (400 por catálogo vacío)', async () => {
        process.env.SYNC_TOKEN = 'secreto-de-prueba';
        const r = await post({ 'x-sync-token': 'secreto-de-prueba' });
        assert.equal(r.status, 400);
        assert.equal((await r.json()).message, 'El catálogo enviado está vacío.');
    });
});
