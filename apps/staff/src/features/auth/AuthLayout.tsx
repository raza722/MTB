import { AuthScene, type AuthSceneHighlight } from "@mtb/ui";
import type { ReactNode } from "react";

const HIGHLIGHTS: readonly AuthSceneHighlight[] = [
  { icon: "building", text: "Every campus in one place" },
  { icon: "students", text: "Admissions, students and attendance" },
  { icon: "fees", text: "Fees, accounts and payroll" },
  { icon: "exams", text: "Exams, results and printouts" },
];

/** The shared sign-in frame (school crest and the MTB name beside or above the form) with the staff app's wording. */
export function AuthLayout({ title, subtitle, children, aside }: { title: string; subtitle?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <AuthScene name="MTB" tagline="Madrasat-ul-Banat Schools and Colleges" highlights={HIGHLIGHTS} motto="Inspiring success & changing lives · since 1907">
      <main className="mtb-card mtb-auth-card grid gap-5 p-6 sm:p-8">
        <div className="grid gap-1">
          <h1 className="m-0 text-title-1 tracking-tight">{title}</h1>
          {subtitle && <p className="m-0 text-ink-muted">{subtitle}</p>}
        </div>
        {children}
      </main>
      {aside}
      <p className="mtb-auth-foot m-0 text-center text-small text-ink-muted">Trouble signing in? Ask your campus admin.</p>
    </AuthScene>
  );
}
