import { formatRs, type IsoDate } from "@mtb/domain";
import { AmountInput, Checkbox, CnicInput, Combobox, DatePicker, Input, Radio, Segmented, Select, Switch, Textarea } from "@mtb/ui";
import { useState } from "react";
import { Code, Section, Specimen, StateCell } from "../ds-kit";
import { ACCOUNTS, DEMO_TODAY } from "../demo-data";

export function InputsSection() {
  const [cnic, setCnic] = useState("3630245678901");
  const [cnicBad, setCnicBad] = useState("36302456");
  const [amount, setAmount] = useState<number | null>(13000);
  const [date, setDate] = useState<IsoDate | null>(DEMO_TODAY);
  const [account, setAccount] = useState<string | null>("1101");
  const [method, setMethod] = useState("cash");
  const [mark, setMark] = useState("P");
  const [sms, setSms] = useState(true);
  const total = 12250;
  const change = amount === null ? null : amount - total;

  return (
    <Section id="inputs" title="Inputs" intro="Labels sit above fields in caption style. Errors replace the help text and say what to do. Read-only values (an assigned receipt number) use readOnly, not disabled.">
      <Specimen title="Text input states" note={<>Hover and focus are frozen with <Code>data-force</Code> for comparison; the focus ring is the design system's blue focus-ring token.</>}>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <StateCell label="Default">
            <Input label="Student name" placeholder="Search by name, G.R. or CNIC" icon="search" className="w-full" />
          </StateCell>
          <StateCell label="Hover">
            <Input label="Student name" defaultValue="Ayesha" icon="search" data-force="hover" tabIndex={-1} className="w-full" />
          </StateCell>
          <StateCell label="Focus">
            <Input label="Student name" defaultValue="Ayesha Khan" icon="search" data-force="focus" tabIndex={-1} className="w-full" />
          </StateCell>
          <StateCell label="Disabled">
            <Input label="Campus" defaultValue="Khalid Campus" disabled className="w-full" />
          </StateCell>
          <StateCell label="Read-only">
            <Input label="Receipt number" value="Assigned on posting" readOnly className="w-full" />
          </StateCell>
          <StateCell label="Error">
            <Input label="Cheque number" required error="Enter the cheque number printed on the cheque." className="w-full" />
          </StateCell>
          <StateCell label="Suffix">
            <Input label="Marks" defaultValue="68" suffix="/ 75" inputMode="decimal" className="w-full" />
          </StateCell>
          <StateCell label="Help text">
            <Input label="Slip number" help="Printed at the top right of the bank deposit slip." className="w-full" />
          </StateCell>
          <StateCell label="Large (mobile, 44px)">
            <Input label="Mobile number" size="lg" defaultValue="0300-1234567" inputMode="tel" className="w-full" />
          </StateCell>
        </div>
      </Specimen>

      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen title="MTB additions: identifiers, money and dates" note="Built from the design system's Input, so labels, errors and focus behave the same.">
          <div className="grid gap-5">
            <CnicInput label="Father's CNIC" value={cnic} onValueChange={setCnic} help="Search works with or without dashes." />
            <CnicInput label="Father's CNIC (incomplete — tab out to see the error)" value={cnicBad} onValueChange={setCnicBad} />
            <div className="grid gap-2">
              <AmountInput label="Amount received" value={amount} onValueChange={setAmount} size="lg" />
              <span className="mtb-num text-small text-ink-muted">
                Total {formatRs(total)} · Change to return{" "}
                <b className="text-ink">{change === null ? "—" : change < 0 ? `short by ${formatRs(-change)}` : formatRs(change)}</b>
              </span>
            </div>
            <DatePicker label="Deposit date" value={date} onValueChange={setDate} today={DEMO_TODAY} maxDate={DEMO_TODAY} help="Type 04-Nov-2026 or 4/11/2026, or pick from the calendar." />
          </div>
        </Specimen>

        <Specimen title="Choosing" note="Native select for short lists; the searchable combobox for long ones (accounts, students).">
          <div className="grid gap-5">
            <Select label="Class" defaultValue="7-B" options={["6-A", "7-A", "7-B", "7-C", "8-A"]} />
            <Select label="Section (error)" error="Choose a section." options={[{ value: "", label: "Choose…" }, "A", "B", "C"]} defaultValue="" />
            <Combobox label="Account" options={ACCOUNTS} value={account} onValueChange={setAccount} help="Type a name or code." />
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mtb-label mb-2">Payment method</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {[
                  ["cash", "Cash"],
                  ["bank", "Bank deposit"],
                  ["cheque", "Cheque"],
                  ["online", "Online transfer / Raast"],
                ].map(([v, l]) => (
                  <Radio key={v} name="method" value={v} label={l} checked={method === v} onChange={() => setMethod(v!)} />
                ))}
              </div>
            </fieldset>
          </div>
        </Specimen>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Specimen title="Checkbox">
          <div className="grid gap-3">
            <Checkbox label="Annual charges 2026–27" />
            <Checkbox label="Tuition fee – Oct 2026" defaultChecked />
            <Checkbox label="Select all (some selected)" indeterminate readOnly />
            <Checkbox label="Tuition fee – Nov 2026 (not yet due)" disabled />
            <Checkbox label="Large (touch)" size="lg" defaultChecked />
          </div>
        </Specimen>
        <Specimen title="Switch">
          <div className="grid gap-4">
            <Switch label="SMS to guardian after posting" checked={sms} onChange={(e) => setSms(e.target.checked)} />
            <Switch label="Compact rows" />
            <Switch label="Disabled" disabled />
            <Switch label="Pause all SMS (danger: the kill switch only)" danger defaultChecked />
          </div>
        </Specimen>
        <Specimen title="Segmented" note="Attendance register: 44px segments on the teacher app.">
          <div className="grid gap-4">
            <Segmented
              aria-label="Attendance for Ayesha Khan"
              touch
              value={mark}
              onChange={setMark}
              options={[
                { value: "P", label: "Present" },
                { value: "A", label: "Absent" },
                { value: "L", label: "Leave" },
                { value: "LT", label: "Late" },
              ]}
            />
            <Segmented aria-label="Ledger view" value="all" onChange={() => {}} options={["all", "charges", "receipts"]} />
          </div>
        </Specimen>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen title="Textarea">
          <Textarea label="Reason for cancellation" required placeholder="What went wrong, in a sentence." help="Required. The principal sees this note when approving." />
        </Specimen>
        <Specimen title="Urdu fields" note="An Urdu field is the design system's Input or Textarea with urdu: Noto Nastaliq Urdu, right-to-left, lang=ur, 44px tall.">
          <div className="grid gap-4">
            <Input label="Name in Urdu" urdu defaultValue="عائشہ خان" />
            <Textarea
              label="SMS template (Urdu)"
              urdu
              rows={3}
              defaultValue="محترم والدین، {student_name} ({class}) کی {amount_due} روپے فیس کی آخری تاریخ {due_date} ہے۔ یومیہ 10 روپے جرمانے سے بچنے کے لیے براہِ کرم بروقت ادائیگی کریں۔ — MTB {campus}"
            />
          </div>
        </Specimen>
      </div>
    </Section>
  );
}
