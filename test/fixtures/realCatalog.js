/**
 * test/fixtures/realCatalog.js — DATOS REALES de AERIS
 *
 * - hojaProductos / hojaVariantes / hojaCategorias / hojaFamilias / hojaTallas: lo que envía
 *   Apps Script (getValues → un objeto por fila, con el encabezado como clave; celdas vacías = "";
 *   `_fila` = número de fila en la hoja). GENERADO desde "AERIS - INVENTARIO.xlsx" (hoja ya migrada
 *   al contrato nuevo), sin retoques.
 * - mongoPrendaReal / mongoConjuntoReal: documentos del diseño ANTERIOR copiados TAL CUAL de MongoDB
 *   Atlas (JSON extendido: _id.$oid, createdAt.$date). Sirven para comprobar que el mapper
 *   sigue leyendo documentos que aún no pasaron por el sync nuevo.
 */

const hojaProductos = [
    {
        "Producto_ID": 1,
        "Nombre Producto": "Blusa Seda Básica",
        "Descripción": "Blusa elegante de seda con acabado suave y caída fluida.",
        "Categoría": "blusas",
        "Precio": 79.9,
        "Precio Anterior": "",
        "Nuevo": false,
        "Publicado": true,
        "Imagen Principal": "blusa-seda-blanca.jpg",
        "Imágenes Secundarias": "blusa-seda-blanca.jpg, blusa-seda-negra.jpg",
        "Productos Incluidos": "",
        "_fila": 2
    },
    {
        "Producto_ID": 2,
        "Nombre Producto": "Pantalón Sastre Ancho",
        "Descripción": "Pantalón de tiro alto con pinzas frontales.",
        "Categoría": "pantalones",
        "Precio": 99.9,
        "Precio Anterior": 129.9,
        "Nuevo": false,
        "Publicado": true,
        "Imagen Principal": "pantalon-sastre-negro.jpg",
        "Imágenes Secundarias": "pantalon-sastre-negro.jpg, pantalon-sastre-beige.jpg",
        "Productos Incluidos": "",
        "_fila": 3
    },
    {
        "Producto_ID": 3,
        "Nombre Producto": "Pantalón Cargo Urbano",
        "Descripción": "Pantalón funcional estilo cargo con bolsillos laterales.",
        "Categoría": "pantalones",
        "Precio": 85,
        "Precio Anterior": 110,
        "Nuevo": false,
        "Publicado": true,
        "Imagen Principal": "pantalon-cargo-verde.jpg",
        "Imágenes Secundarias": "pantalon-cargo-verde.jpg",
        "Productos Incluidos": "",
        "_fila": 4
    },
    {
        "Producto_ID": 4,
        "Nombre Producto": "Vestido Midi Abertura",
        "Descripción": "Vestido sofisticado de longitud midi con abertura lateral.",
        "Categoría": "vestidos",
        "Precio": 109.9,
        "Precio Anterior": "",
        "Nuevo": false,
        "Publicado": true,
        "Imagen Principal": "vestido-midi-negro.jpg",
        "Imágenes Secundarias": "vestido-midi-negro.jpg, vestido-midi-vino.jpg",
        "Productos Incluidos": "",
        "_fila": 5
    },
    {
        "Producto_ID": 5,
        "Nombre Producto": "Vestido Lino Cruzado",
        "Descripción": "Vestido ligero estilo wrap en tejido de lino natural.",
        "Categoría": "vestidos",
        "Precio": 89.9,
        "Precio Anterior": 119.9,
        "Nuevo": false,
        "Publicado": true,
        "Imagen Principal": "vestido-lino-crema.jpg",
        "Imágenes Secundarias": "vestido-lino-crema.jpg",
        "Productos Incluidos": "",
        "_fila": 6
    },
    {
        "Producto_ID": 6,
        "Nombre Producto": "Conjunto Sastre Urbano",
        "Descripción": "Look coordinado de dos piezas que combina Blusa y Pantalón.",
        "Categoría": "conjuntos",
        "Precio": 169.9,
        "Precio Anterior": "",
        "Nuevo": false,
        "Publicado": true,
        "Imagen Principal": "pantalon-sastre-negro.jpg",
        "Imágenes Secundarias": "pantalon-sastre-negro.jpg, blusa-seda-blanca.jpg",
        "Productos Incluidos": "1, 2",
        "_fila": 7
    }
];

const hojaVariantes = [
    {
        "Producto_ID": 1,
        "Color Variante": "Blanco",
        "HEX Variante": "#FFFFFF",
        "Familia": "Blanco",
        "Talla": "XXL",
        "Stock": 8,
        "Imagen Variante": "blusa-seda-blanca.jpg",
        "_fila": 2
    },
    {
        "Producto_ID": 1,
        "Color Variante": "Blanco",
        "HEX Variante": "#FFFFFF",
        "Familia": "Blanco",
        "Talla": "M",
        "Stock": 4,
        "Imagen Variante": "blusa-seda-blanca.jpg",
        "_fila": 3
    },
    {
        "Producto_ID": 1,
        "Color Variante": "Negro",
        "HEX Variante": "#171717",
        "Familia": "Negro",
        "Talla": "XXL",
        "Stock": 5,
        "Imagen Variante": "blusa-seda-negra.jpg",
        "_fila": 4
    },
    {
        "Producto_ID": 1,
        "Color Variante": "Negro",
        "HEX Variante": "#171717",
        "Familia": "Negro",
        "Talla": "M",
        "Stock": 2,
        "Imagen Variante": "blusa-seda-negra.jpg",
        "_fila": 5
    },
    {
        "Producto_ID": 2,
        "Color Variante": "Negro",
        "HEX Variante": "#171717",
        "Familia": "Negro",
        "Talla": 36,
        "Stock": 3,
        "Imagen Variante": "pantalon-sastre-negro.jpg",
        "_fila": 6
    },
    {
        "Producto_ID": 2,
        "Color Variante": "Negro",
        "HEX Variante": "#171717",
        "Familia": "Negro",
        "Talla": 30,
        "Stock": 7,
        "Imagen Variante": "pantalon-sastre-negro.jpg",
        "_fila": 7
    },
    {
        "Producto_ID": 2,
        "Color Variante": "Beige",
        "HEX Variante": "#D4C3B3",
        "Familia": "Beige",
        "Talla": 32,
        "Stock": 6,
        "Imagen Variante": "pantalon-sastre-beige.jpg",
        "_fila": 8
    },
    {
        "Producto_ID": 2,
        "Color Variante": "Beige",
        "HEX Variante": "#D4C3B3",
        "Familia": "Beige",
        "Talla": 30,
        "Stock": 2,
        "Imagen Variante": "pantalon-sastre-beige.jpg",
        "_fila": 9
    },
    {
        "Producto_ID": 3,
        "Color Variante": "Verde Kaki",
        "HEX Variante": "#4A5240",
        "Familia": "Verde",
        "Talla": 36,
        "Stock": 1,
        "Imagen Variante": "pantalon-cargo-verde.jpg",
        "_fila": 10
    },
    {
        "Producto_ID": 3,
        "Color Variante": "Verde Kaki",
        "HEX Variante": "#4A5240",
        "Familia": "Verde",
        "Talla": 34,
        "Stock": 2,
        "Imagen Variante": "pantalon-cargo-verde.jpg",
        "_fila": 11
    },
    {
        "Producto_ID": 4,
        "Color Variante": "Negro",
        "HEX Variante": "#171717",
        "Familia": "Negro",
        "Talla": "XXL",
        "Stock": 5,
        "Imagen Variante": "vestido-midi-negro.jpg",
        "_fila": 12
    },
    {
        "Producto_ID": 4,
        "Color Variante": "Negro",
        "HEX Variante": "#171717",
        "Familia": "Negro",
        "Talla": "M",
        "Stock": 7,
        "Imagen Variante": "vestido-midi-negro.jpg",
        "_fila": 13
    },
    {
        "Producto_ID": 4,
        "Color Variante": "Vino",
        "HEX Variante": "#581825",
        "Familia": "Vino",
        "Talla": "XL",
        "Stock": 3,
        "Imagen Variante": "vestido-midi-vino.jpg",
        "_fila": 14
    },
    {
        "Producto_ID": 5,
        "Color Variante": "Blanco Crema",
        "HEX Variante": "#F4F1EA",
        "Familia": "Blanco",
        "Talla": "XXL",
        "Stock": 4,
        "Imagen Variante": "vestido-lino-crema.jpg",
        "_fila": 15
    },
    {
        "Producto_ID": 5,
        "Color Variante": "Blanco Crema",
        "HEX Variante": "#F4F1EA",
        "Familia": "Blanco",
        "Talla": "M",
        "Stock": 6,
        "Imagen Variante": "vestido-lino-crema.jpg",
        "_fila": 16
    }
];

const hojaCategorias = [
    {
        "Categoría": "blusas",
        "Nombre visible": "Blusas",
        "Orden": 1,
        "Contiene piezas": false,
        "_fila": 2
    },
    {
        "Categoría": "pantalones",
        "Nombre visible": "Pantalones",
        "Orden": 2,
        "Contiene piezas": false,
        "_fila": 3
    },
    {
        "Categoría": "vestidos",
        "Nombre visible": "Vestidos",
        "Orden": 3,
        "Contiene piezas": false,
        "_fila": 4
    },
    {
        "Categoría": "conjuntos",
        "Nombre visible": "Conjuntos",
        "Orden": 4,
        "Contiene piezas": true,
        "_fila": 5
    }
];

const hojaFamilias = [
    {
        "Familia": "Negro",
        "HEX muestra": "#171717",
        "_fila": 2
    },
    {
        "Familia": "Blanco",
        "HEX muestra": "#FFFFFF",
        "_fila": 3
    },
    {
        "Familia": "Beige",
        "HEX muestra": "#D4C3B3",
        "_fila": 4
    },
    {
        "Familia": "Verde",
        "HEX muestra": "#4A5240",
        "_fila": 5
    },
    {
        "Familia": "Vino",
        "HEX muestra": "#581825",
        "_fila": 6
    }
];

const hojaTallas = [
    {
        "Talla": "S",
        "Orden": 1,
        "_fila": 2
    },
    {
        "Talla": "M",
        "Orden": 2,
        "_fila": 3
    },
    {
        "Talla": "L",
        "Orden": 3,
        "_fila": 4
    },
    {
        "Talla": "XL",
        "Orden": 4,
        "_fila": 5
    },
    {
        "Talla": "XXL",
        "Orden": 5,
        "_fila": 6
    },
    {
        "Talla": "3XL",
        "Orden": 6,
        "_fila": 7
    },
    {
        "Talla": 28,
        "Orden": 20,
        "_fila": 8
    },
    {
        "Talla": 30,
        "Orden": 21,
        "_fila": 9
    },
    {
        "Talla": 32,
        "Orden": 22,
        "_fila": 10
    },
    {
        "Talla": 34,
        "Orden": 23,
        "_fila": 11
    },
    {
        "Talla": 36,
        "Orden": 24,
        "_fila": 12
    },
    {
        "Talla": 38,
        "Orden": 25,
        "_fila": 13
    }
];

const mongoConjuntoReal = {
    _id: { $oid: '6ad800aee46279ad1388e4a3' },
    idExcel: 6,
    nombre: 'Conjunto Sastre Urbano',
    descripcion: 'Look coordinado de dos piezas que combina Blusa y Pantalón.',
    precio: 169.9,
    precioAnterior: null,
    categoria: 'conjuntos',
    familiaColor: ['blanco', 'negro', 'beige'],
    imagenPrincipal: 'pantalon-sastre-negro.jpg',
    imagenesSecundarias: ['pantalon-sastre-negro.jpg', 'blusa-seda-blanca.jpg'],
    etiquetas: [],
    esConjunto: true,
    productosIncluidosIds: [1, 2],
    productosIncluidos: [{ $oid: '6ad800aee46279ad1388e49e' }, { $oid: '6ad800aee46279ad1388e49f' }],
    variantes: [],
    __v: 0,
    createdAt: { $date: '2026-10-21T00:00:46.846Z' },
    updatedAt: { $date: '2026-10-24T18:29:23.900Z' }
};

const mongoPrendaReal = {
    _id: { $oid: '6ad800aee46279ad1388e4a1' },
    idExcel: 4,
    nombre: 'Vestido Midi Abertura',
    descripcion: 'Vestido sofisticado de longitud midi con abertura lateral.',
    precio: 109.9,
    precioAnterior: null,
    categoria: 'vestidos',
    familiaColor: ['negro'],
    imagenPrincipal: 'vestido-midi-negro.jpg',
    imagenesSecundarias: ['vestido-midi-negro.jpg', 'vestido-midi-vino.jpg'],
    etiquetas: [],
    esConjunto: false,
    productosIncluidosIds: [],
    productosIncluidos: [],
    variantes: [
        { color: 'Negro', hex: '#171717', talla: 'XXL', stock: 5, imagen: 'vestido-midi-negro.jpg' },
        { color: 'Negro', hex: '#171717', talla: 'M', stock: 7, imagen: 'vestido-midi-negro.jpg' },
        { color: 'Vino', hex: '#581825', talla: 'XL', stock: 3, imagen: 'vestido-midi-vino.jpg' }
    ],
    __v: 0,
    createdAt: { $date: '2026-10-21T00:00:46.846Z' },
    updatedAt: { $date: '2026-10-24T18:29:23.700Z' }
};

module.exports = { hojaProductos, hojaVariantes, hojaCategorias, hojaFamilias, hojaTallas, mongoPrendaReal, mongoConjuntoReal };
