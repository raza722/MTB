import { demoControls, resetDemoData } from "@mtb/mocks";
import { Button, Icon, Switch } from "@mtb/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Popover } from "radix-ui";
import { useState } from "react";

/**
 * Presenter's panel, mock mode only: make the next receipt post fail, or reset the demo data of the modules that are
 * still mocked. Sign-in is real now, so there is no "sign in as" here. Not part of the product.
 */
export default function DemoControls() {
  const queryClient = useQueryClient();
  const [failNext, setFailNext] = useState(() => demoControls.get().failNextReceiptPost);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="fixed bottom-4 left-4 z-40 flex h-9 items-center gap-2 rounded-full border border-border-strong bg-surface-raised px-3 text-small font-medium text-ink-muted shadow-md hover:text-ink" aria-label="Demo controls">
          <Icon name="bolt" size={16} /> Demo
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={8} className="mtb-popover z-50 grid w-80 gap-4">
          <div className="grid gap-1">
            <span className="text-title-3">Demo controls</span>
            <span className="text-small text-ink-muted">For the presenter. Modules not built yet use fictional data, which resets when this tab closes.</span>
          </div>
          <Switch
            label="Next receipt post fails (network error)"
            checked={failNext}
            onChange={(e) => {
              demoControls.set((c) => ({ ...c, failNextReceiptPost: e.target.checked }));
              setFailNext(e.target.checked);
            }}
          />
          <Button
            variant="danger-quiet"
            size="sm"
            icon="refresh"
            onClick={() => {
              resetDemoData();
              queryClient.clear();
              // The real sign-in survives a reset of the fictional data, so stay signed in.
              window.location.assign("/dashboard");
            }}
          >
            Reset demo data
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
