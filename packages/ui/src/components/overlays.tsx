import { AlertDialog, Dialog, DropdownMenu, Tooltip as TooltipPrimitive } from "radix-ui";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { cx } from "../lib/cx";
import { Button, IconButton } from "./button";
import { Banner } from "./feedback";
import { Input } from "./field";

/*
 * Overlays keep the design system's markup and classes (mtb-scrim, mtb-modal, mtb-panel, mtb-confirm-*)
 * but run on Radix, which adds a focus trap and labels the dialog.
 */

/**
 * Our overlays are opened by props, not by a Radix Trigger, so Radix can't find the element to return
 * focus to. Remember whatever had focus when the overlay opened and put focus back there on close.
 */
function useReturnFocus(open: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    // Layout effects run before Radix moves focus into the dialog, so this is still the opener.
    if (open) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);
  return (e: Event) => {
    e.preventDefault();
    if (opener.current?.isConnected) opener.current.focus();
    opener.current = null;
  };
}

export interface ModalProps {
  open: boolean;
  /** Omit to make the modal non-dismissable (no close button, Esc and scrim do nothing). */
  onClose?: () => void;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  /** Secondary action left, primary right. */
  footerSplit?: boolean;
  /** lg 760px · xl 960px (receipt preview). */
  size?: "lg" | "xl";
  children?: ReactNode;
}

export function Modal({ open, onClose, title, description, footer, footerSplit, size, children }: ModalProps) {
  const returnFocus = useReturnFocus(open);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose?.()}>
      <Dialog.Portal>
        <Dialog.Overlay className="mtb-scrim" />
        <div className="mtb-modal-center">
          <Dialog.Content
            className={cx("mtb-modal", size && `mtb-modal-${size}`)}
            {...(description ? {} : { "aria-describedby": undefined })}
            onEscapeKeyDown={(e) => !onClose && e.preventDefault()}
            onInteractOutside={(e) => !onClose && e.preventDefault()}
            onCloseAutoFocus={returnFocus}
          >
            {title ? (
              <header className="mtb-modal-header">
                <div>
                  <Dialog.Title asChild>
                    <h2>{title}</h2>
                  </Dialog.Title>
                  {description && (
                    <Dialog.Description asChild>
                      <p>{description}</p>
                    </Dialog.Description>
                  )}
                </div>
                {onClose && <IconButton icon="x" label="Close" onClick={onClose} />}
              </header>
            ) : (
              <Dialog.Title className="mtb-sr-only">Dialog</Dialog.Title>
            )}
            <div className="mtb-modal-body">{children}</div>
            {footer && <footer className={cx("mtb-modal-footer", footerSplit && "is-split")}>{footer}</footer>}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Secondary left, primary right. */
  footer?: ReactNode;
  /** 720px, for a duplicate-person comparison. */
  wide?: boolean;
  children?: ReactNode;
}

/** A right-hand drawer for a record's detail or a short form that keeps the page in view. */
export function SidePanel({ open, onClose, title, description, footer, wide, children }: SidePanelProps) {
  const returnFocus = useReturnFocus(open);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="mtb-scrim" />
        <Dialog.Content
          className={cx("mtb-panel", wide && "mtb-panel-wide")}
          {...(description ? {} : { "aria-describedby": undefined })}
          onCloseAutoFocus={returnFocus}
        >
          <header className="mtb-panel-header">
            <div>
              <Dialog.Title asChild>
                <h2>{title}</h2>
              </Dialog.Title>
              {description && (
                <Dialog.Description asChild>
                  <p>{description}</p>
                </Dialog.Description>
              )}
            </div>
            <IconButton icon="x" label="Close" onClick={onClose} />
          </header>
          <div className="mtb-panel-body">{children}</div>
          {footer && <footer className="mtb-panel-footer">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** A question: "Post this receipt?" */
  title: ReactNode;
  /** What will happen. */
  message?: ReactNode;
  /** Label/value pairs restating the figures. */
  details?: Array<[ReactNode, ReactNode]>;
  /** Names the action: "Post receipt · Rs 12,250". */
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "brand" | "danger" | "warning";
  icon?: IconName;
  loading?: boolean;
  /** MTB addition: label while loading, e.g. "Posting…". */
  loadingLabel?: string;
  /** MTB addition: the user must type this word to enable confirm, e.g. "DECLARE", "PAUSE". */
  requireText?: string;
  /** MTB addition: a warning shown above the buttons ("Posting can't be undone…"). */
  warning?: ReactNode;
  /** MTB addition: an error after a failed attempt ("Receipt not posted — safe to try again."). */
  error?: ReactNode;
  children?: ReactNode;
}

/** The required form for irreversible actions. Confirm (or the typing field) receives initial focus. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  details,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "brand",
  icon,
  loading,
  loadingLabel,
  requireText,
  warning,
  error,
  children,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const returnFocus = useReturnFocus(open);
  const ic: IconName = icon ?? (tone === "brand" ? "lock" : "alert");
  const typedOk = !requireText || typed.trim() === requireText;
  const close = () => {
    if (loading) return;
    setTyped("");
    onClose();
  };
  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="mtb-scrim" />
        <div className="mtb-modal-center">
          <AlertDialog.Content
            className="mtb-modal"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
            }}
            onCloseAutoFocus={returnFocus}
          >
            <div className="mtb-confirm-body">
              <span className={cx("mtb-modal-icon", tone !== "brand" && `tone-${tone}`)} aria-hidden="true">
                <Icon name={ic} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <AlertDialog.Title asChild>
                  <h2>{title}</h2>
                </AlertDialog.Title>
                <AlertDialog.Description asChild>
                  <p>{message}</p>
                </AlertDialog.Description>
                {details && (
                  <ul className="mtb-confirm-list">
                    {details.map(([k, v], i) => (
                      <li key={i}>
                        <span>{k}</span>
                        <b>{v}</b>
                      </li>
                    ))}
                  </ul>
                )}
                {children}
                {(warning || error || requireText) && (
                  <div className="mtb-confirm-extra">
                    {warning && <Banner tone="warning">{warning}</Banner>}
                    {error && <Banner tone="danger">{error}</Banner>}
                    {requireText && (
                      <Input
                        label={
                          <>
                            Type <code>{requireText}</code> to confirm
                          </>
                        }
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        data-autofocus
                        mono
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
            <footer className="mtb-modal-footer">
              <Button variant="secondary" onClick={close} disabled={loading}>
                {cancelLabel}
              </Button>
              <Button
                variant={tone === "danger" ? "danger" : "primary"}
                onClick={onConfirm}
                loading={loading}
                {...(loadingLabel ? { loadingLabel } : {})}
                disabled={!typedOk}
                {...(requireText ? {} : { "data-autofocus": true })}
              >
                {confirmLabel}
              </Button>
            </footer>
          </AlertDialog.Content>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** Wrap the app once so tooltips share one delay. */
export const TooltipProvider = TooltipPrimitive.Provider;

/** Short explanations: "50 days × Rs 10", "Post is off until debits equal credits". */
export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className="mtb-tooltip" side={side} sideOffset={6}>
          {content}
          <TooltipPrimitive.Arrow className="mtb-tooltip-arrow" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/** Dropdown menu (user menu, campus switcher, row actions). Arrow keys, typeahead and Esc come from Radix. */
export function Menu({ trigger, align = "start", children, label }: { trigger: ReactNode; align?: "start" | "end"; children: ReactNode; label?: string }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="mtb-menu mtb-menu-floating" align={align} sideOffset={6} aria-label={label}>
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({ icon, checked, onSelect, disabled, children }: { icon?: IconName; checked?: boolean; onSelect?: () => void; disabled?: boolean; children: ReactNode }) {
  const body = (
    <>
      {icon && <Icon name={icon} />}
      <span style={{ flex: 1 }}>{children}</span>
      {checked && <Icon name="check" />}
    </>
  );
  return checked === undefined ? (
    <DropdownMenu.Item className="mtb-menu-item" {...(onSelect ? { onSelect } : {})} {...(disabled ? { disabled } : {})}>
      {body}
    </DropdownMenu.Item>
  ) : (
    <DropdownMenu.CheckboxItem className="mtb-menu-item" checked={checked} {...(onSelect ? { onSelect } : {})} {...(disabled ? { disabled } : {})}>
      {body}
    </DropdownMenu.CheckboxItem>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="mtb-menu-label">{children}</DropdownMenu.Label>;
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="mtb-menu-sep" />;
}
