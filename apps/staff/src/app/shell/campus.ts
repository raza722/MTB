import type { CampusScope } from "@mtb/api";

/** Campus names from the legacy docs (one database per campus today). */
export const CAMPUS_LABEL: Record<CampusScope, string> = {
  ALL: "All campuses",
  KC: "Khalid Campus",
  SM: "Sugar Mill Campus",
  UC: "Ubaid Campus",
  MC: "Majeed Campus",
  HC: "Humaira Campus",
};

export const campusLabel = (c: CampusScope) => CAMPUS_LABEL[c];
export const CAMPUS_CODES: CampusScope[] = ["ALL", "KC", "SM", "UC", "MC", "HC"];
