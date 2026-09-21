import { useState } from "react";
import { Check, ChevronsUpDown, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string; hint?: string };

/** Выпадающий список с поиском по имени. Подходит для телефона. */
export function SearchableSelect({
  value,
  options,
  placeholder = "Выберите",
  emptyText = "Ничего не найдено",
  className,
  onChange,
  onDelete,
  footer,
}: {
  value: string | null;
  options: SelectOption[];
  placeholder?: string;
  emptyText?: string;
  className?: string;
  onChange: (value: string) => void;
  /** Если задано — рядом с каждым пунктом появится кнопка удаления. */
  onDelete?: (value: string) => void;
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className={cn("truncate", !current && "text-muted-foreground")}>
            {current?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
      >
        <Command>
          <CommandInput placeholder="Поиск по имени…" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.value}`}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      value === o.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {o.label}
                    {o.hint && (
                      <span className="ml-2 text-[11px] text-muted-foreground">{o.hint}</span>
                    )}
                  </span>
                  {onDelete && (
                    <button
                      type="button"
                      aria-label={`Удалить ${o.label}`}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDelete(o.value);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {footer}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
