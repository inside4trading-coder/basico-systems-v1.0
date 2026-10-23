/**
 * Lectura local (sin IA) de los datos de envío que el cliente manda por chat.
 * Solo toma lo que el texto dice: lo que no encuentra queda vacío y lo que
 * admite dos lecturas se marca para que el cajero lo revise.
 */

export const CARRIERS = ["MRW", "Zoom", "Liberty"] as const;
export type Carrier = (typeof CARRIERS)[number];

export interface DeliveryData {
  first_name: string;
  last_name: string;
  phone: string;
  doc: string;
  address: string;
  municipality: string;
  state: string;
  carrier: Carrier | "";
}

export type DeliveryField = keyof DeliveryData;

export const DELIVERY_LABELS: Record<DeliveryField, string> = {
  first_name: "Nombre",
  last_name: "Apellido",
  phone: "Teléfono",
  doc: "Cédula",
  address: "Dirección completa",
  municipality: "Municipio",
  state: "Estado",
  carrier: "Empresa de envío",
};

export const DELIVERY_FIELDS = Object.keys(DELIVERY_LABELS) as DeliveryField[];

export const EMPTY_DELIVERY: DeliveryData = {
  first_name: "",
  last_name: "",
  phone: "",
  doc: "",
  address: "",
  municipality: "",
  state: "",
  carrier: "",
};

export const VE_STATES = [
  "Amazonas", "Anzoátegui", "Apure", "Aragua", "Barinas", "Bolívar", "Carabobo", "Cojedes", "Delta Amacuro",
  "Distrito Capital", "Falcón", "Guárico", "La Guaira", "Lara", "Mérida", "Miranda", "Monagas", "Nueva Esparta",
  "Portuguesa", "Sucre", "Táchira", "Trujillo", "Yaracuy", "Zulia",
];

export interface ParseResult {
  data: DeliveryData;
  /** Campos que el texto no trae. */
  missing: DeliveryField[];
  /** Campos con más de una lectura posible: hay que revisarlos. */
  review: { field: DeliveryField; reason: string }[];
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const clean = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s,.;:*\-–•]+|[\s,;:*\-–•]+$/g, "").trim();

/** Etiquetas que la gente escribe, en minúsculas y sin acentos. */
const LABELS: { field: DeliveryField | "full_name" | "ignore"; re: RegExp }[] = [
  { field: "full_name", re: /^(nombres? y apellidos?|nombre completo|destinatario|cliente|recibe|nombre\/apellido)$/ },
  { field: "first_name", re: /^(nombres?|primer nombre)$/ },
  { field: "last_name", re: /^(apellidos?)$/ },
  { field: "phone", re: /^(telefonos?|tlfs?|telfs?|tel|cel|celular|movil|numero|numero de telefono|contacto|whatsapp)$/ },
  { field: "doc", re: /^(cedula|cedula de identidad|ci|c\.i|c\.i\.|rif|documento|cedula\/rif)$/ },
  { field: "address", re: /^(direccion|direccion completa|dir|domicilio|direccion de envio|direccion exacta)$/ },
  { field: "municipality", re: /^(municipio|mcpio|mun)$/ },
  { field: "state", re: /^(estado|edo)$/ },
  { field: "carrier", re: /^(empresa|empresa de envio|agencia|envio por|courier|encomienda|transporte|oficina)$/ },
  { field: "ignore", re: /^(ciudad|codigo postal|zona postal|correo|email|referencia|punto de referencia)$/ },
];

const ADDRESS_HINT = /\b(calle|cll|av|avda|avenida|urb|urbanizacion|sector|casa|edif|edificio|carrera|cra|local|piso|apto|apartamento|residencias?|conjunto|barrio|frente|al lado|entre|esquina|vereda|manzana|parcela|torre|cc|centro comercial|oficina)\b/;

export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("58") && d.length === 12) d = "0" + d.slice(2);
  if (d.length === 10 && d.startsWith("4")) d = "0" + d;
  if (d.length === 11 && d.startsWith("0")) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return null;
}

/** «V-12.345.678», «v 12345678», «J-40123456-7» → forma uniforme. Sin letra: solo números. */
export function normalizeDoc(raw: string): { doc: string; hasLetter: boolean } | null {
  const m = raw.toUpperCase().match(/\b([VEJGP])?[\s.-]*(\d{1,3}(?:[.\s]?\d{3}){1,2}|\d{6,9})(?:[\s-]*(\d))?\b/);
  if (!m) return null;
  const digits = m[2].replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 9) return null;
  if (!m[1]) return { doc: digits, hasLetter: false };
  return { doc: `${m[1]}-${digits}${m[3] && m[1] === "J" ? `-${m[3]}` : ""}`, hasLetter: true };
}

function matchCarriers(text: string): Carrier[] {
  const f = fold(text);
  return CARRIERS.filter((c) => new RegExp(`\\b${c.toLowerCase()}\\b`).test(f));
}

function matchState(text: string): string | null {
  const f = fold(clean(text)).replace(/^(estado|edo\.?)\s+/, "");
  const hit = VE_STATES.find((s) => fold(s) === f);
  if (hit) return hit;
  if (f === "caracas" || f === "dtto capital" || f === "distrito capital") return "Distrito Capital";
  if (f === "vargas") return "La Guaira";
  return null;
}

/** Divide «Ana María Pérez Gómez» en nombre y apellido; con tres palabras hay que revisar. */
export function splitName(full: string): { first: string; last: string; ambiguous: boolean } {
  const words = clean(full).split(" ").filter(Boolean);
  if (words.length <= 1) return { first: words[0] ?? "", last: "", ambiguous: words.length === 1 };
  if (words.length === 2) return { first: words[0], last: words[1], ambiguous: false };
  if (words.length === 4) return { first: words.slice(0, 2).join(" "), last: words.slice(2).join(" "), ambiguous: false };
  return { first: words[0], last: words.slice(1).join(" "), ambiguous: true };
}

export function parseDeliveryText(text: string): ParseResult {
  const data: DeliveryData = { ...EMPTY_DELIVERY };
  const review: ParseResult["review"] = [];
  const flag = (field: DeliveryField, reason: string) => {
    if (!review.some((r) => r.field === field)) review.push({ field, reason });
  };
  const free: string[] = [];

  const lines = text
    .split(/\r?\n|;/)
    .map((l) => l.replace(/[*_~]/g, "").trim())
    .filter(Boolean);

  const setName = (full: string) => {
    const n = splitName(full);
    if (!data.first_name) data.first_name = n.first;
    if (!data.last_name) data.last_name = n.last;
    if (n.ambiguous) {
      flag("first_name", "Revisa dónde termina el nombre y empieza el apellido");
      flag("last_name", "Revisa dónde termina el nombre y empieza el apellido");
    }
  };

  for (const line of lines) {
    const lm = line.match(/^([^:]{1,40}):\s*(.*)$/);
    const label = lm ? fold(clean(lm[1])) : null;
    const value = lm ? clean(lm[2]) : clean(line);
    const def = label ? LABELS.find((l) => l.re.test(label)) : undefined;
    if (!def) {
      free.push(clean(line));
      continue;
    }
    if (!value || def.field === "ignore") continue;
    switch (def.field) {
      case "full_name":
        setName(value);
        break;
      case "phone": {
        const p = normalizePhone(value);
        if (p) data.phone = p;
        else {
          data.phone = value;
          flag("phone", "El teléfono no tiene 11 dígitos");
        }
        break;
      }
      case "doc": {
        const d = normalizeDoc(value);
        if (d) {
          data.doc = d.doc;
          if (!d.hasLetter) flag("doc", "Falta la letra de la cédula (V, E, J…)");
        } else {
          data.doc = value;
          flag("doc", "La cédula no parece válida");
        }
        break;
      }
      case "state": {
        const s = matchState(value);
        data.state = s ?? value;
        if (!s) flag("state", "Estado no reconocido");
        break;
      }
      case "carrier": {
        const c = matchCarriers(value);
        if (c.length === 1) data.carrier = c[0];
        else flag("carrier", c.length ? "Menciona más de una empresa" : "Solo se envía por MRW, Zoom o Liberty");
        break;
      }
      default:
        data[def.field] = value as never;
    }
  }

  // Líneas sin etiqueta: se reconocen por su forma.
  const unused: string[] = [];
  for (const line of free) {
    const f = fold(line);
    if (!data.phone) {
      const p = line.match(/(\+?58[\s-]?)?\(?0?4\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/);
      const phone = p && normalizePhone(p[0]);
      if (phone) {
        data.phone = phone;
        const rest = fold(clean(line.replace(p[0], "").replace(/[.:]/g, " ")));
        if (rest.length < 3 || LABELS.some((l) => l.field === "phone" && l.re.test(rest))) continue;
      }
    }
    if (!data.doc && /\b(c\.?i|cedula|[vej])\b[\s.:-]*\d|^\d{1,3}\.\d{3}\.\d{3}$/.test(f)) {
      const d = normalizeDoc(line);
      if (d) {
        data.doc = d.doc;
        if (!d.hasLetter) flag("doc", "Falta la letra de la cédula (V, E, J…)");
        continue;
      }
    }
    const carriers = matchCarriers(line);
    if (carriers.length && line.split(" ").length <= 6) {
      if (!data.carrier && carriers.length === 1) data.carrier = carriers[0];
      else if (carriers.length > 1) flag("carrier", "Menciona más de una empresa");
      continue;
    }
    const state = matchState(line);
    if (state) {
      if (!data.state) data.state = state;
      continue;
    }
    const mun = f.match(/^(municipio|mcpio\.?)\s+(.+)$/);
    if (mun) {
      if (!data.municipality) data.municipality = clean(line.slice(line.length - mun[2].length));
      continue;
    }
    unused.push(line);
  }

  // Lo que queda: la dirección es la línea con pinta de dirección; el nombre,
  // una línea corta solo con letras.
  for (const line of unused) {
    const f = fold(line);
    if (!data.address && (ADDRESS_HINT.test(f) || /\d/.test(line)) && line.length >= 12) {
      data.address = line;
      continue;
    }
    if (!data.first_name && /^[\p{L}' ]+$/u.test(line) && line.split(" ").length <= 5 && !ADDRESS_HINT.test(f)) {
      setName(line);
      continue;
    }
  }

  // Dirección con «, Municipio X» o «, Estado Y» al final: se separan solo si
  // lo dice explícito.
  if (data.address) {
    const parts = data.address.split(",").map(clean);
    const keep: string[] = [];
    for (const part of parts) {
      const fp = fold(part);
      const mun = fp.match(/^(municipio|mcpio\.?)\s+(.+)$/);
      if (mun && !data.municipality) {
        data.municipality = part.slice(part.length - mun[2].length);
        continue;
      }
      const st = /^(estado|edo\.?)\s+/.test(fp) ? matchState(part) : null;
      if (st && !data.state) {
        data.state = st;
        continue;
      }
      keep.push(part);
    }
    data.address = keep.join(", ");
  }

  const missing = DELIVERY_FIELDS.filter((f) => !data[f]);
  return { data, missing, review };
}

/** Campos obligatorios del envío que faltan o no son válidos. */
export function deliveryProblems(d: DeliveryData): DeliveryField[] {
  return DELIVERY_FIELDS.filter((f) => {
    const v = d[f].trim();
    if (!v) return true;
    if (f === "carrier") return !CARRIERS.includes(v as Carrier);
    if (f === "phone") return v.replace(/\D/g, "").length < 10;
    if (f === "doc") return v.replace(/\D/g, "").length < 6;
    return false;
  });
}

/** Clave para comparar cédulas (igual que en la base: letras y números en mayúscula). */
export const docKey = (doc: string) => doc.toUpperCase().replace(/[^0-9A-Z]/g, "");
