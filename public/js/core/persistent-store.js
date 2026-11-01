/**
 * ============================================================================
 * BASE DE LOS STORES DEL CLIENTE — AERIS E-COMMERCE
 * ============================================================================
 * @file public/js/core/persistent-store.js
 *
 * Lo que comparten bag-store y wish-store:
 *  - UNA sola clave versionada en localStorage: { v, items }.
 *  - Si lo guardado está roto o es de otra versión, se empieza vacío.
 *  - UN solo evento de cambio: subscribe(fn) → fn(items) cada vez que cambia
 *    la lista (también si cambia en otra pestaña).
 *  - Si localStorage no existe o falla (modo privado, cuota llena), sigue
 *    funcionando en memoria.
 *
 * Los items que entrega son COPIAS: quien los recibe no puede romper el store.
 * Orden de carga: contracts.js → persistent-store.js → bag-store.js / wish-store.js
 * ============================================================================
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AerisPersistentStore = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const copiar = (v) => JSON.parse(JSON.stringify(v));

    /** localStorage del navegador, o null si no se puede usar. */
    function storageDelNavegador() {
        try {
            const s = globalThis.localStorage;
            const prueba = '__aeris_prueba__';
            s.setItem(prueba, '1');
            s.removeItem(prueba);
            return s;
        } catch (e) {
            return null;
        }
    }

    function leerJSON(storage, clave) {
        if (!storage) return undefined;
        try {
            const crudo = storage.getItem(clave);
            return crudo === null ? undefined : JSON.parse(crudo);
        } catch (e) {
            return undefined; // JSON roto: se trata como vacío
        }
    }

    /**
     * @param {Object} cfg
     * @param {string}   cfg.clave            p. ej. 'aeris:bag'
     * @param {number}   cfg.version          se guarda en { v } y se compara al leer
     * @param {(item:any) => boolean} cfg.esValido       filtro de items ya guardados
     * @param {Storage|null} [cfg.storage]    por defecto, localStorage (si funciona)
     * @param {EventTarget}  [cfg.ventana]    para escuchar 'storage' (otras pestañas)
     */
    function crearStorePersistente(cfg) {
        const storage = cfg.storage !== undefined ? cfg.storage : storageDelNavegador();
        const oyentes = new Set();
        let items = cargar();

        function cargar() {
            const guardado = leerJSON(storage, cfg.clave);
            if (guardado && guardado.v === cfg.version && Array.isArray(guardado.items)) {
                return guardado.items.filter(cfg.esValido);
            }
            return [];
        }

        function escribir(lista) {
            if (!storage) return;
            try {
                storage.setItem(cfg.clave, JSON.stringify({ v: cfg.version, items: lista }));
            } catch (e) {
                // Cuota llena o sin permiso: el cambio queda solo en memoria.
            }
        }

        function avisar() {
            const foto = copiar(items);
            oyentes.forEach(fn => {
                try { fn(copiar(foto)); } catch (e) { console.error('[AERIS] Error en un suscriptor:', e); }
            });
        }

        // Otra pestaña cambió la misma clave: recargar y avisar.
        const ventana = cfg.ventana !== undefined ? cfg.ventana
            : (typeof window !== 'undefined' ? window : null);
        if (ventana && storage) {
            ventana.addEventListener('storage', (e) => {
                if (e.key !== cfg.clave && e.key !== null) return; // null = storage.clear()
                items = cargar();
                avisar();
            });
        }

        return {
            /** Copia de la lista actual. */
            leer: () => copiar(items),

            /**
             * Aplica un cambio: recibe una copia de la lista y devuelve la nueva.
             * Guarda y avisa a los suscriptores una sola vez.
             */
            cambiar(fn) {
                const nueva = fn(copiar(items));
                items = nueva.filter(cfg.esValido);
                escribir(items);
                avisar();
            },

            /**
             * Se suscribe al cambio. Llama a fn de inmediato con el estado actual
             * (así la navbar se pinta bien al cargar) y luego en cada cambio.
             * @returns {() => void} función para desuscribirse
             */
            subscribe(fn) {
                oyentes.add(fn);
                try { fn(copiar(items)); } catch (e) { console.error('[AERIS] Error en un suscriptor:', e); }
                return () => oyentes.delete(fn);
            }
        };
    }

    return { crearStorePersistente };
});
