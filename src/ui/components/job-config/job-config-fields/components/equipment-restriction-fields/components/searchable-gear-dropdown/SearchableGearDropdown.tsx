import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";
import type { Gear, GearSlot } from "../../../../../../../../domain/index";
import { GearMark } from "../gear-mark/GearMark";
import styles from "./SearchableGearDropdown.module.css";

export function SearchableGearDropdown({
  label,
  placeholder,
  query,
  onQueryChange,
  open,
  onOpenChange,
  selectedLabel,
  className,
  children,
}: {
  label: string;
  placeholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  const optionsId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPosition, setPanelPosition] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    opensUp: boolean;
    edge: number;
  }>();

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) onOpenChange(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onOpenChange]);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPosition(undefined);
      return;
    }
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 4;
      const viewportPadding = 8;
      const desiredHeight = 244;
      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - viewportPadding);
      const spaceAbove = Math.max(0, rect.top - gap - viewportPadding);
      const opensUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
      const availableSpace = opensUp ? spaceAbove : spaceBelow;
      const width = Math.min(Math.max(rect.width, 260), window.innerWidth - viewportPadding * 2);
      setPanelPosition({
        left: Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - width - viewportPadding),
        width,
        maxHeight: Math.min(desiredHeight, availableSpace),
        opensUp,
        edge: opensUp ? window.innerHeight - rect.top + gap : rect.bottom + gap,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const panelStyle = panelPosition ? {
    position: "fixed",
    left: panelPosition.left,
    width: panelPosition.width,
    maxHeight: panelPosition.maxHeight,
    "--dropdown-content-space": `${Math.max(0, panelPosition.maxHeight - 2)}px`,
    top: panelPosition.opensUp ? undefined : panelPosition.edge,
    bottom: panelPosition.opensUp ? panelPosition.edge : undefined,
  } as CSSProperties : undefined;

  return (
    <div className={className ? `${styles.dropdown} ${className}` : styles.dropdown} ref={rootRef}>
      <div
        ref={triggerRef}
        className={styles.trigger}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("button")) return;
          searchInputRef.current?.focus();
        }}
      >
        <span className={styles.searchGlyph} aria-hidden="true">⌕</span>
        <input
          ref={searchInputRef}
          className={styles.searchInput}
          type="search"
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={optionsId}
          aria-haspopup="listbox"
          aria-expanded={open}
          autoComplete="off"
          placeholder={placeholder}
          value={open ? query : selectedLabel ?? ""}
          onFocus={() => onOpenChange(true)}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "Enter") return;
            const firstOption = panelRef.current?.querySelector<HTMLButtonElement>('[role="option"]');
            if (!firstOption) return;
            event.preventDefault();
            firstOption.focus();
            if (event.key === "Enter") firstOption.click();
          }}
        />
        <button
          type="button"
          className={styles.toggle}
          aria-label={open ? `收起${label}候选` : `展开${label}候选`}
          aria-expanded={open}
          onClick={() => {
            const nextOpen = !open;
            onOpenChange(nextOpen);
            if (nextOpen) requestAnimationFrame(() => searchInputRef.current?.focus());
          }}
        >
          <span aria-hidden="true">⌄</span>
        </button>
      </div>
      {open && panelPosition && createPortal(<div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-label={`${label}筛选列表`}
        style={panelStyle}
      >
        <div id={optionsId} role="listbox" aria-label={`${label}候选项`} className={styles.options}>{children}</div>
      </div>, document.body)}
    </div>
  );
}

export function VirtualGearOptions({
  items,
  query,
  onSelect,
  selectedId,
  slotLabels,
}: {
  items: Gear[];
  query: string;
  onSelect: (gear: Gear) => void;
  selectedId?: number;
  slotLabels: Record<GearSlot, string>;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const rowHeight = 34;
  const viewportHeight = Math.min(228, items.length * rowHeight);
  const firstIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
  const lastIndex = Math.min(items.length, firstIndex + Math.ceil(viewportHeight / rowHeight) + 5);

  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [query]);

  return <div
    ref={viewportRef}
    className={styles.virtualOptions}
    tabIndex={0}
    style={{ "--dropdown-items-height": `${viewportHeight}px` } as CSSProperties}
    onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
  >
    <div className={styles.virtualTrack} style={{ height: items.length * rowHeight }}>
      {items.slice(firstIndex, lastIndex).map((gear, offset) => {
        const index = firstIndex + offset;
        return <button
          type="button"
          role="option"
          aria-selected={gear.id === selectedId}
          aria-posinset={index + 1}
          aria-setsize={items.length}
          className={styles.gearOption}
          key={gear.id}
          style={{ top: index * rowHeight, height: rowHeight }}
          onClick={() => onSelect(gear)}
        >
          <span className={styles.gearSlot}>{slotLabels[gear.slot]}</span>
          <span className={styles.gearIcon}><GearMark /></span>
          <span className={styles.gearName}>{gear.name}</span>
          <small>{gear.source ?? ""}</small>
        </button>;
      })}
    </div>
  </div>;
}
