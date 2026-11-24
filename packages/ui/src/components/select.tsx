import type { ChangeEvent } from "react";
import { Select as NativeSelect, type SelectProps } from "./field";
import { Combobox } from "./special-inputs";

/** More choices than this and a dropdown becomes a searchable list. */
export const LONG_SELECT_FROM = 15;

/**
 * The app's dropdown. A short list stays the browser's own select (fastest by keyboard, reliable everywhere). A long one
 * (more than 15 choices: classes, categories, staff, accounts…) becomes a searchable list that opens below its box at a
 * fixed height: the browser's own list ran the height of the screen and opened upward over the page (user report,
 * 20-Nov-2026, Stock › Category; this applies it everywhere). Pages keep calling `onChange` with `e.target.value`;
 * the searchable list hands them the chosen value the same way.
 */
export function Select(props: SelectProps) {
  const { label, required, help, error, options = [], className, children, value, onChange, disabled, multiple, defaultValue, onBlur, onFocus, autoFocus, title } = props;
  const long = !children && !multiple && defaultValue === undefined && value !== undefined && value !== null && !Array.isArray(value) && onChange && !onBlur && !onFocus && !autoFocus && options.length > LONG_SELECT_FROM;
  if (!long) return <NativeSelect {...props} />;
  const choices = options.map((o) => (typeof o === "string" ? { value: o, label: o } : { value: o.value, label: o.label, ...(o.disabled ? { disabled: true } : {}) }));
  const ariaLabel = props["aria-label"];
  return (
    <Combobox
      options={choices}
      value={String(value)}
      onValueChange={(v) => onChange({ target: { value: v }, currentTarget: { value: v } } as unknown as ChangeEvent<HTMLSelectElement>)}
      placeholder="Choose…"
      searchPlaceholder="Type to find"
      emptyText="Nothing matches"
      {...(label !== undefined ? { label } : {})}
      {...(required ? { required } : {})}
      {...(help !== undefined ? { help } : {})}
      {...(error !== undefined ? { error } : {})}
      {...(className ? { className } : {})}
      {...(disabled ? { disabled } : {})}
      {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
      {...(title ? { title } : {})}
    />
  );
}
