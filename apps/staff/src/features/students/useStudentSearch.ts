import { studentsQueries, type Ctx, type StudentListQuery, type StudentSummary } from "@mtb/api";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/**
 * Students for a picker (Combobox), searched on the server as the user types: name, G.R. number or father's CNIC.
 * The plain list stops at the first 2,000 students by name, so filtering it in the browser misses most of a campus.
 * Pass `onSearchChange` to the Combobox and call `remember` with the picked G.R. so the choice stays shown when the
 * next search no longer returns it.
 */
export function useStudentSearch(ctx: Ctx, base: StudentListQuery, enabled: boolean, options: { searchOnly?: boolean; initialSearch?: string } = {}) {
  const [search, setSearch] = useState(options.initialSearch ?? "");
  const [debounced, setDebounced] = useState(options.initialSearch ?? "");
  const [picked, setPicked] = useState<StudentSummary | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const q = debounced.length >= 2 ? debounced : "";
  // searchOnly: nothing is listed until two letters are typed (pickers that would otherwise open on a long list).
  const list = useQuery({ ...studentsQueries.list(ctx, q ? { ...base, q } : base), enabled: enabled && (!options.searchOnly || q !== ""), placeholderData: keepPreviousData });
  const items = options.searchOnly && q === "" ? [] : (list.data?.items ?? []);
  const students = picked && !items.some((s) => s.grNo === picked.grNo) ? [picked, ...items] : items;
  return {
    students,
    loading: list.isLoading,
    onSearchChange: setSearch,
    remember: (grNo: string) => setPicked(students.find((s) => s.grNo === grNo) ?? null),
  };
}
