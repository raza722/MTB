import { Dialog } from "radix-ui";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { IconButton } from "./button";

export interface BottomSheetProps {
  open: boolean;
  /** Omit while something is being sent, so the sheet can't be closed half-way. */
  onClose?: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Actions, full width on a phone: secondary first, primary last. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/**
 * MTB addition: the phone's dialog. Slides up from the bottom edge, within thumb reach, over a scrim; Esc, the
 * scrim and the close button dismiss it. Used by the teacher app and the parent portal for confirmations and short
 * forms (the desktop apps use Modal and SidePanel). Focus returns to whatever opened it.
 */
export function BottomSheet({ open, onClose, title, description, footer, children, className }: BottomSheetProps) {
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose?.()}>
      <Dialog.Portal>
        <Dialog.Overlay className="mtb-scrim" />
        <Dialog.Content
          className={cx(
            "mtb-rise fixed inset-x-0 bottom-0 z-[51] mx-auto flex max-h-[88dvh] w-full max-w-[560px] flex-col rounded-t-[16px] border border-b-0 border-border bg-surface-raised text-ink shadow-lg outline-none",
            className,
          )}
          style={{ animationDuration: "220ms" }}
          {...(description ? {} : { "aria-describedby": undefined })}
          onEscapeKeyDown={(e) => !onClose && e.preventDefault()}
          onInteractOutside={(e) => !onClose && e.preventDefault()}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (opener.current?.isConnected) opener.current.focus();
            opener.current = null;
          }}
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong" aria-hidden="true" />
          <header className="flex items-start gap-3 px-4 pt-3 pb-2">
            <div className="min-w-0 flex-1">
              <Dialog.Title asChild>
                <h2 className="m-0 text-title-2 text-ink">{title}</h2>
              </Dialog.Title>
              {description && (
                <Dialog.Description asChild>
                  <p className="m-0 mt-1 text-small text-ink-muted">{description}</p>
                </Dialog.Description>
              )}
            </div>
            {onClose && <IconButton icon="x" label="Close" size="touch" className="-me-2 -mt-1" onClick={onClose} />}
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
          {footer && <footer className="flex shrink-0 gap-2 border-t border-border px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] [&>*]:flex-1">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
