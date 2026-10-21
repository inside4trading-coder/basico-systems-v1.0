/**
 * Lector de códigos por cámara. Usa el del navegador (Chrome en Android) y,
 * donde no existe (Safari en iPhone), uno en WebAssembly que solo se descarga
 * al abrir la cámara. El .wasm se sirve desde esta misma app, no de un CDN.
 */

export const SCAN_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"] as const;

export interface CodeDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

interface NativeDetectorClass {
  new (options: { formats: string[] }): CodeDetector;
  getSupportedFormats(): Promise<string[]>;
}

/** Hay cámara que pedir (el permiso se pide al abrirla). */
export function canUseCamera(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

export async function createCodeDetector(): Promise<CodeDetector> {
  const native = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (native) {
    const supported = await native.getSupportedFormats().catch(() => [] as string[]);
    const formats = SCAN_FORMATS.filter((f) => supported.includes(f));
    if (formats.length > 0) return new native({ formats });
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import("barcode-detector/ponyfill"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
  });
  return new BarcodeDetector({ formats: [...SCAN_FORMATS] });
}
