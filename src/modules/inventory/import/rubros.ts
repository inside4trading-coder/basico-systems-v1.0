/**
 * Plantillas de rubro: configuración de arranque para un tipo de negocio.
 * No es código propio del rubro: solo campos propios, tipos de código y las
 * columnas de la plantilla de Excel. Aplicarla crea los campos que falten;
 * todo se puede editar después.
 */
import type { TargetField } from "./fields";

export interface RubroAttribute {
  key: string;
  label: string;
  type: "text" | "number" | "list";
  multi: boolean;
  searchable: boolean;
}

export interface RubroTemplate {
  id: string;
  name: string;
  description: string;
  attributes: RubroAttribute[];
  /** Columnas de la plantilla de Excel, en orden, con el campo al que van. */
  columns: { header: string; field: TargetField; example: string }[];
}

const STOCK = (code: string) => `stock:${code}` as TargetField;

export const RUBROS: RubroTemplate[] = [
  {
    id: "retail",
    name: "Comercio general",
    description: "Bodegas, tiendas y distribuidoras: nombre, marca, categoría, código de barras y precio.",
    attributes: [],
    columns: [
      { header: "Nombre", field: "name", example: "Harina de maíz 1 kg" },
      { header: "Marca", field: "brand", example: "P.A.N." },
      { header: "Categoría", field: "category", example: "Víveres" },
      { header: "SKU", field: "sku", example: "VIV-0001" },
      { header: "Código de barras", field: "code:barcode", example: "7591002000011" },
      { header: "Precio", field: "regular_price", example: "1,20" },
      { header: "Costo", field: "cost", example: "0,85" },
      { header: "Unidad", field: "unit", example: "unidad" },
    ],
  },
  {
    id: "repuestos",
    name: "Repuestos y autopartes",
    description: "Número de parte, vehículos compatibles y motor; búsqueda por vehículo en el POS.",
    attributes: [
      { key: "vehiculo", label: "Vehículo compatible", type: "list", multi: true, searchable: true },
      { key: "motor", label: "Motor", type: "text", multi: true, searchable: true },
      { key: "posicion", label: "Posición", type: "list", multi: false, searchable: true },
    ],
    columns: [
      { header: "Descripción", field: "name", example: "Pastillas de freno delanteras" },
      { header: "Marca", field: "brand", example: "Bosch" },
      { header: "Categoría", field: "category", example: "Frenos" },
      { header: "Referencia", field: "sku", example: "PF-001" },
      { header: "Número de parte", field: "code:oem", example: "04465-0K290" },
      { header: "Código de barras", field: "code:barcode", example: "" },
      { header: "Vehículo compatible", field: "attr:vehiculo", example: "Hilux 2010; Fortuner 2012" },
      { header: "Motor", field: "attr:motor", example: "2.7" },
      { header: "Posición", field: "attr:posicion", example: "Delantera" },
      { header: "Precio", field: "regular_price", example: "30" },
      { header: "Costo", field: "cost", example: "12,50" },
    ],
  },
  {
    id: "ropa",
    name: "Ropa y calzado",
    description: "Productos con tallas y colores agrupados por clave de producto.",
    attributes: [
      { key: "genero", label: "Género", type: "list", multi: false, searchable: true },
      { key: "material", label: "Material", type: "text", multi: false, searchable: false },
    ],
    columns: [
      { header: "Clave producto", field: "product_key", example: "FRANELA-BASICA" },
      { header: "Nombre", field: "name", example: "Franela básica" },
      { header: "Marca", field: "brand", example: "" },
      { header: "Categoría", field: "category", example: "Franelas" },
      { header: "SKU", field: "sku", example: "FR-BAS-M-NEG" },
      { header: "Código de barras", field: "code:barcode", example: "" },
      { header: "Talla", field: "option:Talla", example: "M" },
      { header: "Color", field: "option:Color", example: "Negro" },
      { header: "Género", field: "attr:genero", example: "Unisex" },
      { header: "Precio", field: "regular_price", example: "15" },
      { header: "Oferta", field: "price", example: "" },
      { header: "Costo", field: "cost", example: "6" },
    ],
  },
];

/** Columnas de la plantilla con una columna de existencia por sede activa. */
export function templateColumns(rubro: RubroTemplate, locationCodes: string[]) {
  return [
    ...rubro.columns,
    ...locationCodes.map((code) => ({ header: `Existencia ${code}`, field: STOCK(code), example: "0" })),
  ];
}
