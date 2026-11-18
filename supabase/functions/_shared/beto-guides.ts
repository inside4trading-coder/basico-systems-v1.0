// Guías del sistema para [B]eto: cómo se hace cada cosa, con las etiquetas
// exactas de los botones entre «comillas». Una guarda vitest
// (beto-guides.test.ts) comprueba que cada ruta exista, que cada capacidad
// exista y que cada «etiqueta» aparezca literal en la app: si alguien cambia un
// botón, el test avisa para actualizar la guía.
//
// Sin imports: la usan la edge function (Deno) y la app (Vite).

export type GuideModule = "pos" | "inventario" | "administracion" | "reportes" | "fichaje" | "estudio" | "cashea" | "beto";

export interface Guide {
  id: string;
  titulo: string;
  /** Cómo lo pregunta la gente; ayuda al modelo a elegir la guía. */
  cuando: string[];
  /** Pantalla a la que lleva el botón «Ir a…». */
  ruta: string;
  /** Texto del botón (sin el «Ir a»). */
  destino: string;
  /** Capacidad que hace falta para hacerlo; sin ella, cualquiera del equipo. */
  capacidad?: string;
  modulo?: GuideModule;
  pasos: string[];
  /** Aclaraciones: diferencias con otras pantallas, qué no existe todavía. */
  notas?: string[];
}

export const GUIDES: Guide[] = [
  // ── Arranque ────────────────────────────────────────────────────────────
  {
    id: "primeros_pasos",
    titulo: "Primeros pasos: configurar el negocio",
    cuando: ["por dónde empiezo", "cómo configuro el sistema", "soy nuevo", "qué tengo que hacer primero"],
    ruta: "/bienvenida",
    destino: "Primeros pasos",
    capacidad: "config.negocio",
    pasos: [
      "Abre Inicio → Primeros pasos. Son 3 pasos y puedes dejar alguno para después.",
      "«Tu negocio»: nombre comercial, razón social, RIF, teléfono, dirección, la sede principal (se crea con su «Caja 1») y la tasa del día. Pulsa «Guardar y continuar».",
      "«Tus productos»: elige «Importar desde Excel» o «Crear un producto».",
      "«Tu equipo»: invita a tus empleados con su correo y rol.",
      "Al final: «Abrir el punto de venta» o «Ir al inicio».",
    ],
    notas: [
      "Orden recomendado después: crear al menos una cuenta en Administración → Cuentas (para cobrar y pagar), revisar métodos de pago y cargar el inventario.",
    ],
  },
  {
    id: "datos_negocio",
    titulo: "Datos del negocio (nombre, RIF, dirección)",
    cuando: ["cambiar el nombre del negocio", "poner el RIF", "datos fiscales del ticket"],
    ruta: "/configuracion#negocio",
    destino: "Datos del negocio",
    capacidad: "config.negocio",
    pasos: ["Abre Configuración → Datos del negocio.", "Edita los datos y guarda. Salen en los tickets y notas de entrega."],
  },
  {
    id: "sedes_cajas",
    titulo: "Sedes y cajas",
    cuando: ["crear una sede", "agregar una tienda", "crear una caja", "no hay cajas activas"],
    ruta: "/sedes",
    destino: "Sedes y cajas",
    capacidad: "config.sedes",
    pasos: [
      "Abre Configuración → Sedes y cajas.",
      "Para una sede nueva llena el formulario «Nueva sede» (puedes usar «Usar mi ubicación») y pulsa «Crear sede».",
      "En cada sede, «Agregar caja» crea una caja para el punto de venta.",
    ],
    notas: ["Si el POS dice «No hay cajas activas», falta crear una caja aquí."],
  },
  {
    id: "tasa",
    titulo: "Tasa de cambio (BCV o propia)",
    cuando: ["cómo se actualiza la tasa", "la tasa está vieja", "por qué sale la tasa de otro día", "poner tasa manual"],
    ruta: "/configuracion#tasa",
    destino: "Tasa de cambio",
    capacidad: "config.negocio",
    pasos: [
      "Abre Configuración → Tasa de cambio.",
      "Con tasa BCV el sistema la trae solo varias veces al día. «Actualizar tasa ahora» la busca en el momento y «Probar conexión» revisa que el BCV responda.",
      "Si el BCV falla, «Guardar tasa de emergencia» con «Bolívares por 1 USD» y el «Motivo».",
    ],
    notas: [
      "El BCV publica la tasa un día hábil antes con una fecha valor. El sistema la guarda al publicarse pero la aplica desde su fecha valor: la publicada el viernes rige el lunes, y el fin de semana sigue la del viernes.",
    ],
  },
  {
    id: "impuestos",
    titulo: "Impuestos (IVA, exento, IGTF)",
    cuando: ["cambiar el IVA", "producto exento", "IGTF", "agregar un impuesto"],
    ruta: "/configuracion#impuestos",
    destino: "Impuestos",
    capacidad: "config.negocio",
    pasos: [
      "Abre Configuración → Impuestos.",
      "Para uno nuevo escribe el nombre y el % y pulsa «Agregar». Marca cuál es el de por defecto.",
      "El IGTF se ajusta en «IGTF %».",
      "A cada producto se le puede asignar su impuesto (si no, usa el de por defecto).",
      "Para vender también con nota de entrega (sin IVA), activa «Vender con nota de entrega». En el POS, arriba del total, elige «Factura» o «Nota de entrega».",
    ],
    notas: [
      "Los precios se cargan SIN IVA y el POS suma el IVA del producto al cobrar. Ej.: 40 sin IVA con 16 % → el cliente paga 46,40.",
      "Con «Nota de entrega» el POS no suma el IVA (40 → paga 40); con «Factura» lo suma (40 → 46,40). Esas ventas no entran al reporte de IVA: salen aparte. El IGTF sigue igual porque depende del pago.",
      "Vender sin IVA es decisión y responsabilidad del negocio: recomienda revisarlo con su contador.",
      "Todavía no hay conexión a máquina fiscal ni imprenta digital: la factura fiscal se emite aparte y su número se anota en la venta. Si lo piden, di que está anotado como mejora.",
    ],
  },
  {
    id: "metodos_pago",
    titulo: "Métodos de pago",
    cuando: ["agregar pago móvil", "agregar zelle", "métodos de pago", "cobrar con punto de venta"],
    ruta: "/configuracion#pagos",
    destino: "Métodos de pago",
    capacidad: "config.negocio",
    pasos: ["Abre Configuración → Métodos de pago.", "Escribe el «Nuevo método», su moneda y tipo, y pulsa «Agregar»."],
  },
  {
    id: "equipo",
    titulo: "Invitar al equipo y permisos por rol",
    cuando: ["invitar un empleado", "agregar un usuario", "dar permisos", "qué puede ver el cajero"],
    ruta: "/equipo",
    destino: "Equipo",
    capacidad: "equipo.gestionar",
    pasos: [
      "Abre Equipo → Personas, escribe el correo, elige el rol y pulsa «Invitar». La persona recibe un correo y crea su contraseña al entrar.",
      "Puedes limitar a cada persona a ciertas sedes.",
      "La pestaña «Permisos por rol» muestra qué puede hacer cada rol (solo el dueño la edita).",
    ],
  },
  {
    id: "cajeros",
    titulo: "Cajeros y PIN",
    cuando: ["crear un cajero", "PIN de caja", "quién abre la caja"],
    ruta: "/configuracion#cajeros",
    destino: "Cajeros",
    capacidad: "caja.cajeros",
    pasos: ["Abre Configuración → Cajeros.", "Crea a cada cajero con su PIN. Al abrir caja se elige quién la abre."],
  },

  // ── Inventario ──────────────────────────────────────────────────────────
  {
    id: "importar_inventario",
    titulo: "Cargar el inventario desde Excel o CSV",
    cuando: ["cómo cargo el inventario", "subir mis productos", "importar excel", "tengo los productos en excel"],
    ruta: "/inventario/importar",
    destino: "Importar y exportar",
    capacidad: "catalogo.editar",
    modulo: "inventario",
    pasos: [
      "Abre Inventario → Importar y exportar.",
      "Si quieres, descarga una «Plantilla» para llenar. Si ya tienes tu Excel, úsalo tal cual.",
      "Paso «1 · Tu archivo»: elige el archivo (.xlsx, .csv o .txt).",
      "Paso «2 · Así entendimos tu archivo»: revisa qué columna es nombre, código, precio, cantidad y marca; corrige con «Cambiar». Responde «¿El precio ya incluye IVA» y «¿En qué sede está esta mercancía».",
      "Paso «3 · Importar»: revisa y pulsa el botón de importar. Se importa todo o nada.",
    ],
    notas: [
      "Si algo salió mal, en «Importaciones anteriores» se puede deshacer una importación.",
      "Las columnas extra del Excel (ubicación, código original…) quedan como datos del producto. No importes como dato un precio en bolívares: el sistema lo calcula con la tasa del día.",
    ],
  },
  {
    id: "crear_producto",
    titulo: "Crear un producto a mano",
    cuando: ["crear un producto", "agregar un producto nuevo"],
    ruta: "/inventario",
    destino: "Inventario maestro",
    capacidad: "catalogo.editar",
    modulo: "inventario",
    pasos: [
      "Abre Inventario → Inventario maestro y pulsa «Nuevo producto».",
      "Llena nombre, marca, categoría, impuesto y, en cada variante, SKU, «Código de barras», «Precio sin IVA», «Oferta sin IVA» y costo.",
      "Pulsa «Crear producto». La existencia se carga después con una entrada o recepción.",
    ],
  },
  {
    id: "compra_a_credito",
    titulo: "Registrar una compra a proveedor con su mercancía (contado o crédito)",
    cuando: [
      "metí el proveedor pero no pude ingresar la compra",
      "cargar la factura de un proveedor con los productos",
      "compré mercancía a crédito",
      "cómo ingreso la compra al inventario",
      "la compra vino con nota de entrega",
      "cargar una nota de entrega",
    ],
    ruta: "/control?tab=recepcion",
    destino: "Recepción",
    capacidad: "inventario.mover",
    modulo: "inventario",
    pasos: [
      "Abre Inventario → Recepción y elige la sede donde llega la mercancía.",
      "Si es a crédito, activa «A crédito» (necesita permiso de finanzas) y elige el proveedor (o «Nuevo»).",
      "En «Tipo de documento» elige factura fiscal o nota de entrega. Llena el número, el número de control (si trae) y la emisión; el IVA solo va en la factura fiscal (la nota de entrega no lleva IVA).",
      "Busca cada producto y escribe la cantidad recibida y el «Costo de compra».",
      "Pulsa «Confirmar recepción» (o «Confirmar recepción a crédito»).",
      "Listo: la mercancía suma al inventario, el costo de cada producto se actualiza y, si fue a crédito, la factura o nota queda en Administración → Por pagar con su vencimiento.",
      "El precio de venta NO cambia solo: ajústalo en Inventario → Precios.",
    ],
    notas: [
      "Si solo quieres anotar la deuda sin cargar productos, usa Administración → Por pagar → «Nueva factura».",
      "Cuando el proveedor cambie la nota de entrega por la factura, ábrela en Administración → Por pagar y pulsa «Cambiar a factura».",
    ],
  },
  {
    id: "entrada_rapida",
    titulo: "Entrada rápida de mercancía (sin proveedor)",
    cuando: ["sumar existencia", "llegó mercancía", "entrada de inventario"],
    ruta: "/control?tab=entrada",
    destino: "Entrada rápida",
    capacidad: "inventario.mover",
    modulo: "inventario",
    pasos: [
      "Abre Inventario → Entrada rápida y elige la sede.",
      "Escanea o busca el producto, escribe la «Cantidad a ingresar» y pulsa «Agregar a la lista».",
      "Cuando termines, confirma la entrada.",
    ],
    notas: ["Para compras con proveedor, factura o costo, usa Recepción."],
  },
  {
    id: "ajustes_traslados",
    titulo: "Ajustes y traslados entre sedes",
    cuando: ["corregir existencia", "pasar mercancía a otra tienda", "traslado", "ajuste de inventario"],
    ruta: "/control?tab=ajustes",
    destino: "Ajustes",
    capacidad: "inventario.mover",
    modulo: "inventario",
    pasos: [
      "Ajustes: Inventario → Ajustes, elige producto, cantidad y motivo.",
      "Traslados: Inventario → Traslados, elige sede de origen y destino y los productos.",
    ],
  },
  {
    id: "conteos",
    titulo: "Conteos de inventario",
    cuando: ["contar el inventario", "inventario físico", "conteo"],
    ruta: "/control?tab=conteos",
    destino: "Conteos",
    modulo: "inventario",
    pasos: ["Abre Inventario → Conteos, crea el conteo de la sede y registra lo contado. Las diferencias quedan en el historial."],
  },
  {
    id: "precios",
    titulo: "Cambiar precios y ofertas",
    cuando: ["cambiar precio", "subir precios", "poner una oferta", "precio de venta"],
    ruta: "/inventario/precios",
    destino: "Precios",
    capacidad: "catalogo.editar",
    modulo: "inventario",
    pasos: [
      "Abre Inventario → Precios para cambiar precios en lote, o edita el precio en la tabla del Inventario maestro.",
      "La oferta se pone en la ficha del producto («Oferta sin IVA»).",
    ],
    notas: ["Los precios van sin IVA; el PVP y el PVP en Bs (con la tasa del día) se ven en la ficha del producto."],
  },
  {
    id: "etiquetas",
    titulo: "Imprimir etiquetas",
    cuando: ["imprimir etiquetas", "código de barras", "etiqueta de precio"],
    ruta: "/inventario/etiquetas",
    destino: "Etiquetas",
    modulo: "inventario",
    pasos: ["Abre Inventario → Etiquetas, elige los productos y la cantidad, e imprime."],
  },
  {
    id: "campos_catalogo",
    titulo: "Campos propios del catálogo",
    cuando: ["agregar un dato al producto", "ubicación del producto", "borrar un campo importado"],
    ruta: "/catalogo/campos",
    destino: "Campos del catálogo",
    capacidad: "catalogo.editar",
    pasos: ["Abre Inventario → Campos del catálogo para crear, renombrar o quitar datos extra de los productos."],
  },

  // ── Ventas ──────────────────────────────────────────────────────────────
  {
    id: "abrir_caja",
    titulo: "Abrir caja",
    cuando: ["abrir la caja", "empezar a vender", "fondo de caja"],
    ruta: "/pos",
    destino: "Punto de venta",
    capacidad: "pos.vender",
    modulo: "pos",
    pasos: [
      "Abre Comercial → Abrir POS y elige la caja.",
      "Si ya está abierta pulsa «Continuar». Si no, responde «¿Quién abre la caja?», escribe el «Fondo de caja» por moneda y pulsa «Abrir caja».",
    ],
  },
  {
    id: "vender",
    titulo: "Vender y cobrar en el POS",
    cuando: ["cómo vendo", "cobrar", "pago mixto", "cobrar en bolívares y dólares"],
    ruta: "/pos",
    destino: "Punto de venta",
    capacidad: "pos.vender",
    modulo: "pos",
    pasos: [
      "Busca o escanea los productos en el buscador del POS.",
      "Pulsa «Cobrar», elige el método y pulsa «Agregar pago». Puedes combinar varios pagos y monedas.",
      "Pulsa «Finalizar venta».",
    ],
    notas: ["El POS suma el IVA al precio sin IVA y convierte a bolívares con la tasa vigente."],
  },
  {
    id: "devolucion",
    titulo: "Devolución o anulación de una venta",
    cuando: ["devolver una venta", "anular una venta", "el cliente devolvió"],
    ruta: "/pos",
    destino: "Punto de venta",
    capacidad: "ventas.corregir",
    modulo: "pos",
    pasos: ["En el POS, usa «Devolución» o busca la venta en «Historial»."],
  },
  {
    id: "cerrar_caja",
    titulo: "Cerrar caja",
    cuando: ["cerrar la caja", "cuadre de caja", "diferencia en caja"],
    ruta: "/pos",
    destino: "Punto de venta",
    capacidad: "pos.vender",
    modulo: "pos",
    pasos: [
      "En el POS pulsa «Cerrar caja».",
      "Verás «Fondo», «Esperado» y «Diferencia»; escribe lo contado en cada moneda y una nota si hace falta.",
      "Confirma con «Cerrar caja». El cierre queda en Reportes → Cierres de caja.",
    ],
  },
  {
    id: "clientes",
    titulo: "Clientes",
    cuando: ["ver clientes", "datos del cliente", "historial de un cliente"],
    ruta: "/clientes",
    destino: "Clientes",
    capacidad: "reportes.ver",
    modulo: "pos",
    pasos: ["Abre Comercial → Clientes. Los clientes se crean solos al poner nombre y cédula o teléfono en el cobro."],
  },

  // ── Administración ──────────────────────────────────────────────────────
  {
    id: "cuentas",
    titulo: "Cuentas (caja, bancos, billeteras)",
    cuando: ["crear una cuenta", "agregar banco", "no me deja registrar cobro", "de dónde sale el dinero"],
    ruta: "/administracion?tab=accounts",
    destino: "Cuentas",
    capacidad: "finanzas.operar",
    modulo: "administracion",
    pasos: [
      "Abre Administración → Cuentas y crea cada caja, banco o billetera con su moneda.",
      "Los cobros entran a una cuenta y los pagos salen de una: sin cuentas no se puede registrar ni cobro ni pago.",
    ],
  },
  {
    id: "por_cobrar",
    titulo: "Cuentas por cobrar (crédito a clientes)",
    cuando: ["vender a crédito", "registrar una cuenta por cobrar", "cliente me debe", "registrar un cobro"],
    ruta: "/administracion?tab=receivables",
    destino: "Por cobrar",
    capacidad: "finanzas.operar",
    modulo: "administracion",
    pasos: [
      "Abre Administración → Por cobrar y pulsa «Nuevo crédito».",
      "Llena cliente, cédula o RIF, nota o factura, monto, moneda, cuotas, cada cuántos días y la fecha de la primera cuota. Pulsa «Registrar crédito».",
      "Para cobrar: abre el crédito, pulsa «Registrar cobro», elige a qué cuenta entra el dinero, la fecha y la referencia, y confirma.",
    ],
    notas: ["Si «Registrar cobro» está apagado, primero crea una cuenta en Administración → Cuentas."],
  },
  {
    id: "por_pagar",
    titulo: "Cuentas por pagar a proveedores",
    cuando: [
      "dónde veo lo que le debo a los proveedores",
      "registrar una factura de proveedor",
      "cuentas por pagar",
      "pagar a un proveedor",
      "a quién le debo",
      "cuánto debo en notas de entrega",
      "factura fiscal o nota de entrega",
      "llegó la factura de una nota de entrega",
    ],
    ruta: "/administracion?tab=payables",
    destino: "Por pagar",
    capacidad: "finanzas.operar",
    modulo: "administracion",
    pasos: [
      "Abre Administración → Por pagar. Ahí está lo que debes a cada proveedor, con vencimientos.",
      "Para anotar una deuda sin cargar mercancía: «Nueva factura», elige o crea el proveedor y el «Tipo de documento» (factura fiscal o nota de entrega). Llena número y control, emisión, moneda, total, IVA (solo en factura), qué se compró, cuotas y cada cuántos días. Pulsa «Registrar factura» o «Registrar nota de entrega».",
      "Cuando llegue la factura de una nota de entrega: abre la nota y pulsa «Cambiar a factura» para poner su número, control e IVA. Lo que se debe no cambia.",
      "Para pagar: abre la factura, pulsa «Pagar», elige de qué cuenta sale el dinero, fecha y referencia, y confirma con «Registrar pago».",
      "Para un descuento o devolución del proveedor usa «Nota de crédito».",
    ],
    notas: [
      "Por pagar es solo proveedores. Alquiler, servicios, impuestos y nómina van en Obligaciones.",
      "Si compraste mercancía, mejor regístrala desde Inventario → Recepción «A crédito»: carga los productos y crea la factura aquí en un solo paso.",
      "Para saber cuánto le debes a cada uno y qué vence primero, pregúntame: lo leo del sistema, separando facturas y notas de entrega.",
      "En la lista puedes filtrar solo facturas o solo notas de entrega, y el Excel trae la columna «Tipo».",
    ],
  },
  {
    id: "obligaciones",
    titulo: "Obligaciones (alquiler, servicios, impuestos, nómina)",
    cuando: ["pagar el alquiler", "gastos fijos", "obligaciones", "servicios"],
    ruta: "/administracion?tab=obligations",
    destino: "Obligaciones",
    capacidad: "finanzas.operar",
    modulo: "administracion",
    pasos: ["Abre Administración → Obligaciones para registrar gastos fijos o recurrentes y sus pagos."],
    notas: ["Las deudas con proveedores de mercancía van en Por pagar, no aquí."],
  },
  {
    id: "conciliacion",
    titulo: "Conciliación bancaria",
    cuando: ["conciliar el banco", "estado de cuenta", "importar movimientos del banco"],
    ruta: "/administracion?tab=reconciliation",
    destino: "Conciliación",
    capacidad: "finanzas.operar",
    modulo: "administracion",
    pasos: ["Abre Administración → Conciliación, importa el estado de cuenta del banco y asocia cada movimiento."],
  },
  {
    id: "cashea",
    titulo: "Ventas con Cashea",
    cuando: ["cashea", "ventas en cuotas", "importar archivo de cashea"],
    ruta: "/cashea",
    destino: "Cashea",
    capacidad: "finanzas.operar",
    modulo: "cashea",
    pasos: ["Abre Administración → Cashea para ver las operaciones e importar los archivos de órdenes y pagos."],
  },

  // ── Otros ───────────────────────────────────────────────────────────────
  {
    id: "reportes",
    titulo: "Reportes",
    cuando: ["ver reportes", "ventas del mes", "reporte de IVA", "cierres de caja"],
    ruta: "/reportes",
    destino: "Reportes",
    capacidad: "reportes.ver",
    modulo: "reportes",
    pasos: ["Abre Reportes: ventas, inventario, cierres de caja, IVA y resultado. Cada pestaña filtra por fecha y sede y exporta a Excel."],
  },
  {
    id: "fichaje",
    titulo: "Fichaje del personal",
    cuando: ["marcar entrada", "control de asistencia", "fichaje", "horas trabajadas"],
    ruta: "/fichaje",
    destino: "Fichaje",
    capacidad: "fichaje.gestionar",
    modulo: "fichaje",
    pasos: ["Abre Equipo → Fichaje: ahí están quién está en turno, el historial, las incidencias y los horarios. Cada empleado marca desde su teléfono con el enlace del negocio y su PIN."],
  },
  {
    id: "estudio",
    titulo: "Fotos de producto con Estudio IA",
    cuando: ["mejorar la foto", "foto de producto", "estudio ia"],
    ruta: "/estudio",
    destino: "Estudio IA",
    capacidad: "estudio.usar",
    modulo: "estudio",
    pasos: ["Abre Estudio IA, sube la foto del producto y genera la versión mejorada."],
  },
  {
    id: "exportar",
    titulo: "Exportar todos los datos",
    cuando: ["sacar mis datos", "respaldo", "exportar todo"],
    ruta: "/configuracion#exportar",
    destino: "Exportar datos",
    capacidad: "config.negocio",
    pasos: ["Abre Configuración → Exportar datos y descarga el archivo."],
  },
];

export function findGuide(id: string): Guide | undefined {
  return GUIDES.find((g) => g.id === id);
}

/** Etiquetas de botones citadas en los pasos y notas («…»). */
export function quotedLabels(guide: Guide): string[] {
  const text = [...guide.pasos, ...(guide.notas ?? [])].join("\n");
  return [...text.matchAll(/«([^»]+)»/g)].map((m) => m[1]);
}
