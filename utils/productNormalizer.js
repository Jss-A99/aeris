/**
 * ============================================================================
 * NORMALIZADOR DE PRODUCTOS (MAPPER) — AERIS E-COMMERCE
 * ============================================================================
 * @file utils/productNormalizer.js
 *
 * Funciones PURAS: reciben documentos de Mongo (preferible con .lean()) y
 * devuelven ProductDTO (ver productContract.js). No tocan la base de datos,
 * ni el reloj (salvo el valor por defecto de `ahora`), ni el sistema de archivos.
 * Por eso corren igual en una petición HTTP o en un script de build.
 *
 * USO TÍPICO
 *   const { toProductDTO, toProductDTOList } = require('../utils/productNormalizer');
 *
 *   const crudos = await Product.find({}).lean();
 *   const productos = toProductDTOList(crudos);          // resuelve piezas de conjuntos
 *
 *   const crudo = await Product.findById(id).lean();
 *   const dto = toProductDTO(crudo, { catalogo: crudos }); // conjunto: necesita el catálogo
 * ============================================================================
 */

const { REGLAS } = require('./productContract');

/* ----------------------------------------------------------------------------
   Utilidades pequeñas
   ---------------------------------------------------------------------------- */

const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** Convierte ObjectId, {$oid}, documento poblado o string en un id string. */
function idToString(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number') return String(v);
    if (typeof v === 'object') {
        if (v.$oid) return String(v.$oid);
        // Mongoose añade un getter _id que se devuelve a sí mismo en los ObjectId.
        if (v._id !== undefined && v._id !== v) return idToString(v._id);
        return String(v);
    }
    return String(v);
}

/** Ruta de imagen lista para usar en un <img src>. Nunca devuelve vacío. */
function rutaImagen(img) {
    const s = texto(img);
    if (!s) return REGLAS.IMAGEN_PLACEHOLDER;
    if (/^https?:\/\//i.test(s) || s.startsWith('/')) return s;
    return REGLAS.IMAGEN_BASE + s;
}

/** "#FFF" | "ffffff" | "#FFFFFF" → "#fff" | "#ffffff". Valor inválido → color por defecto. */
function normalizarHex(h) {
    const s = texto(h);
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s.toLowerCase();
    if (/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return '#' + s.toLowerCase();
    return REGLAS.HEX_POR_DEFECTO;
}

/**
 * Orden de presentación. Manda la columna "Orden" de la tabla TALLAS (`orden`: Map o objeto
 * talla → número). Lo que no figure allí va después: letras conocidas (ORDEN_TALLAS),
 * numéricas ascendentes y el resto A-Z.
 */
function ordenarTallas(tallas, orden) {
    const mapa = orden instanceof Map ? orden : new Map(Object.entries(orden || {}));
    const rango = (t) => {
        if (mapa.has(t)) return [0, Number(mapa.get(t))];
        const i = REGLAS.ORDEN_TALLAS.indexOf(t);
        if (i >= 0) return [1, i];
        if (/^\d+(\.\d+)?$/.test(t)) return [2, Number(t)];
        return [3, 0];
    };
    return [...tallas].sort((a, b) => {
        const ra = rango(a);
        const rb = rango(b);
        return (ra[0] - rb[0]) || (ra[1] - rb[1]) || a.localeCompare(b);
    });
}

function fechaMs(v) {
    if (!v) return null;
    const d = v.$date ? new Date(v.$date) : new Date(v);
    const t = d.getTime();
    return Number.isNaN(t) ? null : t;
}

const unicos = (lista) => [...new Set(lista)];

/** "Vestido Midi Abertura" → "vestido-midi-abertura" (sin tildes ni símbolos). */
function slugificar(s) {
    return texto(s)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/* ----------------------------------------------------------------------------
   Reglas de dominio (única implementación)
   ---------------------------------------------------------------------------- */

function esConjuntoRaw(raw) {
    return Boolean(raw && raw.esConjunto) || texto(raw && raw.categoria).toLowerCase() === REGLAS.CATEGORIA_CONJUNTOS;
}

/** "Nuevo" es una decisión humana (casilla de la hoja), no un cálculo por fechas. */
const esNuevoRaw = (raw) => raw.nuevo === true;

/** Documentos antiguos (sin el campo) se consideran publicados; el sync siempre lo escribe. */
const esPublicadoRaw = (raw) => raw.publicado !== false;

/**
 * Precio y precio anterior (el que se muestra tachado). La tienda NO muestra porcentaje de
 * descuento: solo el precio tachado. Una diferencia de menos del 1 % no cuenta como descuento.
 */
function calcularPrecios(raw) {
    const precio = Math.max(0, Number(raw.precio) || 0);
    const anterior = Number(raw.precioAnterior);
    const esDescuento = Number.isFinite(anterior) && anterior > precio && (anterior - precio) / anterior >= 0.01;
    return { precio, precioAnterior: esDescuento ? anterior : null };
}

function construirGaleria(raw) {
    const fotos = [raw.imagenPrincipal, ...(Array.isArray(raw.imagenesSecundarias) ? raw.imagenesSecundarias : [])]
        .map(texto)
        .filter(Boolean)
        .map(rutaImagen);
    const galeria = unicos(fotos);
    return galeria.length > 0 ? galeria : [REGLAS.IMAGEN_PLACEHOLDER];
}

/**
 * Normaliza variantes y deriva colores/tallas a partir de ellas.
 * Garantías: grafía única de color (la primera vista), tallas en MAYÚSCULAS,
 * stock entero >= 0, imágenes siempre presentes.
 */
function normalizarVariantes(rawVariantes, imagenProducto, ordenTallas) {
    const canonico = new Map();   // clave en minúsculas → ColorDTO
    const variantes = [];
    const tallas = new Set();

    for (const v of (Array.isArray(rawVariantes) ? rawVariantes : [])) {
        if (!v) continue;

        const colorOriginal = texto(v.color);
        const clave = colorOriginal.toLowerCase();
        const talla = texto(v.talla).toUpperCase();
        const imagen = texto(v.imagen) ? rutaImagen(v.imagen) : imagenProducto;
        const hex = normalizarHex(v.hex);
        const familia = texto(v.familia).toLowerCase();
        const stock = Math.max(0, Math.floor(Number(v.stock) || 0));

        let color = '';
        if (clave) {
            if (!canonico.has(clave)) {
                canonico.set(clave, { nombre: colorOriginal, hex, imagen, familia });
            }
            color = canonico.get(clave).nombre;
        }
        if (talla) tallas.add(talla);

        variantes.push({
            color,
            hex: clave ? canonico.get(clave).hex : hex,
            familia,
            talla,
            stock,
            ultimasUnidades: stock >= 1 && stock <= REGLAS.UMBRAL_ULTIMAS_UNIDADES,
            imagen
        });
    }

    return {
        variantes,
        colores: [...canonico.values()],
        tallas: ordenarTallas([...tallas], ordenTallas)
    };
}

/* ----------------------------------------------------------------------------
   Construcción del DTO
   ---------------------------------------------------------------------------- */

/** Campos comunes (prenda o conjunto) a partir de un documento crudo. */
function construirBase(raw, ordenTallas, tipo) {
    const id = idToString(raw._id !== undefined ? raw._id : raw.id);
    const galeria = construirGaleria(raw);
    const imagen = galeria[0];
    const { variantes, colores, tallas } = normalizarVariantes(raw.variantes, imagen, ordenTallas);
    const { precio, precioAnterior } = calcularPrecios(raw);
    const creadoMs = fechaMs(raw.createdAt);
    const stockTotal = variantes.reduce((suma, v) => suma + v.stock, 0);

    // La familia de una prenda sale de sus variantes. `familiaColor` (array) solo se lee
    // en documentos antiguos que todavía no pasaron por el sync nuevo.
    const deVariantes = unicos(variantes.map(v => v.familia).filter(Boolean));
    const antiguas = Array.isArray(raw.familiaColor) ? raw.familiaColor : (raw.familiaColor ? [raw.familiaColor] : []);
    const familiasColor = deVariantes.length > 0
        ? deVariantes
        : unicos(antiguas.map(c => texto(c).toLowerCase()).filter(Boolean));

    const sku = raw.idExcel === undefined || raw.idExcel === null || Number.isNaN(Number(raw.idExcel)) ? null : Number(raw.idExcel);
    const slug = slugificar(raw.nombre);
    const urlId = sku === null ? id : (slug ? `${sku}-${slug}` : String(sku));

    return {
        id,
        urlId,
        sku,
        tipo,
        nombre: texto(raw.nombre) || (tipo === 'conjunto' ? 'Conjunto AERIS' : 'Prenda AERIS'),
        descripcion: texto(raw.descripcion),
        categoria: texto(raw.categoria).toLowerCase(),
        precio,
        precioAnterior,
        esNuevo: esNuevoRaw(raw),
        publicado: esPublicadoRaw(raw),
        creadoEn: creadoMs === null ? null : new Date(creadoMs).toISOString(),
        imagen,
        galeria,
        familiasColor,
        colores,
        tallas,
        variantes,
        stockTotal,
        agotado: stockTotal <= 0,
        piezas: [],
        url: (tipo === 'conjunto' ? REGLAS.RUTA_CONJUNTO : REGLAS.RUTA_PRENDA) + urlId
    };
}

function aPieza(base) {
    return {
        id: base.id,
        nombre: base.nombre,
        imagen: base.imagen,
        url: base.url,
        colores: base.colores,
        tallas: base.tallas,
        variantes: base.variantes,
        // Una pieza no publicada no se puede comprar: el conjunto queda agotado.
        agotado: base.agotado || !base.publicado
    };
}

/** Índice para resolver las piezas de los conjuntos sin necesidad de populate(). */
function crearIndice(catalogo) {
    const porId = new Map();
    const porSku = new Map();
    for (const raw of (Array.isArray(catalogo) ? catalogo : [])) {
        if (!raw) continue;
        porId.set(idToString(raw._id !== undefined ? raw._id : raw.id), raw);
        if (raw.idExcel !== undefined && raw.idExcel !== null) porSku.set(Number(raw.idExcel), raw);
    }
    return { porId, porSku };
}

/**
 * Piezas de un conjunto, en el orden de la hoja.
 * Fuente de verdad: productosIncluidosIds (los ids de Sheets, que el sync
 * reescribe SIEMPRE). productosIncluidos (ObjectId) es una caché derivada que
 * puede quedar obsoleta, así que solo se usa si los ids no resuelven nada.
 */
function resolverPiezas(raw, indice) {
    const encontradas = [];
    const vistos = new Set();
    const agregar = (r) => {
        if (!r || esConjuntoRaw(r)) return;      // un conjunto no puede contener otro conjunto
        const id = idToString(r._id !== undefined ? r._id : r.id);
        if (!id || vistos.has(id)) return;
        vistos.add(id);
        encontradas.push(r);
    };

    (Array.isArray(raw.productosIncluidosIds) ? raw.productosIncluidosIds : [])
        .forEach(sku => agregar(indice.porSku.get(Number(sku))));

    if (encontradas.length === 0) {
        (Array.isArray(raw.productosIncluidos) ? raw.productosIncluidos : []).forEach(ref => {
            const poblado = ref && typeof ref === 'object' && (ref.nombre !== undefined || ref.variantes !== undefined);
            agregar(poblado ? ref : indice.porId.get(idToString(ref)));
        });
    }
    return encontradas;
}

/**
 * Documento crudo → ProductDTO (o null si no tiene id).
 *
 * @param {Object} raw
 * @param {Object} [opciones]
 * @param {Object[]} [opciones.catalogo] Documentos crudos donde buscar las piezas de un conjunto.
 * @param {Object}   [opciones.indice]   Resultado de crearIndice() (evita reconstruirlo en listas).
 * @param {Map<string,number>|Object} [opciones.ordenTallas] Orden de la tabla TALLAS (talla → orden).
 * @param {boolean} [opciones.incluirNoPublicados=false] Solo toProductDTOList.
 * @returns {import('./productContract').ProductDTO|null}
 */
function toProductDTO(raw, opciones = {}) {
    if (!raw || typeof raw !== 'object') return null;

    const esConjunto = esConjuntoRaw(raw);
    const base = construirBase(raw, opciones.ordenTallas, esConjunto ? 'conjunto' : 'prenda');
    if (!base.id) return null;
    if (!esConjunto) return base;

    const indice = opciones.indice || crearIndice(opciones.catalogo);
    const piezasBase = resolverPiezas(raw, indice)
        .map(r => construirBase(r, opciones.ordenTallas, 'prenda'))
        .filter(p => p.id);
    const piezas = piezasBase.map(aPieza);

    // Agregados para filtros y tarjetas: unión de lo que ofrecen las piezas.
    const colores = [];
    const vistosColor = new Set();
    piezasBase.forEach(p => p.colores.forEach(c => {
        const clave = c.nombre.toLowerCase();
        if (!vistosColor.has(clave)) { vistosColor.add(clave); colores.push(c); }
    }));

    return {
        ...base,
        familiasColor: unicos([...base.familiasColor, ...piezasBase.flatMap(p => p.familiasColor)]),
        colores,
        tallas: ordenarTallas(unicos(piezasBase.flatMap(p => p.tallas)), opciones.ordenTallas),
        variantes: [],
        stockTotal: null,
        agotado: piezas.length === 0 || piezas.some(p => p.agotado),
        piezas
    };
}

/**
 * Lista cruda → lista de DTO. Construye el índice una sola vez y descarta docs sin id.
 * Por defecto SOLO devuelve productos publicados; las piezas de un conjunto se resuelven
 * contra el catálogo completo (así un conjunto sabe si una pieza fue despublicada).
 */
function toProductDTOList(rawList, opciones = {}) {
    const lista = Array.isArray(rawList) ? rawList : [];
    const indice = opciones.indice || crearIndice(lista);
    return lista
        .map(raw => toProductDTO(raw, { ...opciones, indice }))
        .filter(dto => dto && (opciones.incluirNoPublicados === true || dto.publicado));
}

module.exports = {
    toProductDTO,
    toProductDTOList,
    crearIndice,
    // Exportados para pruebas y para otros módulos del servidor:
    idToString,
    rutaImagen,
    normalizarHex,
    ordenarTallas,
    slugificar
};
