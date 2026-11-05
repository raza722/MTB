import { formatCount, formatDate, isoDateToLocalDate, maskCnic, normalizeCnic, parseDateInput, parseRs, toIsoDate, type IsoDate, type Rupees } from "@mtb/domain";
import { Command } from "cmdk";
import { Popover } from "radix-ui";
import { useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { DayPicker } from "react-day-picker";
import { Icon } from "../icons";
import { cx } from "../lib/cx";
import { IconButton } from "./button";
import { Field, Input, type InputProps } from "./field";

/*
 * MTB additions — inputs the brief needs that the MTB Campus design system does not define yet.
 * Each is built from the design system's Input and Field, so labels, errors and focus behave the same.
 */

type BaseInputProps = Omit<InputProps, "value" | "defaultValue" | "onChange" | "type">;

export interface CnicInputProps extends BaseInputProps {
  /** Digits only ("3630245678901"); the field shows 36302-4567890-1. */
  value: string;
  onValueChange: (digits: string) => void;
}

/** CNIC with a live mask. Accepts typing or pasting with or without dashes. */
export function CnicInput({ value, onValueChange, error, onBlur, placeholder = "00000-0000000-0", ...rest }: CnicInputProps) {
  const [touched, setTouched] = useState(false);
  const digits = normalizeCnic(value);
  const incomplete = touched && digits.length > 0 && digits.length < 13;
  return (
    <Input
      {...rest}
      mono
      inputMode="numeric"
      autoComplete="off"
      maxLength={15}
      placeholder={placeholder}
      value={maskCnic(digits)}
      onChange={(e) => onValueChange(normalizeCnic(e.target.value))}
      onBlur={(e: FocusEvent<HTMLInputElement>) => {
        setTouched(true);
        onBlur?.(e);
      }}
      error={error ?? (incomplete ? "Enter all 13 digits: 36302-4567890-1" : undefined)}
    />
  );
}

export interface AmountInputProps extends BaseInputProps {
  /** Whole rupees, or null when empty. */
  value: Rupees | null;
  onValueChange: (value: Rupees | null) => void;
}

/** "Rs" prefix, right-aligned tabular figures, thousands separators as you type. Whole rupees only. */
export function AmountInput({ value, onValueChange, ...rest }: AmountInputProps) {
  return (
    <Input
      {...rest}
      prefix="Rs"
      amount
      inputMode="numeric"
      autoComplete="off"
      value={value === null ? "" : formatCount(value)}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "");
        onValueChange(digits === "" ? null : parseRs(digits));
      }}
    />
  );
}

export interface DatePickerProps extends BaseInputProps {
  value: IsoDate | null;
  onValueChange: (value: IsoDate | null) => void;
  /** The demo's "today" (04-Nov-2026) — marked in the calendar. */
  today?: IsoDate;
  minDate?: IsoDate;
  maxDate?: IsoDate;
}

/**
 * Type a date (04-Nov-2026, 4/11/2026, 4 nov 2026) or pick one. Day comes before month.
 * The calendar supports arrow keys, Page Up/Down for months and Home/End for the week.
 */
export function DatePicker({ value, onValueChange, today, minDate, maxDate, error, disabled, onBlur, placeholder = "dd-Mmm-yyyy", ...rest }: DatePickerProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);

  const commit = () => {
    if (draft === null) return;
    if (draft.trim() === "") {
      onValueChange(null);
      setInvalid(false);
      setDraft(null);
      return;
    }
    const parsed = parseDateInput(draft);
    if (parsed) {
      onValueChange(parsed);
      setInvalid(false);
      setDraft(null);
    } else {
      setInvalid(true);
    }
  };

  const selected = value ? isoDateToLocalDate(value) : undefined;
  const todayDate = today ? isoDateToLocalDate(today) : undefined;
  const disabledDays = [
    ...(minDate ? [{ before: isoDateToLocalDate(minDate) }] : []),
    ...(maxDate ? [{ after: isoDateToLocalDate(maxDate) }] : []),
  ];

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div>
          <Input
            {...rest}
            disabled={disabled}
            placeholder={placeholder}
            autoComplete="off"
            className="mtb-num"
            value={draft ?? (value ? formatDate(value) : "")}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e: FocusEvent<HTMLInputElement>) => {
              commit();
              onBlur?.(e);
            }}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") commit();
              if (e.key === "ArrowDown" && e.altKey) setOpen(true);
            }}
            error={error ?? (invalid ? "Enter a date like 04-Nov-2026" : undefined)}
            action={
              <Popover.Trigger asChild>
                <IconButton icon="calendar" label="Choose date" size="sm" disabled={disabled} />
              </Popover.Trigger>
            }
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content className="mtb-popover" align="end" sideOffset={6} aria-label="Choose date">
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={(d) => {
              onValueChange(d ? toIsoDate(d) : null);
              setDraft(null);
              setInvalid(false);
              setOpen(false);
            }}
            {...(selected ?? todayDate ? { defaultMonth: selected ?? todayDate } : {})}
            {...(todayDate ? { today: todayDate } : {})}
            {...(disabledDays.length ? { disabled: disabledDays } : {})}
            weekStartsOn={1}
            showOutsideDays
            autoFocus
            classNames={{
              root: "mtb-cal",
              nav: "mtb-cal-nav",
              button_previous: "mtb-btn mtb-btn-ghost mtb-btn-sm mtb-btn-icon",
              button_next: "mtb-btn mtb-btn-ghost mtb-btn-sm mtb-btn-icon",
              month_caption: "mtb-cal-caption",
              month_grid: "mtb-cal-grid",
              weekday: "mtb-cal-weekday",
              day: "mtb-cal-day",
              day_button: "mtb-cal-day-btn",
              today: "mtb-cal-today",
              selected: "mtb-cal-selected",
              outside: "mtb-cal-outside",
              disabled: "mtb-cal-disabled",
            }}
            components={{
              Chevron: ({ orientation }) => <Icon name={orientation === "left" ? "chevronLeft" : "chevronRight"} size={16} />,
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export interface ComboboxOption {
  value: string;
  label: string;
  /** Right-aligned detail, e.g. an account code. */
  hint?: string;
  /** Extra search terms. */
  keywords?: string[];
}

export interface ComboboxProps {
  label?: ReactNode;
  required?: boolean;
  help?: ReactNode;
  error?: ReactNode;
  options: ComboboxOption[];
  value: string | null;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}

/** Searchable select for long lists (accounts, students, classes). Type to filter, arrows to move, Enter to pick. */
export function Combobox({
  label,
  required,
  help,
  error,
  options,
  value,
  onValueChange,
  placeholder = "Select…",
  searchPlaceholder = "Type to search",
  emptyText = "No matches",
  disabled,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <Field label={label} required={required} help={help} error={error} className={className}>
      {(c) => (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button
              id={c.id}
              type="button"
              disabled={disabled}
              className={cx("mtb-select", "mtb-combobox-trigger", c.invalid && "is-invalid", !current && "is-placeholder")}
              aria-invalid={c.invalid || undefined}
              aria-describedby={c.describedBy}
              aria-haspopup="listbox"
              aria-expanded={open}
            >
              {current?.label ?? placeholder}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="mtb-popover mtb-combobox" align="start" sideOffset={6}>
              <Command label={typeof label === "string" ? label : "Options"}>
                <Command.Input className="mtb-input" placeholder={searchPlaceholder} autoFocus />
                <Command.List>
                  <Command.Empty>{emptyText}</Command.Empty>
                  {options.map((o) => (
                    <Command.Item
                      key={o.value}
                      value={`${o.label} ${o.hint ?? ""} ${o.value}`}
                      {...(o.keywords ? { keywords: o.keywords } : {})}
                      data-checked={o.value === value}
                      onSelect={() => {
                        onValueChange(o.value);
                        setOpen(false);
                      }}
                    >
                      <span style={{ flex: 1 }}>{o.label}</span>
                      {o.hint && <span className="mtb-combobox-hint mtb-num">{o.hint}</span>}
                      {o.value === value && <Icon name="check" />}
                    </Command.Item>
                  ))}
                </Command.List>
              </Command>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </Field>
  );
}
