import { SearchSelect } from "@/ui/components/form-controls/search-select/SearchSelect";
import { foodOptionsFor } from "@/ui/services/app-config";
import type { FoodDraft } from "../../../types";

export function FoodSelect({
  label,
  food,
  disabled,
  onChange,
}: {
  label: string;
  food: FoodDraft;
  disabled?: boolean;
  onChange(food: FoodDraft): void;
}) {
  const items = [
    { id: 0, name: "自动选择" },
    ...foodOptionsFor(food.mode === "specific" ? food.foodId : undefined),
  ];
  const value = items.find(
    (item) => item.id === (food.mode === "specific" ? food.foodId : 0),
  );
  return (
    <SearchSelect
      controlSize="wide"
      label={label}
      layout="inline"
      placeholder="搜索食物名称"
      items={items}
      value={value}
      disabled={disabled}
      getLabel={(item) => item.name}
      getKey={(item) => String(item.id)}
      onSelect={(item) =>
        onChange(
          item.id === 0
            ? { mode: "auto" }
            : { mode: "specific", foodId: item.id },
        )
      }
      onClear={
        food.mode === "specific" ? () => onChange({ mode: "auto" }) : undefined
      }
    />
  );
}
