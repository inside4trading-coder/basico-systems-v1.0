/**
 * Una línea del banco y qué hacer con ella: vincularla con un movimiento del
 * libro, cobrar una cuenta por cobrar, registrarla como movimiento nuevo,
 * ignorarla o reabrirla. Portado de
 * IdentifyDrawer (AdminReconcile.tsx, basicosystems@f551478b).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/modules/pos/cart";
import { catalogNames, useCatalog } from "../api";
import { MOVEMENT_KIND_LABEL, formatDay } from "../lib";
import SuggestInput from "../SuggestInput";
import CollectionPanel from "./CollectionPanel";
import { useCreateFromLine, useIgnoreLine, useLineCandidates, useLinkedMovement, useMatchLine, useReopenLine, type BankLine } from "./api";
import { LINE_STATUS_LABEL } from "./labels";
import { rankCandidates } from "./match";

const MATCH_KIND_LABEL = { auto: "automática", manual: "a mano", created: "registrada desde el banco" } as const;

export default function LineSheet({ line, onClose }: { line: BankLine | null; onClose: () => void }) {
  const open = line && (line.status === "unmatched" || line.status === "possible");
  const { data: movements = [], isLoading } = useLineCandidates(line);
  const { data: catalog = [] } = useCatalog();
  const { data: linked } = useLinkedMovement(line?.movement_id ?? null);
  const match = useMatchLine();
  const create = useCreateFromLine();
  const ignore = useIgnoreLine();
  const reopen = useReopenLine();
  const [mode, setMode] = useState<"link" | "collect" | "create" | "ignore">("link");
  const [showAll, setShowAll] = useState(false);
  const [category, setCategory] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");

  if (!line) return null;
  const ranked = rankCandidates(line, movements);
  const exact = ranked.filter((c) => c.sameAmount);
  const shown = showAll ? ranked : exact;
  const fail = (title: string) => (err: Error) => toast.error(title, { description: err.message });

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{line.description ?? "Movimiento del banco"}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant={line.status === "matched" ? "default" : "secondary"}>{LINE_STATUS_LABEL[line.status]}</Badge>
            <Badge variant="outline">{line.direction === "in" ? "Entrada" : "Salida"}</Badge>
          </div>
          <div className="rounded-xl border bg-card p-3">
            <p className={cn("num text-2xl font-bold", line.direction === "out" && "text-destructive")}>
              {line.direction === "in" ? "+" : "−"}
              {formatMoney(line.amount, line.currency)}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDay(line.line_date)}
              {line.line_time ? ` ${line.line_time.slice(0, 5)}` : ""}
              {line.reference ? ` · Ref. ${line.reference}` : ""}
              {line.operation_number ? ` · Op. ${line.operation_number}` : ""}
              {line.row_number ? ` · fila ${line.row_number}` : ""}
            </p>
          </div>

          {line.status === "matched" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Conciliación {line.match_kind ? MATCH_KIND_LABEL[line.match_kind] : ""} con:</p>
              {linked && (
                <div className="rounded-lg border p-2 text-xs">
                  <p className="font-semibold">{linked.note || linked.category || MOVEMENT_KIND_LABEL[linked.kind]}</p>
                  <p className="text-muted-foreground">
                    {formatDay(linked.occurred_on)} · {formatMoney(linked.amount, linked.currency)}
                    {linked.reference ? ` · Ref. ${linked.reference}` : ""}
                  </p>
                </div>
              )}
              <Button
                variant="outline"
                disabled={reopen.isPending}
                onClick={() => reopen.mutate({ p_line_id: line.id }, { onSuccess: () => toast.success("Línea desvinculada"), onError: fail("No se pudo desvincular") })}
              >
                Desvincular
              </Button>
            </div>
          )}
          {line.status === "ignored" && (
            <div className="space-y-2">
              <p className="rounded-lg bg-muted/50 p-2 text-xs">Ignorada: {line.ignore_reason}</p>
              <Button
                variant="outline"
                disabled={reopen.isPending}
                onClick={() => reopen.mutate({ p_line_id: line.id }, { onSuccess: () => toast.success("Línea reabierta"), onError: fail("No se pudo reabrir") })}
              >
                Reabrir
              </Button>
            </div>
          )}

          {open && (
            <>
              <div className="flex gap-1" role="group" aria-label="Acción">
                {(
                  [
                    ["link", "Vincular"],
                    ["collect", line.direction === "in" ? "Cobranza" : "Financiadora"],
                    ["create", line.direction === "in" ? "Registrar ingreso" : "Registrar egreso"],
                    ["ignore", "Ignorar"],
                  ] as const
                ).map(([m, label]) => (
                  <Button key={m} size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)} aria-pressed={mode === m}>
                    {label}
                  </Button>
                ))}
              </div>

              {mode === "link" && (
                <section className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Movimientos de la misma cuenta y dirección, a 15 días o menos, que aún no están conciliados.
                  </p>
                  {isLoading && <p className="mono-cap text-xs text-muted-foreground">Buscando…</p>}
                  {!isLoading && shown.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      {exact.length === 0 && ranked.length > 0 ? "Ninguno por el mismo monto." : "No hay movimientos para vincular."}
                    </p>
                  )}
                  <ul className="space-y-1">
                    {shown.map((c) => (
                      <li key={c.movement.id} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                        <div className="min-w-0 text-xs">
                          <p className="truncate font-semibold">{c.movement.note || c.movement.category || MOVEMENT_KIND_LABEL[c.movement.kind]}</p>
                          <p className="text-muted-foreground">
                            {formatDay(c.movement.occurred_on)} · {formatMoney(c.movement.amount, c.movement.currency)}
                            {c.movement.reference ? ` · Ref. ${c.movement.reference}` : ""}
                          </p>
                          <p className="text-muted-foreground">
                            {c.sameAmount ? "✓ mismo monto" : "△ otro monto"} · {c.sameReference ? "✓ misma referencia" : "sin referencia igual"} ·{" "}
                            {c.days === 0 ? "mismo día" : `${c.days} d`}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          disabled={!c.sameAmount || match.isPending}
                          title={c.sameAmount ? undefined : "Solo se vincula con el mismo monto"}
                          onClick={() =>
                            match.mutate(
                              { p_line_id: line.id, p_movement_id: c.movement.id },
                              { onSuccess: () => toast.success("Línea conciliada"), onError: fail("No se pudo vincular") },
                            )
                          }
                        >
                          Vincular
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {!showAll && ranked.length > exact.length && (
                    <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
                      Ver otros montos ({ranked.length - exact.length})
                    </Button>
                  )}
                </section>
              )}

              {mode === "collect" && <CollectionPanel line={line} />}

              {mode === "create" && (
                <section className="space-y-2">
                  <p className="text-xs text-muted-foreground">Queda en el libro con la fecha, el monto y la referencia del banco, ya conciliado.</p>
                  <div className="space-y-1">
                    <Label htmlFor="bl-category">Categoría</Label>
                    <SuggestInput id="bl-category" value={category} onChange={setCategory} options={catalogNames(catalog, "category", line.direction)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bl-counterparty">{line.direction === "in" ? "De quién" : "A quién"}</Label>
                    <SuggestInput id="bl-counterparty" value={counterparty} onChange={setCounterparty} options={catalogNames(catalog, "counterparty")} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bl-note">Descripción</Label>
                    <Input id="bl-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={line.description ?? ""} />
                  </div>
                  <Button
                    className="h-11 w-full"
                    disabled={create.isPending}
                    onClick={() =>
                      create.mutate(
                        { p_line_id: line.id, p_category: category || null, p_counterparty: counterparty || null, p_note: note || null },
                        { onSuccess: () => toast.success("Movimiento registrado y conciliado"), onError: fail("No se pudo registrar") },
                      )
                    }
                  >
                    Registrar y conciliar
                  </Button>
                </section>
              )}

              {mode === "ignore" && (
                <section className="space-y-2">
                  <p className="text-xs text-muted-foreground">Para líneas que no van al libro (un reverso del banco, una prueba). Se puede reabrir.</p>
                  <div className="space-y-1">
                    <Label htmlFor="bl-reason">Motivo *</Label>
                    <Input id="bl-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                  </div>
                  <Button
                    variant="outline"
                    className="h-11 w-full"
                    disabled={!reason.trim() || ignore.isPending}
                    onClick={() =>
                      ignore.mutate({ p_line_id: line.id, p_reason: reason }, { onSuccess: () => toast.success("Línea ignorada"), onError: fail("No se pudo ignorar") })
                    }
                  >
                    Ignorar
                  </Button>
                </section>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
