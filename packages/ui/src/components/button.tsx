import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { cx } from "../lib/cx";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "ghost" | "danger" | "danger-quiet";
/** sm 32px · default 40px · touch 44px (mandatory on mobile). `lg` is the same height as `touch`. */
export type ButtonSize = "sm" | "lg" | "touch";

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  block?: boolean;
  /** Keeps the width, shows a spinner and swallows clicks, so an action can't be sent twice. */
  loading?: boolean;
  /** MTB addition: keep a visible label beside the spinner while loading, e.g. "Posting…". */
  loadingLabel?: ReactNode;
}

/** Class string for things that look like a Button but aren't one (router links). */
export function buttonClassName({ variant = "secondary", size, block, className }: Pick<ButtonProps, "variant" | "size" | "block" | "className"> = {}) {
  return cx("mtb-btn", `mtb-btn-${variant}`, size && `mtb-btn-${size}`, block && "mtb-btn-block", className);
}

export function Button({ variant = "secondary", size, icon, iconRight, block, loading, loadingLabel, className, children, type = "button", onClick, ...rest }: ButtonProps) {
  const busy = Boolean(loading);
  const showLabel = busy && loadingLabel !== undefined;
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  return (
    <button
      type={type}
      className={cx(
        buttonClassName({ variant, size, block }),
        busy && !showLabel && "mtb-btn-loading",
        showLabel && "mtb-btn-busy",
        !children && icon && "mtb-btn-icon",
        className,
      )}
      aria-busy={busy || undefined}
      aria-disabled={busy || rest.disabled || undefined}
      onClick={handleClick}
      {...rest}
    >
      {showLabel ? (
        <>
          <span className="mtb-spinner" aria-hidden="true" />
          {loadingLabel}
        </>
      ) : (
        <>
          {icon && <Icon name={icon} />}
          {children}
          {iconRight && <Icon name={iconRight} />}
        </>
      )}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, "icon" | "children"> {
  icon: IconName;
  /** Accessible name; also shown as the native tooltip. */
  label: string;
}

export function IconButton({ icon, label, variant = "ghost", className, ...rest }: IconButtonProps) {
  return <Button variant={variant} icon={icon} aria-label={label} title={label} className={cx("mtb-btn-icon", className)} {...rest} />;
}
