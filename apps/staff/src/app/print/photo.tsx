import { photoUrl } from "@mtb/api";
import { PhotoBox } from "@mtb/ui";
import "./photo.css";

/**
 * The old "no photo" picture: a grey head-and-shoulders outline on white, printed wherever a record had no photo
 * (the student list's and the sports list's "Picture" column, the date of birth certificate).
 */
export function NoPhoto({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 72" className={`mtb-nophoto ${className ?? ""}`} aria-hidden="true">
      <circle cx="30" cy="24" r="13" />
      <path d="M4 72 C4 52 14 42 30 42 C46 42 56 52 56 72 Z" />
    </svg>
  );
}

/** A student's photo on a printout, moved over from the old system; the old grey outline when there is none. */
export function StudentPhoto({ grNo, className }: { grNo: string | null | undefined; className?: string }) {
  return <PhotoBox src={photoUrl.student(grNo)} className={`mtb-print-photo ${className ?? ""}`} fallback={<NoPhoto className={className} />} />;
}

/** A staff member's photo on a printout; the old grey outline when there is none. */
export function StaffPhoto({ employeeNo, campus, className }: { employeeNo: string | null | undefined; campus: string; className?: string }) {
  return <PhotoBox src={photoUrl.staff(employeeNo, campus)} className={`mtb-print-photo ${className ?? ""}`} fallback={<NoPhoto className={className} />} />;
}
