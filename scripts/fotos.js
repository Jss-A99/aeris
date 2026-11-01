/**
 * scripts/fotos.js — AERIS E-commerce
 *
 *   npm run fotos
 *
 * Copia las fotos de la carpeta de Google Drive (sincronizada con "Google Drive para
 * escritorio") a public/images/productos, y revisa:
 *  - nombres que la web no puede usar bien (espacios, tildes, mayúsculas);
 *  - fotos muy pesadas o con proporción distinta a 3:4 (vertical);
 *  - fotos que la hoja menciona pero no están en Drive (si hay conexión a MongoDB).
 *
 * Carpeta de origen: variable FOTOS_DRIVE en el .env, o por defecto "G:/Mi unidad/AERIS/PRODUCTOS".
 * Solo copia lo nuevo o cambiado. Nunca borra nada.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const ORIGEN = process.env.FOTOS_DRIVE || 'G:/Mi unidad/AERIS/PRODUCTOS';
const DESTINO = path.join(__dirname, '..', 'public', 'images', 'productos');
const EXTENSIONES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const PESO_MAXIMO = 400 * 1024;     // 400 KB
const PROPORCION = 3 / 4;           // ancho / alto de las tarjetas

/** Ancho y alto leyendo solo la cabecera del archivo (JPG y PNG). null si no se puede. */
function medidas(archivo) {
    const b = fs.readFileSync(archivo);
    if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') {
        return { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
        let i = 2;
        while (i < b.length) {
            if (b[i] !== 0xff) { i++; continue; }
            const marca = b[i + 1];
            const largo = b.readUInt16BE(i + 2);
            if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca)) {
                return { alto: b.readUInt16BE(i + 5), ancho: b.readUInt16BE(i + 7) };
            }
            i += 2 + largo;
        }
    }
    return null;
}

/** Nombres que la hoja menciona (imagen principal, secundarias y de variantes). */
async function fotosDeLaHoja() {
    const { aplicarDnsOpcional, conectar, desconectar } = require('../config/database');
    aplicarDnsOpcional();
    await conectar();
    try {
        const repo = require('../repositories/productRepository');
        const productos = await repo.listarTodos();
        const nombres = new Set();
        const sumar = (v) => { const s = String(v || '').trim(); if (s && !/^https?:\/\//i.test(s)) nombres.add(path.basename(s)); };
        productos.forEach(p => {
            sumar(p.imagenPrincipal);
            (p.imagenesSecundarias || []).forEach(sumar);
            (p.variantes || []).forEach(v => sumar(v.imagen));
        });
        return nombres;
    } finally {
        await desconectar();
    }
}

async function main() {
    if (!fs.existsSync(ORIGEN)) {
        console.error(`No encuentro la carpeta de fotos: ${ORIGEN}`);
        console.error('¿Está abierto "Google Drive para escritorio"? Si la carpeta está en otro lugar, ponla en el .env: FOTOS_DRIVE=G:/Mi unidad/...');
        process.exit(1);
    }
    fs.mkdirSync(DESTINO, { recursive: true });

    const archivos = fs.readdirSync(ORIGEN).filter(n => EXTENSIONES.has(path.extname(n).toLowerCase()));
    let copiadas = 0, iguales = 0;
    const avisos = [];

    for (const nombre of archivos) {
        const desde = path.join(ORIGEN, nombre);
        const hacia = path.join(DESTINO, nombre);
        const info = fs.statSync(desde);

        if (/[^a-z0-9._-]/.test(nombre)) avisos.push(`${nombre}: usa solo minúsculas, números y guiones (sin espacios ni tildes).`);
        if (info.size > PESO_MAXIMO) avisos.push(`${nombre}: pesa ${Math.round(info.size / 1024)} KB; conviene menos de ${PESO_MAXIMO / 1024} KB para que cargue rápido.`);
        const m = medidas(desde);
        if (m) {
            if (Math.abs(m.ancho / m.alto - PROPORCION) > 0.03) avisos.push(`${nombre}: mide ${m.ancho}×${m.alto}; la tarjeta es vertical 3:4 (ej. 1200×1600) y se recortará.`);
            if (m.ancho < 900) avisos.push(`${nombre}: tiene ${m.ancho} px de ancho; en pantallas grandes se verá borrosa (mejor 1200 px).`);
        }

        const destinoInfo = fs.existsSync(hacia) ? fs.statSync(hacia) : null;
        if (destinoInfo && destinoInfo.size === info.size && destinoInfo.mtimeMs >= info.mtimeMs) { iguales++; continue; }
        fs.copyFileSync(desde, hacia);
        fs.utimesSync(hacia, info.atime, info.mtime);
        copiadas++;
    }

    console.log(`Fotos en Drive: ${archivos.length} · copiadas: ${copiadas} · sin cambios: ${iguales}`);
    if (avisos.length) {
        console.log('\nRevisa:');
        avisos.forEach(a => console.log('  - ' + a));
    }

    try {
        const enHoja = await fotosDeLaHoja();
        const disponibles = new Set(fs.readdirSync(DESTINO));
        const faltan = [...enHoja].filter(n => !disponibles.has(n));
        if (faltan.length) {
            console.log('\nLa hoja menciona estas fotos, pero no están en Drive (revisa el nombre exacto):');
            faltan.forEach(n => console.log('  - ' + n));
        } else {
            console.log('\nTodas las fotos que menciona la hoja están en la carpeta.');
        }
    } catch (e) {
        console.log(`\n(No se revisó contra la hoja: no hubo conexión con MongoDB. ${e.message})`);
    }
}

main().catch(e => { console.error(e.message); process.exit(1); });
