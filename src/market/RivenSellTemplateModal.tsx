import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import ItemImg from "../ItemImg";
import { rivenCategory, rivenModName, rivenStatLabel, POLARITY_DISPLAY } from "./MarketHelper";
import type { CatalogItem } from "../types/items";
import type { BlobRivenEntry, RivenSellQueueItem, WfmAuction } from "../types/market";
import "./RivenSellTemplateModal.css";

interface Props {
  open: boolean;
  selectedRivens: BlobRivenEntry[];
  catalog: CatalogItem[];
  dispositions: Record<string, number>;
  onClose: () => void;
  onAddToSidebar: (items: RivenSellQueueItem[]) => void;
}

interface DraftRow {
  riven: BlobRivenEntry;
  weaponName: string;
  modName: string;
  price: number;
  mode: "direct" | "auction";
  matchedAuction?: WfmAuction;
}

function toWfmSlug(name: string): string {
  return name.toLowerCase().replace(/['']/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export default function RivenSellTemplateModal({
  open,
  selectedRivens,
  catalog,
  dispositions,
  onClose,
  onAddToSidebar,
}: Props) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [wfmAuctions, setWfmAuctions] = useState<WfmAuction[]>([]);

  const pathToItem = useMemo(() => {
    const m = new Map<string, CatalogItem>();
    for (const item of catalog) m.set(item.unique_name, item);
    return m;
  }, [catalog]);

  // Load user's WFM auctions once on mount / open
  useEffect(() => {
    if (!open) return;
    invoke<{ payload?: { auctions?: WfmAuction[] } }>("wfm_get_my_riven_auctions")
      .then(res => {
        const list = res?.payload?.auctions ?? [];
        setWfmAuctions(list);
      })
      .catch(() => setWfmAuctions([]));
  }, [open]);

  // Build draft rows whenever selectedRivens or wfmAuctions change
  useEffect(() => {
    if (!open) return;
    const initialRows: DraftRow[] = selectedRivens.map(r => {
      const parent = r.compat ? pathToItem.get(r.compat) : null;
      const weaponName = parent?.name ?? (r.compat ? r.compat.split("/").pop() ?? "Unknown" : "Unknown");
      const rawMod = r.mod_name || rivenModName(r);
      const modName = rawMod ? rawMod.replace(/^./, c => c.toUpperCase()) : "";
      const slug = toWfmSlug(weaponName);

      // Try matching an active WFM auction
      const matched = wfmAuctions.find(a => {
        const itemSlug = a.item?.weapon_url_name ?? "";
        const itemName = (a.item?.name ?? "").toLowerCase();
        return itemSlug === slug && (rawMod ? itemName === rawMod.toLowerCase() : true);
      });

      const mode: "direct" | "auction" = matched ? (matched.is_direct_sell ? "direct" : "auction") : "direct";
      const defaultPrice = matched
        ? (matched.is_direct_sell ? (matched.buyout_price ?? matched.starting_price) : matched.starting_price)
        : 100;

      return {
        riven: r,
        weaponName,
        modName,
        price: defaultPrice,
        mode,
        matchedAuction: matched,
      };
    });

    setRows(initialRows);
    setActiveIdx(0);
  }, [open, selectedRivens, wfmAuctions, pathToItem]);

  if (!open || rows.length === 0) return null;

  const currentPreview = rows[activeIdx]?.riven ?? rows[0]?.riven;
  const currentParent = currentPreview?.compat ? pathToItem.get(currentPreview.compat) : null;
  const currentWeaponName = currentParent?.name ?? (currentPreview?.compat ? currentPreview.compat.split("/").pop() ?? "Unknown" : "Unknown");
  const currentModName = (currentPreview?.mod_name || rivenModName(currentPreview))?.replace(/^./, c => c.toUpperCase());
  const currentDisp = currentPreview?.compat ? (dispositions[currentPreview.compat] ?? 1.0) : 1.0;
  const currentCat = currentPreview ? rivenCategory(currentPreview.item_type) : "";

  const handleApplyWfmPrice = (idx: number) => {
    const r = rows[idx];
    if (!r.matchedAuction) return;
    const a = r.matchedAuction;
    const isDirect = a.is_direct_sell;
    const price = isDirect ? (a.buyout_price ?? a.starting_price) : a.starting_price;
    setRows(prev => prev.map((item, i) => i === idx ? { ...item, price, mode: isDirect ? "direct" : "auction" } : item));
  };

  const handleUpdatePrice = (idx: number, val: string) => {
    const num = Math.max(0, parseInt(val, 10) || 0);
    setRows(prev => prev.map((item, i) => i === idx ? { ...item, price: num } : item));
  };

  const handleToggleMode = (idx: number, mode: "direct" | "auction") => {
    setRows(prev => prev.map((item, i) => i === idx ? { ...item, mode } : item));
  };

  const handleRemoveRow = (idx: number) => {
    const next = rows.filter((_, i) => i !== idx);
    setRows(next);
    if (activeIdx >= next.length) setActiveIdx(Math.max(0, next.length - 1));
  };

  const handleConfirm = () => {
    const queueItems: RivenSellQueueItem[] = rows.map((r, i) => ({
      id: r.riven.item_id || `${r.weaponName}-${r.modName}-${i}-${Date.now()}`,
      riven: r.riven,
      weaponName: r.weaponName,
      modName: r.modName,
      price: r.price,
      mode: r.mode,
      wfmAuctionId: r.matchedAuction?.id,
    }));
    onAddToSidebar(queueItems);
    onClose();
  };

  return (
    <div className="rstm-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rstm-modal">
        {/* Header */}
        <div className="rstm-header">
          <div className="rstm-title">
            <span>⚔ Create Sell Template</span>
            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 400 }}>({rows.length} riven{rows.length !== 1 ? "s" : ""} selected)</span>
          </div>
          <button className="rstm-close-btn" onClick={onClose} title="Close">✕</button>
        </div>

        {/* Body: Left Preview + Right Pricing */}
        <div className="rstm-body">
          {/* Left: Riven Preview Card */}
          <div className="rstm-preview-col">
            <div className="rstm-preview-label">Riven Preview</div>
            {currentPreview && (
              <div className="rstm-card-preview">
                <div className="rstm-card-top">
                  <ItemImg imageName={currentParent?.image_name} category={currentCat} size={48} fallbackText="R" />
                  <div>
                    <div className="rstm-card-weapon">{currentWeaponName}</div>
                    {currentModName && <div className="rstm-card-mod">{currentModName}</div>}
                  </div>
                </div>

                <div className="rstm-card-meta">
                  <span>{currentCat}</span>
                  <span>MR {currentPreview.lvl_req ?? "?"}</span>
                  <span>Rank {currentPreview.mod_rank}</span>
                  <span>{currentDisp.toFixed(2)}x</span>
                  <span>{currentPreview.rerolls} roll{currentPreview.rerolls !== 1 ? "s" : ""}</span>
                  {currentPreview.polarity && POLARITY_DISPLAY[currentPreview.polarity] && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <img src={POLARITY_DISPLAY[currentPreview.polarity].icon} alt="" style={{ width: 13, height: 13 }} />
                      {POLARITY_DISPLAY[currentPreview.polarity].name}
                    </span>
                  )}
                </div>

                <div className="rstm-card-stats">
                  {currentPreview.buffs.map((b, j) => (
                    <span key={j} className="rstm-stat-tag rstm-stat-buff">
                      {rivenStatLabel(b, true, currentDisp, currentCat, currentPreview.buffs.length, currentPreview.curses.length, currentPreview.mod_rank)}
                    </span>
                  ))}
                  {currentPreview.curses.map((c, j) => (
                    <span key={j} className="rstm-stat-tag rstm-stat-curse">
                      {rivenStatLabel(c, false, currentDisp, currentCat, currentPreview.buffs.length, currentPreview.curses.length, currentPreview.mod_rank)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Pricing Table */}
          <div className="rstm-pricing-col">
            <div className="rstm-preview-label">Price Configuration (Line by Line)</div>
            <div className="rstm-list-wrap">
              {rows.map((row, idx) => {
                const isActive = activeIdx === idx;
                return (
                  <div
                    key={idx}
                    className={`rstm-row${isActive ? " rstm-active-row" : ""}`}
                    onClick={() => setActiveIdx(idx)}
                  >
                    <div className="rstm-row-name-wrap">
                      <div className="rstm-row-title">{row.weaponName} {row.modName}</div>
                      <div className="rstm-row-sub">
                        {row.mode === "auction" ? "Auction (PMO >price)" : "Direct Sale (fixed price)"}
                      </div>
                    </div>

                    {/* Mode Toggle */}
                    <div className="rstm-mode-toggle" onClick={e => e.stopPropagation()}>
                      <button
                        className={`rstm-mode-btn${row.mode === "direct" ? " active" : ""}`}
                        onClick={() => handleToggleMode(idx, "direct")}
                        title="Fixed price direct sell"
                      >
                        DIR
                      </button>
                      <button
                        className={`rstm-mode-btn${row.mode === "auction" ? " active" : ""}`}
                        onClick={() => handleToggleMode(idx, "auction")}
                        title="Auction (PMO >price)"
                      >
                        AUC
                      </button>
                    </div>

                    {/* WFM Price shortcut if listing found */}
                    {row.matchedAuction && (
                      <button
                        className="rstm-wfm-btn"
                        onClick={e => { e.stopPropagation(); handleApplyWfmPrice(idx); }}
                        title="Take price from existing warframe.market listing"
                      >
                        WFM: {row.matchedAuction.is_direct_sell
                          ? `${row.matchedAuction.buyout_price ?? row.matchedAuction.starting_price}p`
                          : `>${row.matchedAuction.starting_price}p`}
                      </button>
                    )}

                    {/* Price Input */}
                    <div className="rstm-price-wrap" onClick={e => e.stopPropagation()}>
                      <input
                        className="rstm-price-input"
                        type="number"
                        min={0}
                        value={row.price}
                        onChange={e => handleUpdatePrice(idx, e.target.value)}
                      />
                      <span className="rstm-price-unit">p</span>
                    </div>

                    {/* Remove row */}
                    <button
                      className="rstm-row-del-btn"
                      onClick={e => { e.stopPropagation(); handleRemoveRow(idx); }}
                      title="Remove from batch"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="rstm-footer">
          <div className="rstm-footer-info">
            Selected rivens will be sent to the trade sell sidebar.
          </div>
          <button className="rstm-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="rstm-btn-submit" onClick={handleConfirm} disabled={rows.length === 0}>
            Send to Sell Sidebar ({rows.length})
          </button>
        </div>
      </div>
    </div>
  );
}
