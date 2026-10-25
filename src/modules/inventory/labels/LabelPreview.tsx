/** Vista previa de una etiqueta a escala (iframe con el mismo HTML que se imprime). */
import { useEffect, useState } from "react";
import { codeSvg } from "./codes";
import { labelLayout, previewHtml, type LabelHeader, type LabelItem, type LabelTemplateDraft } from "./labels";

const PX_PER_MM = 96 / 25.4;

export default function LabelPreview({
  item,
  template,
  header,
  maxWidth = 320,
}: {
  item: Omit<LabelItem, "codeSvg">;
  template: LabelTemplateDraft;
  header: LabelHeader;
  maxWidth?: number;
}) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let alive = true;
    codeSvg(template.code_kind, item.code)
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(""));
    return () => {
      alive = false;
    };
  }, [template.code_kind, item.code]);

  const layout = labelLayout(template);
  // 2 mm de aire alrededor (padding del documento).
  const wPx = (layout.width + 4) * PX_PER_MM;
  const hPx = (layout.height + 4) * PX_PER_MM;
  const scale = Math.min(2.2, maxWidth / wPx);
  return (
    <div style={{ width: wPx * scale, height: hPx * scale }} className="overflow-hidden">
      <iframe
        title={`Vista previa de la etiqueta ${template.name}`}
        srcDoc={previewHtml({ ...item, codeSvg: svg }, template, header)}
        style={{ width: wPx, height: hPx, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0 }}
        tabIndex={-1}
      />
    </div>
  );
}
