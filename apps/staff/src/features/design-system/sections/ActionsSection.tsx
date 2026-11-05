import { Button, IconButton, type ButtonVariant } from "@mtb/ui";
import { useState } from "react";
import { Code, Section, Specimen, StateCell } from "../ds-kit";

const VARIANTS: Array<{ variant: ButtonVariant; label: string; use: string }> = [
  { variant: "primary", label: "Post receipt", use: "At most once per view, for the thing the page is for." },
  { variant: "secondary", label: "Print", use: "Everything else." },
  { variant: "quiet", label: "View ledger", use: "Low-emphasis actions inside cards and rows." },
  { variant: "ghost", label: "Clear", use: "Toolbar and icon actions." },
  { variant: "danger", label: "Cancel receipt", use: "Only actions that destroy or cancel." },
  { variant: "danger-quiet", label: "Remove line", use: "Destructive, low emphasis." },
];

const STATES = ["Default", "Hover", "Focus", "Active", "Disabled", "Loading"] as const;

export function ActionsSection() {
  const [posting, setPosting] = useState(false);
  return (
    <Section id="actions" title="Actions" intro="Labels start with a verb and name the object: Post receipt, not Submit; Cancel receipt, not Delete. Cancel on a dialog always means close without doing anything.">
      <Specimen title="Button" note={<>Button/variant/size maps to <Code>{'<Button variant="primary" size="sm">'}</Code>. Hover, focus and active are frozen here so they can be compared.</>} flush>
        <div className="overflow-x-auto">
          <table className="mtb-table">
            <thead>
              <tr>
                <th scope="col" style={{ position: "static" }}>
                  Variant
                </th>
                {STATES.map((s) => (
                  <th key={s} scope="col" style={{ position: "static" }}>
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {VARIANTS.map((v) => (
                <tr key={v.variant}>
                  <td style={{ minWidth: 150 }}>
                    <span className="grid gap-0.5">
                      <Code>{v.variant}</Code>
                      <span className="mtb-cell-secondary">{v.use}</span>
                    </span>
                  </td>
                  <td>
                    <Button variant={v.variant}>{v.label}</Button>
                  </td>
                  <td>
                    <Button variant={v.variant} data-force="hover" tabIndex={-1}>
                      {v.label}
                    </Button>
                  </td>
                  <td>
                    <Button variant={v.variant} data-force="focus" tabIndex={-1}>
                      {v.label}
                    </Button>
                  </td>
                  <td>
                    <Button variant={v.variant} data-force="active" tabIndex={-1}>
                      {v.label}
                    </Button>
                  </td>
                  <td>
                    <Button variant={v.variant} disabled>
                      {v.label}
                    </Button>
                  </td>
                  <td>
                    <Button variant={v.variant} loading tabIndex={-1}>
                      {v.label}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Specimen>

      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen title="Sizes and icons" note="sm 32px for dense toolbars · default 40px on desktop · touch 44px, mandatory on the teacher app and parent portal.">
          <div className="grid gap-5">
            <div className="flex flex-wrap items-end gap-4">
              <StateCell label="sm">
                <Button variant="primary" size="sm" icon="plus">
                  Add line
                </Button>
              </StateCell>
              <StateCell label="default">
                <Button variant="primary" icon="fees">
                  Collect fee
                </Button>
              </StateCell>
              <StateCell label="touch">
                <Button variant="primary" size="touch">
                  Submit
                </Button>
              </StateCell>
              <StateCell label="block (mobile bar)">
                <div className="w-56">
                  <Button variant="primary" size="touch" block>
                    Submit · 31 P · 2 A · 1 L
                  </Button>
                </div>
              </StateCell>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <StateCell label="Icon right">
                <Button iconRight="arrowRight">Continue</Button>
              </StateCell>
              <StateCell label="IconButton">
                <div className="flex gap-1">
                  <IconButton icon="printer" label="Print receipt" />
                  <IconButton icon="download" label="Download PDF" />
                  <IconButton icon="more" label="More actions" />
                  <IconButton icon="x" label="Close" size="sm" />
                </div>
              </StateCell>
            </div>
          </div>
        </Specimen>

        <Specimen
          title="Posting a receipt"
          note={
            <>
              MTB addition: <Code>loadingLabel</Code> keeps a label beside the spinner. While loading the button swallows clicks, so a double-click can't post twice.
            </>
          }
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="lg"
              loading={posting}
              loadingLabel="Posting…"
              onClick={() => {
                setPosting(true);
                setTimeout(() => setPosting(false), 2200);
              }}
            >
              Post receipt · Rs 12,250
            </Button>
            <span className="text-small text-ink-muted">Click to see the posting state for 2 seconds.</span>
          </div>
        </Specimen>
      </div>
    </Section>
  );
}
