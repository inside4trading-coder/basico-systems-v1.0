import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchSaleReceipt } from "./api";
import { printReceipt, receiptHtml, storePaper, storedPaper, type PaperWidth, type ReceiptHeader } from "./receipt";

/** Nota de entrega de la venta recién hecha: vista previa e impresión. */
export default function ReceiptDialog({
  saleId,
  header,
  onClose,
}: {
  saleId: string | null;
  header: ReceiptHeader;
  onClose: () => void;
}) {
  const [paper, setPaper] = useState<PaperWidth>(storedPaper);
  const sale = useQuery({
    enabled: Boolean(saleId),
    queryKey: ["pos", "receipt", saleId],
    queryFn: () => fetchSaleReceipt(saleId as string),
  });
  const html = sale.data ? receiptHtml(sale.data, header, paper) : null;

  const choose = (width: PaperWidth) => {
    setPaper(width);
    storePaper(width);
  };

  return (
    <Dialog open={Boolean(saleId)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Venta registrada{sale.data ? ` · ${sale.data.number}` : ""}</DialogTitle>
        </DialogHeader>
        {sale.isError && <p className="text-sm text-destructive">No se pudo cargar la nota: {sale.error.message}</p>}
        {html ? (
          <iframe
            title="Nota de entrega"
            srcDoc={html}
            className="mx-auto h-[50vh] rounded-md border bg-white"
            style={{ width: paper === 58 ? 240 : 320 }}
          />
        ) : (
          !sale.isError && <p className="mono-cap text-xs text-muted-foreground">Cargando nota…</p>
        )}
        <div className="flex items-center justify-center gap-2" role="group" aria-label="Ancho del papel">
          {([58, 80] as const).map((w) => (
            <Button key={w} size="sm" variant={paper === w ? "default" : "outline"} onClick={() => choose(w)}>
              {w} mm
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-12" disabled={!html} onClick={() => html && printReceipt(html)}>
            Imprimir
          </Button>
          <Button className="h-12" onClick={onClose} autoFocus>
            Nueva venta
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
