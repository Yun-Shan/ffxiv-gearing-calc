import { Check } from "lucide-react";
import { Combobox } from "@base-ui/react/combobox";
import {
  useId,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  useImperativeHandle,
  type ReactNode,
  type Ref,
  type RefObject,
  type CSSProperties,
} from "react";
import {
  FormField,
  type LabelLayout,
  type ControlSize,
} from "../form-field/FormField";
import styles from "./SearchSelect.module.scss";

export function SearchSelect<T>({
  label,
  getLabel,
  getKey,
  getDescription,
  renderOption,
  matches,
  layout,
  controlSize,
  hideLabel,
  placeholder,
  items,
  value,
  onSelect,
  onClear,
  onOpenChange,
  onItemHighlighted,
  popupRef,
  popupAnchor,
  disabled = false,
  virtualized = false,
}: {
  label: string;
  getLabel(item: T): string;
  getKey(item: T): string;
  getDescription?(item: T): ReactNode;
  renderOption?(item: T, state: { selected: boolean }): ReactNode;
  matches?(item: T, query: string): boolean;
  layout?: LabelLayout;
  controlSize?: ControlSize;
  hideLabel?: boolean;
  placeholder: string;
  items: readonly T[];
  value?: T;
  onSelect(gear: T): void;
  onClear?: () => void;
  onOpenChange?(open: boolean): void;
  onItemHighlighted?(
    item: T | undefined,
    details: { reason: string; index: number },
  ): void;
  popupRef?: Ref<HTMLDivElement>;
  popupAnchor?: RefObject<HTMLDivElement | null>;
  disabled?: boolean;
  virtualized?: boolean;
}) {
  const id = useId();
  const virtualListRef = useRef<VirtualListHandle>(null);
  const options = useMemo(() => [...items], [items]);
  function renderContent(gear: T) {
    return renderOption ? (
      renderOption(gear, {
        selected: value !== undefined && getKey(gear) === getKey(value),
      })
    ) : (
      <>
        <Combobox.ItemIndicator
          keepMounted
          className={styles.indicator}
          aria-hidden="true"
        >
          <Check size={14} />
        </Combobox.ItemIndicator>
        <span className={styles.optionLabel}>{getLabel(gear)}</span>
        {getDescription && (
          <small className={styles.description}>{getDescription(gear)}</small>
        )}
      </>
    );
  }
  return (
    <Combobox.Root
      items={options}
      virtualized={virtualized}
      onItemHighlighted={(item, { reason, index }) => {
        if (virtualized && index >= 0 && reason !== "pointer") {
          queueMicrotask(() => virtualListRef.current?.scrollToIndex(index));
        }
        onItemHighlighted?.(item, { reason, index });
      }}
      value={value ?? null}
      itemToStringLabel={getLabel}
      filter={(item, query) =>
        matches
          ? matches(item, query)
          : getLabel(item)
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase())
      }
      itemToStringValue={getKey}
      isItemEqualToValue={(item, selected) => getKey(item) === getKey(selected)}
      disabled={disabled}
      onOpenChange={onOpenChange}
      onValueChange={(gear) => {
        if (gear) onSelect(gear);
        else onClear?.();
      }}
    >
      <FormField
        id={id}
        label={label}
        layout={layout}
        controlSize={controlSize}
        hideLabel={hideLabel}
      >
        <Combobox.InputGroup className={styles.inputGroup}>
          <Combobox.Input
            id={id}
            className={styles.input}
            placeholder={placeholder}
            aria-label={label}
          />
          <Combobox.Trigger
            className={styles.trigger}
            aria-label={`打开${label}列表`}
          >
            ▾
          </Combobox.Trigger>
          {value && onClear && (
            <Combobox.Clear
              className={styles.clear}
              aria-label={`清除${label}`}
            >
              ×
            </Combobox.Clear>
          )}
        </Combobox.InputGroup>
      </FormField>
      <Combobox.Portal>
        <Combobox.Positioner
          className={styles.positioner}
          anchor={popupAnchor}
          sideOffset={4}
        >
          <Combobox.Popup
            ref={popupRef}
            className={`${styles.popup} ${virtualized ? styles.virtualPopup : ""}`}
          >
            <Combobox.Empty>
              <div className={styles.empty}>没有匹配的选项。</div>
            </Combobox.Empty>
            <Combobox.List className={styles.list}>
              {virtualized ? (
                <VirtualizedOptions
                  ref={virtualListRef}
                  getKey={getKey}
                  renderContent={renderContent}
                />
              ) : (
                (gear: T) => (
                  <Combobox.Item
                    key={getKey(gear)}
                    value={gear}
                    className={styles.item}
                  >
                    {renderContent(gear)}
                  </Combobox.Item>
                )
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

interface VirtualListHandle {
  scrollToIndex(index: number): void;
}

// Rows are measured because equipment names can wrap. Only the visible window
// plus a small buffer is mounted; Base UI owns filtering and keyboard indices.
function VirtualizedOptions<T>({
  ref,
  getKey,
  renderContent,
}: {
  ref: Ref<VirtualListHandle>;
  getKey(item: T): string;
  renderContent(item: T): ReactNode;
}) {
  const items = Combobox.useFilteredItems<T>();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 278 });
  const heights = useRef(new Map<string, number>());
  const [measurement, setMeasurement] = useState(0);
  const offsets = useMemo(() => {
    const result = [0];
    for (const item of items)
      result.push(
        result[result.length - 1]! + (heights.current.get(getKey(item)) ?? 36),
      );
    return result;
  }, [items, getKey, measurement]);
  const total = offsets[offsets.length - 1]!;
  const top = Math.min(viewport.top, Math.max(0, total - viewport.height));
  function indexAt(offset: number) {
    let low = 0,
      high = items.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (offsets[mid + 1]! <= offset) low = mid + 1;
      else high = mid;
    }
    return low;
  }
  const start = Math.max(0, indexAt(top) - 5);
  const end = Math.min(items.length, indexAt(top + viewport.height) + 6);

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(index) {
        if (!scroller || index < 0 || index >= items.length) return;
        const rowTop = offsets[index]!;
        const rowBottom = offsets[index + 1]!;
        const height = scroller.clientHeight || viewport.height;
        const next =
          rowTop < scroller.scrollTop
            ? rowTop
            : rowBottom > scroller.scrollTop + height
              ? rowBottom - height
              : scroller.scrollTop;
        scroller.scrollTop = next;
        setViewport({ top: scroller.scrollTop, height });
      },
    }),
    [scroller, items.length, offsets, viewport.height],
  );

  useLayoutEffect(() => {
    if (!scroller) return;
    scroller.scrollTop = 0;
    setViewport({ top: 0, height: scroller.clientHeight || 278 });
  }, [scroller, items]);

  useLayoutEffect(() => {
    if (!scroller) return;
    const measure = () => {
      let changed = false;
      for (const element of scroller.querySelectorAll<HTMLElement>(
        "[data-virtual-key]",
      )) {
        const key = element.dataset.virtualKey!;
        const height = element.getBoundingClientRect().height;
        if (height > 0 && heights.current.get(key) !== height) {
          heights.current.set(key, height);
          changed = true;
        }
      }
      if (changed) setMeasurement((value) => value + 1);
      const height = scroller.clientHeight || 278;
      setViewport((current) =>
        current.height === height ? current : { ...current, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    scroller
      .querySelectorAll("[data-virtual-key]")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [scroller, items, start, end, getKey]);

  if (items.length === 0) return null;
  return (
    <div
      role="presentation"
      ref={setScroller}
      className={styles.virtualScroller}
      style={{ "--virtual-total-height": `${total}px` } as CSSProperties}
      onScroll={(event) =>
        setViewport({
          top: event.currentTarget.scrollTop,
          height: event.currentTarget.clientHeight || 278,
        })
      }
    >
      <div
        role="presentation"
        className={styles.virtualCanvas}
        style={{ height: total }}
      >
        {items.slice(start, end).map((item, visibleIndex) => {
          const index = start + visibleIndex;
          return (
            <Combobox.Item
              key={getKey(item)}
              value={item}
              index={index}
              data-virtual-key={getKey(item)}
              className={`${styles.item} ${styles.virtualItem}`}
              aria-setsize={items.length}
              aria-posinset={index + 1}
              style={{ transform: `translateY(${offsets[index]}px)` }}
            >
              {renderContent(item)}
            </Combobox.Item>
          );
        })}
      </div>
    </div>
  );
}
