import type { StudentPersonalExtras } from "@mtb/api";
import { normalizeMobile } from "@mtb/domain";
import { Input, Select, Textarea } from "@mtb/ui";
import { z } from "zod";

/**
 * The rest of the legacy admission form (Student Admission, Candidates Registration): identity, contact, parents'
 * work and education, and an emergency contact. Used on a new application and when correcting a student's record.
 */

export const RELIGIONS = ["Islam", "Christianity", "Hinduism", "Sikhism", "Other"];

const optionalEmail = z.string().trim().refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), { error: "Enter an email address such as name@example.com." });
const optionalPhone = z.string().refine((v) => !v.trim() || /^0\d{9,10}$/.test(v.replace(/[\s-]/g, "")), { error: "Enter a landline with the area code, e.g. 068-5551234." });
const optionalMobile = z.string().refine((v) => !v.trim() || normalizeMobile(v) !== null, { error: "Enter a Pakistani mobile number, e.g. 0300-1234567." });

/** The child: checks for the extra identity fields. */
export const childExtrasSchema = z.object({
  birthCertificateNo: z.string().trim().refine((v) => !v || /^[A-Za-z0-9/-]{4,20}$/.test(v), { error: "A birth certificate number is 4 to 20 letters, digits or dashes." }),
});

/** The family: email, home phone and the emergency contact. */
export const familyExtrasSchema = z
  .object({
    email: optionalEmail,
    homePhone: optionalPhone,
    emergencyName: z.string(),
    emergencyMobile1: optionalMobile,
    emergencyMobile2: optionalMobile,
  })
  .refine((v) => !v.emergencyMobile1.trim() || v.emergencyName.trim().length >= 3, { path: ["emergencyName"], error: "Enter the emergency contact's name." })
  .refine((v) => !v.emergencyName.trim() || v.emergencyMobile1.trim().length > 0, { path: ["emergencyMobile1"], error: "Enter the emergency contact's mobile." });

/** Flat form values for the fields below. */
export interface ExtrasForm {
  religion: string;
  disability: string;
  identificationMark: string;
  birthCertificateNo: string;
  email: string;
  homePhone: string;
  city: string;
  tempAddress: string;
  fatherQualification: string;
  fatherOccupation: string;
  motherQualification: string;
  motherOccupation: string;
  emergencyName: string;
  emergencyMobile1: string;
  emergencyMobile2: string;
  admissionReference: string;
}

export const EMPTY_EXTRAS: ExtrasForm = {
  religion: "Islam",
  disability: "",
  identificationMark: "",
  birthCertificateNo: "",
  email: "",
  homePhone: "",
  city: "",
  tempAddress: "",
  fatherQualification: "",
  fatherOccupation: "",
  motherQualification: "",
  motherOccupation: "",
  emergencyName: "",
  emergencyMobile1: "",
  emergencyMobile2: "",
  admissionReference: "",
};

export function extrasFrom(x: StudentPersonalExtras): ExtrasForm {
  return {
    religion: x.religion ?? "",
    disability: x.disability ?? "",
    identificationMark: x.identificationMark ?? "",
    birthCertificateNo: x.birthCertificateNo ?? "",
    email: x.email ?? "",
    homePhone: x.homePhone ?? "",
    city: x.city ?? "",
    tempAddress: x.tempAddress ?? "",
    fatherQualification: x.fatherQualification ?? "",
    fatherOccupation: x.fatherOccupation ?? "",
    motherQualification: x.motherQualification ?? "",
    motherOccupation: x.motherOccupation ?? "",
    emergencyName: x.emergencyContact?.name ?? "",
    emergencyMobile1: x.emergencyContact?.mobile1 ?? "",
    emergencyMobile2: x.emergencyContact?.mobile2 ?? "",
    admissionReference: x.admissionReference ?? "",
  };
}

/** Only the filled-in fields, in the API's shape. */
export function extrasBody(f: ExtrasForm): StudentPersonalExtras {
  const t = (v: string) => v.trim();
  const out: StudentPersonalExtras = {};
  for (const k of ["religion", "disability", "identificationMark", "birthCertificateNo", "email", "homePhone", "city", "tempAddress", "fatherQualification", "fatherOccupation", "motherQualification", "motherOccupation", "admissionReference"] as const) {
    if (t(f[k])) out[k] = t(f[k]);
  }
  if (t(f.emergencyName) || t(f.emergencyMobile1)) out.emergencyContact = { name: t(f.emergencyName), mobile1: t(f.emergencyMobile1), ...(t(f.emergencyMobile2) ? { mobile2: t(f.emergencyMobile2) } : {}) };
  return out;
}

type Errs = Record<string, string | undefined>;

/** Religion, disability, mark of identification, birth certificate no. */
export function ChildExtrasFields({ value, onChange, errors = {}, disabled }: { value: ExtrasForm; onChange: (patch: Partial<ExtrasForm>) => void; errors?: Errs; disabled?: boolean }) {
  return (
    <>
      <Select label="Religion" disabled={disabled} value={value.religion} onChange={(e) => onChange({ religion: e.target.value })} options={[{ value: "", label: "Not given" }, ...RELIGIONS]} />
      <Input label="Birth certificate no." disabled={disabled} value={value.birthCertificateNo} onChange={(e) => onChange({ birthCertificateNo: e.target.value })} {...(errors.birthCertificateNo ? { error: errors.birthCertificateNo } : { help: "From the union council certificate, if the family has one." })} />
      <Input label="Disability" disabled={disabled} value={value.disability} onChange={(e) => onChange({ disability: e.target.value })} placeholder="None" help="Anything teachers should know, e.g. needs a front seat." />
      <Input label="Mark of identification" disabled={disabled} value={value.identificationMark} onChange={(e) => onChange({ identificationMark: e.target.value })} placeholder="e.g. Mole on the left cheek" />
    </>
  );
}

/** Email, home phone, city, temporary address, parents' education and work, emergency contact. */
export function FamilyExtrasFields({ value, onChange, errors = {}, disabled, withParents = true }: { value: ExtrasForm; onChange: (patch: Partial<ExtrasForm>) => void; errors?: Errs; disabled?: boolean; withParents?: boolean }) {
  return (
    <>
      <Input label="Email" type="email" disabled={disabled} value={value.email} onChange={(e) => onChange({ email: e.target.value })} error={errors.email} />
      <Input label="Home phone" inputMode="tel" disabled={disabled} value={value.homePhone} onChange={(e) => onChange({ homePhone: e.target.value })} error={errors.homePhone} placeholder="068-5551234" />
      <Input label="City" disabled={disabled} value={value.city} onChange={(e) => onChange({ city: e.target.value })} />
      <div className="sm:col-span-2">
        <Textarea label="Temporary address" rows={2} disabled={disabled} value={value.tempAddress} onChange={(e) => onChange({ tempAddress: e.target.value })} help="Only if the family lives somewhere else for now." />
      </div>
      {withParents && (
        <>
          <Input label="Father's qualification" disabled={disabled} value={value.fatherQualification} onChange={(e) => onChange({ fatherQualification: e.target.value })} placeholder="e.g. B.A." />
          <Input label="Father's occupation" disabled={disabled} value={value.fatherOccupation} onChange={(e) => onChange({ fatherOccupation: e.target.value })} />
          <Input label="Mother's qualification" disabled={disabled} value={value.motherQualification} onChange={(e) => onChange({ motherQualification: e.target.value })} />
          <Input label="Mother's occupation" disabled={disabled} value={value.motherOccupation} onChange={(e) => onChange({ motherOccupation: e.target.value })} />
        </>
      )}
      <fieldset className="m-0 grid gap-4 border-0 p-0 sm:col-span-2 sm:grid-cols-3">
        <legend className="mtb-label mb-1">Emergency contact (someone other than the parents)</legend>
        <Input label="Name" disabled={disabled} value={value.emergencyName} onChange={(e) => onChange({ emergencyName: e.target.value })} error={errors.emergencyName} placeholder="e.g. Uncle, Rafiq Ahmed" />
        <Input label="Mobile 1" inputMode="tel" disabled={disabled} value={value.emergencyMobile1} onChange={(e) => onChange({ emergencyMobile1: e.target.value })} error={errors.emergencyMobile1} />
        <Input label="Mobile 2" inputMode="tel" disabled={disabled} value={value.emergencyMobile2} onChange={(e) => onChange({ emergencyMobile2: e.target.value })} error={errors.emergencyMobile2} />
      </fieldset>
    </>
  );
}
