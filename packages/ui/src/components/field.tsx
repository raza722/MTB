import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { cx } from "../lib/cx";

export interface FieldControl {
  id: string;
  invalid: boolean;
  /** ids of the help or error text, for aria-describedby */
  describedBy: string | undefined;
}

export interface FieldProps {
  label?: ReactNode;
  required?: boolean;
  help?: ReactNode;
  /** Say what to do: "Enter all 13 digits: 36302-4567890-1". Sets aria-invalid and the danger border. */
  error?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode | ((control: FieldControl) => ReactNode);
}

/** Label above, control, then error (if any) or help below. */
export function Field({ label, required, help, error, htmlFor, className, children }: FieldProps) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  const messageId = `${id}-msg`;
  const hasMessage = Boolean(error || help);
  const control: FieldControl = { id, invalid: Boolean(error), describedBy: hasMessage ? messageId : undefined };
  return (
    <div className={cx("mtb-field", className)}>
      {label && (
        <label className="mtb-label" htmlFor={id}>
          {label}
          {required && (
            <span className="mtb-req" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {typeof children === "function" ? children(control) : children}
      {error ? (
        <div className="mtb-error" id={messageId} role="alert">
          <Icon name="alertCircle" />
          <span>{error}</span>
        </div>
      ) : help ? (
        <div className="mtb-help" id={messageId}>
          {help}
        </div>
      ) : null}
    </div>
  );
}

type FieldOwnProps = Pick<FieldProps, "label" | "required" | "help" | "error">;

export interface InputProps extends Omit<ComponentProps<"input">, "size" | "prefix">, FieldOwnProps {
  /** Decorative icon on the left. */
  icon?: IconName;
  /** Text on the right, e.g. "/ 75". */
  suffix?: ReactNode;
  /** MTB addition: text on the left, e.g. "Rs". */
  prefix?: ReactNode;
  /** MTB addition: a small button inside the right edge (calendar, show password). */
  action?: ReactNode;
  /** 44px field for mobile. */
  size?: "lg";
  /** Noto Nastaliq Urdu, right-to-left, lang="ur". */
  urdu?: boolean;
  /** Identifiers read digit by digit (CNIC, G.R., receipt numbers). */
  mono?: boolean;
  /** Right-aligned tabular figures for money. */
  amount?: boolean;
  inputClassName?: string;
}

export function Input({ label, required, help, error, icon, suffix, prefix, action, size, urdu, mono, amount, className, inputClassName, id, ...rest }: InputProps) {
  return (
    <Field label={label} required={required} help={help} error={error} className={className} {...(id ? { htmlFor: id } : {})}>
      {(c) => (
        <div className={cx("mtb-input-wrap", icon && "has-icon", Boolean(prefix) && "has-prefix", Boolean(action) && "has-action")}>
          {icon && <Icon name={icon} />}
          {prefix && (
            <span className="mtb-input-prefix" aria-hidden="true">
              {prefix}
            </span>
          )}
          <input
            id={c.id}
            className={cx("mtb-input", size === "lg" && "mtb-input-lg", urdu && "mtb-input-urdu", mono && "is-mono", amount && "is-amount", c.invalid && "is-invalid", inputClassName)}
            aria-invalid={c.invalid || undefined}
            aria-describedby={c.describedBy}
            aria-required={required || undefined}
            dir={urdu ? "rtl" : undefined}
            lang={urdu ? "ur" : undefined}
            {...rest}
          />
          {suffix && <span className="mtb-input-suffix">{suffix}</span>}
          {action && <span className="mtb-input-action">{action}</span>}
        </div>
      )}
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends ComponentProps<"select">, FieldOwnProps {
  options?: Array<string | SelectOption>;
}

/** Native select: fastest for keyboard users and reliable on every device. */
export function Select({ label, required, help, error, options = [], className, children, id, ...rest }: SelectProps) {
  return (
    <Field label={label} required={required} help={help} error={error} className={className} {...(id ? { htmlFor: id } : {})}>
      {(c) => (
        <select id={c.id} className={cx("mtb-select", c.invalid && "is-invalid")} aria-invalid={c.invalid || undefined} aria-describedby={c.describedBy} {...rest}>
          {children ??
            options.map((o) =>
              typeof o === "string" ? (
                <option key={o} value={o}>
                  {o}
                </option>
              ) : (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ),
            )}
        </select>
      )}
    </Field>
  );
}

export interface TextareaProps extends ComponentProps<"textarea">, FieldOwnProps {
  urdu?: boolean;
}

export function Textarea({ label, required, help, error, urdu, className, id, ...rest }: TextareaProps) {
  return (
    <Field label={label} required={required} help={help} error={error} className={className} {...(id ? { htmlFor: id } : {})}>
      {(c) => (
        <textarea
          id={c.id}
          className={cx("mtb-textarea", c.invalid && "is-invalid", urdu && "mtb-ur")}
          dir={urdu ? "rtl" : undefined}
          lang={urdu ? "ur" : undefined}
          aria-invalid={c.invalid || undefined}
          aria-describedby={c.describedBy}
          {...rest}
        />
      )}
    </Field>
  );
}

export interface CheckboxProps extends Omit<ComponentProps<"input">, "size" | "type"> {
  label?: ReactNode;
  /** 24px box for touch. */
  size?: "lg";
  /** Mixed state, e.g. "select all" when only some rows are selected. */
  indeterminate?: boolean;
}

export function Checkbox({ label, size, indeterminate, className, ...rest }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <label className={cx("mtb-check", size === "lg" && "mtb-check-lg", className)}>
      <input ref={ref} type="checkbox" {...rest} />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Radio({ label, className, ...rest }: Omit<CheckboxProps, "indeterminate" | "size">) {
  return (
    <label className={cx("mtb-check", className)}>
      <input type="radio" {...rest} />
      {label && <span>{label}</span>}
    </label>
  );
}

export interface SwitchProps extends Omit<ComponentProps<"input">, "type" | "size"> {
  label?: ReactNode;
  /** Only the "Pause all SMS" kill switch uses danger. */
  danger?: boolean;
}

export function Switch({ label, danger, className, ...rest }: SwitchProps) {
  return (
    <label className={cx("mtb-switch", danger && "mtb-switch-danger", className)}>
      <input type="checkbox" role="switch" {...rest} />
      {label && <span>{label}</span>}
    </label>
  );
}

export interface SegmentedOption {
  value: string;
  label: ReactNode;
}

export interface SegmentedProps {
  options: Array<string | SegmentedOption>;
  value: string;
  onChange: (value: string) => void;
  /** 40px segments with 44px hit area, for the teacher app. */
  touch?: boolean;
  "aria-label"?: string;
  className?: string;
}

export function Segmented({ options, value, onChange, touch, className, "aria-label": ariaLabel }: SegmentedProps) {
  return (
    <div className={cx("mtb-seg", touch && "mtb-seg-touch", className)} role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? o : o.label;
        return (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
            {l}
          </button>
        );
      })}
    </div>
  );
}
