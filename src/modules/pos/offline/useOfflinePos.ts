/**
 * Modo contingencia del POS: catálogo de la sede en el dispositivo, cola de
 * ventas sin conexión y sincronización al volver la red.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { isNetworkError, useOnline } from "@/core/offline";
import { supabase } from "@/core/supabase";
import { registerSale, searchForPos, type PosHit } from "../api";
import { applyLocalSale, loadSnapshot, localLookup, saveSnapshot, type CatalogSnapshot, type SnapshotRow } from "./catalog";
import { posStore } from "./kv";
import { discardSale, enqueueSale, loadQueue, retrySale, syncQueue, type QueuedSale } from "./queue";

const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
const SYNC_EVERY_MS = 30 * 1000;

async function fetchSnapshot(locationId: string): Promise<CatalogSnapshot> {
  const { data, error } = await supabase.rpc("pos_catalog_snapshot", { p_location_id: locationId });
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as SnapshotRow[]).map((r) => ({
    ...r,
    price: r.price === null ? null : Number(r.price),
    tax_rate: Number(r.tax_rate),
    available: Number(r.available),
    codes: r.codes ?? [],
  }));
  return { locationId, fetchedAt: new Date().toISOString(), rows };
}

export function useOfflinePos(tenantId: string, locationId: string) {
  const browserOnline = useOnline();
  // El navegador puede creerse en línea con el servidor inalcanzable (router
  // sin internet, proveedor caído): eso también es contingencia.
  const [unreachable, setUnreachable] = useState(false);
  const online = browserOnline && !unreachable;
  const qc = useQueryClient();
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const snapshot = useRef<CatalogSnapshot | null>(null);
  const syncingRef = useRef(false);

  const reloadQueue = useCallback(async () => setQueue(await loadQueue(posStore, tenantId)), [tenantId]);

  const refreshSnapshot = useCallback(async () => {
    try {
      const fresh = await fetchSnapshot(locationId);
      // Lo vendido sin conexión que aún no llegó al servidor sigue descontado.
      const pending = (await loadQueue(posStore, tenantId)).flatMap((q) => q.input.items);
      const adjusted = applyLocalSale(fresh, pending);
      snapshot.current = adjusted;
      setSnapshotAt(adjusted.fetchedAt);
      setUnreachable(false);
      await saveSnapshot(posStore, tenantId, adjusted);
    } catch (err) {
      if (isNetworkError(err)) setUnreachable(true);
      else console.warn("No se pudo guardar el catálogo local", err);
    }
  }, [locationId, tenantId]);

  const sync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const out = await syncQueue(posStore, tenantId, registerSale);
      if (out.interrupted) setUnreachable(true);
      else if (out.synced.length || out.failed.length) setUnreachable(false);
      if (out.synced.length) {
        toast.success(
          out.synced.length === 1
            ? `Venta sin conexión registrada: ${out.synced[0].result.number}`
            : `${out.synced.length} ventas sin conexión registradas`,
        );
        qc.invalidateQueries({ queryKey: ["pos"] });
        qc.invalidateQueries({ queryKey: ["inv"] });
      }
      for (const f of out.failed) toast.error(`No se pudo registrar ${f.receipt.number}`, { description: f.error ?? undefined });
      if (out.synced.length) await refreshSnapshot();
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      await reloadQueue();
    }
  }, [qc, refreshSnapshot, reloadQueue, tenantId]);

  // Arranque: cola y catálogo guardados; si hay red, sincroniza y refresca.
  useEffect(() => {
    let alive = true;
    (async () => {
      const saved = await loadSnapshot(posStore, tenantId, locationId);
      if (!alive) return;
      snapshot.current = saved ?? null;
      setSnapshotAt(saved?.fetchedAt ?? null);
      await reloadQueue();
    })();
    return () => {
      alive = false;
    };
  }, [locationId, reloadQueue, tenantId]);

  const unreachableRef = useRef(unreachable);
  unreachableRef.current = unreachable;

  useEffect(() => {
    if (!browserOnline) return;
    const tick = () => {
      sync();
      const age = snapshot.current ? Date.now() - Date.parse(snapshot.current.fetchedAt) : Infinity;
      // Con el servidor caído, refrescar el catálogo sirve también de sonda.
      if (age > SNAPSHOT_MAX_AGE_MS || unreachableRef.current) refreshSnapshot();
    };
    tick();
    const timer = setInterval(tick, SYNC_EVERY_MS);
    return () => clearInterval(timer);
  }, [browserOnline, refreshSnapshot, sync]);

  /** En línea busca en el servidor; sin red, en el catálogo guardado. */
  const search = useCallback(
    async (query: string): Promise<{ hits: PosHit[]; local: boolean }> => {
      if (navigator.onLine) {
        try {
          const hits = await searchForPos(query, locationId);
          setUnreachable(false);
          return { hits, local: false };
        } catch (err) {
          if (!isNetworkError(err)) throw err;
          setUnreachable(true);
        }
      }
      if (!snapshot.current) throw new Error("Sin conexión y sin catálogo guardado en este dispositivo");
      return { hits: localLookup(snapshot.current.rows, query), local: true };
    },
    [locationId],
  );

  const queueSale = useCallback(
    async (sale: QueuedSale) => {
      await enqueueSale(posStore, tenantId, sale);
      if (navigator.onLine) setUnreachable(true);
      if (snapshot.current) {
        snapshot.current = applyLocalSale(snapshot.current, sale.input.items);
        await saveSnapshot(posStore, tenantId, snapshot.current);
      }
      await reloadQueue();
    },
    [reloadQueue, tenantId],
  );

  const retry = useCallback(
    async (key: string) => {
      await retrySale(posStore, tenantId, key);
      await reloadQueue();
      if (navigator.onLine) await sync();
    },
    [reloadQueue, sync, tenantId],
  );

  const discard = useCallback(
    async (key: string) => {
      await discardSale(posStore, tenantId, key);
      await reloadQueue();
      await refreshSnapshot();
    },
    [refreshSnapshot, reloadQueue, tenantId],
  );

  return { online, queue, syncing, snapshotAt, sync, search, queueSale, retry, discard };
}

export type OfflinePos = ReturnType<typeof useOfflinePos>;
