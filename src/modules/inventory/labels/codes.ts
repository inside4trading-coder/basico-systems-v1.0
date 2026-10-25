/** SVG del código de la etiqueta: de barras (CODE128) o QR. Solo en el navegador. */
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import type { LabelCodeKind } from "./labels";

export function barcodeSvg(code: string): string {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  // El número va aparte, debajo: así no se deforma al estirar las barras.
  JsBarcode(svg, code, { format: "CODE128", displayValue: false, height: 40, margin: 0, width: 1.4 });
  svg.setAttribute("preserveAspectRatio", "none");
  return svg.outerHTML;
}

export async function qrSvg(code: string): Promise<string> {
  return QRCode.toString(code, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
}

export async function codeSvg(kind: LabelCodeKind, code: string): Promise<string> {
  if (kind === "none" || !code) return "";
  return kind === "qr" ? qrSvg(code) : barcodeSvg(code);
}
