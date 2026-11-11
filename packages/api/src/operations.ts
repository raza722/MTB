// Library, warehouse (with the book shop) and transport API — owned by the operations module.
// Library: catalogue of titles and copies, issue and return with a fine worked out from the campus rule,
// overdue reminders, member history, lost and damaged copies, stock counts that correct the records.
// Warehouse: items, suppliers, goods received, issues to departments, returns, a stock ledger per item,
// stock counts with approval, and the book shop (books, uniform and stationery sold to students).
// Transport: vehicles and their documents, routes and stops, students on each route with the monthly
// transport fee sent to Fees, trips and fuel, printable route sheets.
import type { IsoDate, IsoDateTime, Rupees } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ctxKey, ctxQuery, type CampusCode, type Ctx } from "./context";

const j = encodeURIComponent;

/* ================================================================================================ People */

export type OperationsPersonType = "STUDENT" | "STAFF";

/** A student or staff member found by name, G.R. number or staff number. */
export interface OperationsPerson {
  /** G.R. number for a student ("KC-14823"), staff number for staff ("KC-S-0144"). */
  id: string;
  type: OperationsPersonType;
  name: string;
  /** "7-B" for a student, "Teacher" for staff. */
  detail: string;
  /** Father (students only). */
  father: string;
  relation: "s/o" | "d/o" | "";
  mobile: string;
  campus: CampusCode;
  /** False for a student who has left. */
  active: boolean;
}

/* ================================================================================================ Library */

export type LibraryLanguage = "EN" | "UR" | "AR" | "PA";
export const LIBRARY_LANGUAGE_LABEL: Record<LibraryLanguage, string> = { EN: "English", UR: "Urdu", AR: "Arabic", PA: "Punjabi" };
export const LIBRARY_LANGUAGES: LibraryLanguage[] = ["EN", "UR", "AR", "PA"];

/** Staff groups for the loans register and the staff issuance list. */
export const LIBRARY_STAFF_GROUPS = ["Teaching", "Non-teaching", "Management"] as const;

/** MISSING: not found in a stock count, waiting for a decision. LOST/WITHDRAWN: written off. */
export type LibraryCopyStatus = "AVAILABLE" | "ON_LOAN" | "MISSING" | "LOST" | "DAMAGED" | "WITHDRAWN";
export const LIBRARY_COPY_STATUS_LABEL: Record<LibraryCopyStatus, string> = {
  AVAILABLE: "On the shelf",
  ON_LOAN: "On loan",
  MISSING: "Missing",
  LOST: "Lost",
  DAMAGED: "Damaged",
  WITHDRAWN: "Withdrawn",
};

export type LibraryCondition = "NEW" | "GOOD" | "WORN" | "DAMAGED";
export const LIBRARY_CONDITION_LABEL: Record<LibraryCondition, string> = { NEW: "New", GOOD: "Good", WORN: "Worn", DAMAGED: "Damaged" };

/** What happened to a fine: added to the student's fee account, paid at the desk, or waived with a reason. */
export type LibraryFineStatus = "NONE" | "ADDED_TO_FEES" | "PAID" | "WAIVED";
export const LIBRARY_FINE_STATUS_LABEL: Record<LibraryFineStatus, string> = { NONE: "No fine", ADDED_TO_FEES: "Added to fee account", PAID: "Paid at the desk", WAIVED: "Waived" };

export interface LibraryShelf {
  id: string;
  cabinetId: string;
  /** "Shelf 2" */
  label: string;
  /** "C-03 · Shelf 2" */
  fullLabel: string;
  copies: number;
}

/** A library room at a campus (a campus can run several: central, junior, girls' section). Cabinets belong to one. */
export interface LibraryLibrary {
  id: string;
  campus: CampusCode;
  name: string;
  seatingCapacity: number;
  active: boolean;
  cabinets: number;
  copies: number;
  /** Goes up on every save; a save with an older value is refused (409 CONCURRENCY). */
  rowVer: number;
}

export interface LibraryLibraryInput {
  name: string;
  seatingCapacity: number;
  active: boolean;
  rowVer?: number;
}

export interface LibraryCabinet {
  id: string;
  campus: CampusCode;
  libraryId: string;
  libraryName: string;
  /** "C-03" */
  code: string;
  title: string;
  capacity: number;
  shelves: LibraryShelf[];
  copies: number;
  active: boolean;
  rowVer: number;
}

export interface LibraryCategory {
  id: string;
  name: string;
  nameUr: string;
  titles: number;
  active: boolean;
}

/** Authors and publishers are kept once each: typing a name picks the existing one. */
export interface LibraryNameCount {
  name: string;
  titles: number;
  copies: number;
}

export interface LibraryFinePolicy {
  borrowerType: OperationsPersonType;
  loanDays: number;
  graceDays: number;
  ratePerDay: Rupees;
  /** Most books one person may have at a time. */
  maxLoans: number;
  /** The fine never exceeds the copy's cost. */
  capAtCost: boolean;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

export interface LibraryTitle {
  id: string;
  campus: CampusCode;
  title: string;
  titleUr: string;
  authors: string[];
  publisher: string;
  /** "" (with category "") for a migrated title the old system filed under no subject. */
  categoryId: string;
  category: string;
  /** null for a migrated title the old system recorded no language for (shown as "—"); new titles always have one. */
  language: LibraryLanguage | null;
  edition: string;
  /** Volume number of a work in several volumes; null for a single book. */
  volume: number | null;
  publisherCountry: string;
  year: number | null;
  /** Stored without spaces or dashes ("9789694480076"); "" when none. */
  isbn: string;
  pages: number | null;
  copies: number;
  available: number;
  onLoan: number;
  /** Missing, lost, damaged or withdrawn. */
  outOfUse: number;
  /** "C-03 · Shelf 2" for each shelf holding a copy. */
  shelves: string[];
  /** Libraries holding a copy on one of their shelves. */
  libraryIds: string[];
  addedOn: IsoDate;
  rowVer: number;
}

export interface LibraryCopyLoanRef {
  loanId: string;
  borrowerName: string;
  borrowerDetail: string;
  dueOn: IsoDate;
  daysLate: number;
}

export interface LibraryCopy {
  id: string;
  titleId: string;
  campus: CampusCode;
  /**
   * "KC-L-00001" for a copy added here — printed on the spine label. Numbers carried over from the old system are
   * bare digits ("5210"; "5210-B" where the old system gave one number to two books).
   */
  accessionNo: string;
  shelfId: string | null;
  shelfLabel: string | null;
  status: LibraryCopyStatus;
  condition: LibraryCondition;
  cost: Rupees;
  acquiredOn: IsoDate;
  /** When it was put on its current shelf. */
  placedOn: IsoDate | null;
  /** Set when it was reported lost, damaged or withdrawn; cleared when it is put back in use. */
  writtenOff: LibraryWriteOff | null;
  note: string;
  loan: LibraryCopyLoanRef | null;
  /** How many times it has been borrowed. */
  loans: number;
}

export interface LibraryWriteOff {
  on: IsoDate;
  /** Who recorded it. */
  by: string;
  /** The staff member who approved it. */
  approvedBy: string;
  reason: string;
}

/** One copy for the cabinet-wise copy list (GET /library/copies). */
export interface LibraryCopyRow {
  copyId: string;
  titleId: string;
  accessionNo: string;
  title: string;
  titleUr: string;
  category: string;
  libraryName: string;
  cabinetId: string | null;
  cabinetCode: string;
  cabinetTitle: string;
  shelfLabel: string;
  placedOn: IsoDate | null;
  status: LibraryCopyStatus;
  condition: LibraryCondition;
  cost: Rupees;
  writtenOffOn: IsoDate | null;
  approvedBy: string;
}

export interface LibraryLoan {
  id: string;
  campus: CampusCode;
  copyId: string;
  accessionNo: string;
  titleId: string;
  title: string;
  titleUr: string;
  authors: string[];
  borrowerType: OperationsPersonType;
  /** G.R. number for a student, staff number for staff. */
  borrowerId: string;
  borrowerName: string;
  borrowerDetail: string;
  /** Staff only: "Teaching", "Non-teaching" or "Management". Empty for a student. */
  borrowerGroup: string;
  mobile: string;
  issuedOn: IsoDate;
  dueOn: IsoDate;
  returnedOn: IsoDate | null;
  /** Days past the due date (to today while the book is out). */
  daysLate: number;
  /** Worked out from the campus rule: charged at return, or what it would be if returned today. */
  fine: Rupees;
  /** PAID with fineNote "Fine recorded in the old system" for a fine settled before the move. */
  fineStatus: LibraryFineStatus;
  fineNote: string;
  issuedBy: string;
  returnedBy: string | null;
  reminders: number;
  lastReminderAt: IsoDateTime | null;
  /** Set when the copy was reported lost while on loan. */
  lost: boolean;
}

export interface LibraryTitleDetail extends LibraryTitle {
  copyList: LibraryCopy[];
  /** Every loan of every copy, newest first. */
  loans: LibraryLoan[];
}

export interface LibraryLookup {
  copy: LibraryCopy;
  title: LibraryTitle;
  loan: LibraryLoan | null;
}

export interface LibraryActivity {
  id: string;
  at: IsoDateTime;
  kind: "ISSUE" | "RETURN" | "LOST" | "ADDED" | "COUNT" | "REMINDER";
  text: string;
  by: string;
}

export interface LibraryOverview {
  titles: number;
  copies: number;
  available: number;
  onLoan: number;
  overdue: number;
  dueToday: number;
  issuedLast30: number;
  returnedLast30: number;
  /** Fines charged on returns in the last 30 days. */
  finesLast30: Rupees;
  outOfUse: number;
  /** Issues and returns per week, last 10 weeks, oldest first. */
  byWeek: Array<{ weekStart: IsoDate; issued: number; returned: number }>;
  /** Copies per subject, most first; every copy counted once, so the copies add up to `copies`. Titles without a subject
   *  (carried over from the old system) form the last bucket, named "No subject". */
  byCategory: Array<{ name: string; copies: number; onLoan: number }>;
  recent: LibraryActivity[];
  openCount: { id: string; name: string; scanned: number; expected: number } | null;
}

export interface LibraryLoansQuery {
  status?: "OPEN" | "OVERDUE" | "RETURNED" | "ALL";
  borrowerType?: OperationsPersonType | "";
  from?: IsoDate;
  to?: IsoDate;
  q?: string;
  /** Students: class ("7") and section ("B"). */
  cls?: string;
  section?: string;
  /** Staff: "Teaching", "Non-teaching" or "Management". */
  staffGroup?: string;
}

export interface LibraryMember {
  person: OperationsPerson;
  loans: LibraryLoan[];
  policy: LibraryFinePolicy;
  totals: { borrowed: number; open: number; overdue: number; returnedLate: number; finesCharged: Rupees; finesWaived: Rupees };
  /** Empty when the person may borrow; otherwise why not, in plain words. */
  blockReason: string;
}

export interface LibraryTitleInput {
  title: string;
  titleUr: string;
  authors: string[];
  publisher: string;
  categoryId: string;
  language: LibraryLanguage;
  edition: string;
  volume: number | null;
  publisherCountry: string;
  year: number | null;
  isbn: string;
  pages: number | null;
  /** Edits only: the rowVer the form was opened with. */
  rowVer?: number;
}

export interface LibraryCopiesInput {
  count: number;
  shelfId: string | null;
  cost: Rupees;
  acquiredOn: IsoDate;
  condition: LibraryCondition;
}

export interface LibraryIssueInput {
  copyId: string;
  borrowerType: OperationsPersonType;
  borrowerId: string;
  dueOn: IsoDate;
  /** Issue although the borrower has an overdue book (the desk was told). */
  allowOverdue?: boolean;
}

/** FEES: added to the student's fee account. CASH: paid at the desk now. WAIVE: needs a reason. */
export type LibraryFineAction = "FEES" | "CASH" | "WAIVE";

export interface LibraryReturnInput {
  fineAction: LibraryFineAction;
  note: string;
  condition: LibraryCondition;
}

export interface LibraryCopyStatusInput {
  status: "LOST" | "DAMAGED" | "WITHDRAWN" | "AVAILABLE";
  reason: string;
  /** For a copy lost while on loan: charge the replacement cost (student) or waive it. */
  charge?: "FEES" | "WAIVE";
  /** Staff number of the person who approved the write-off. Needed for LOST, DAMAGED and WITHDRAWN. */
  approvedById?: string;
}

export type LibraryCountResult = "FOUND" | "MISSING" | "WRONG_SHELF" | "ON_LOAN_FOUND" | "WRITTEN_OFF_FOUND" | "UNKNOWN" | "ON_LOAN";
export const LIBRARY_COUNT_RESULT_LABEL: Record<LibraryCountResult, string> = {
  FOUND: "Found where expected",
  MISSING: "Not found",
  WRONG_SHELF: "Found on another shelf",
  ON_LOAN_FOUND: "Shown on loan but on the shelf",
  WRITTEN_OFF_FOUND: "Written off but found",
  UNKNOWN: "Not in the catalogue",
  ON_LOAN: "Out on loan (not expected)",
};

export interface LibraryCountRow {
  accessionNo: string;
  copyId: string | null;
  title: string;
  recordedShelf: string;
  scannedShelf: string;
  result: LibraryCountResult;
  /** What closing the count will do, in plain words ("Mark as missing"). */
  action: string;
}

export interface LibraryCountSummary {
  id: string;
  campus: CampusCode;
  name: string;
  cabinetIds: string[];
  /** "C-01, C-02" */
  cabinets: string;
  status: "OPEN" | "CLOSED";
  startedOn: IsoDate;
  startedBy: string;
  closedOn: IsoDate | null;
  closedBy: string | null;
  expected: number;
  scanned: number;
  found: number;
  missing: number;
  /** Rows that need a correction (missing, wrong shelf, written off but found …). */
  discrepancies: number;
}

export interface LibraryCountDetail extends LibraryCountSummary {
  rows: LibraryCountRow[];
  scans: Array<{ accessionNo: string; shelfId: string; shelfLabel: string; at: IsoDateTime }>;
  /** Shelves of the counted cabinets, for the scanner. */
  shelves: LibraryShelf[];
  /** After closing: what was corrected. */
  applied: string[];
}

export interface LibrarySetup {
  libraries: LibraryLibrary[];
  cabinets: LibraryCabinet[];
  categories: LibraryCategory[];
  authors: LibraryNameCount[];
  publishers: LibraryNameCount[];
  policies: LibraryFinePolicy[];
  nextAccessionNo: string;
}

export interface LibraryCabinetInput {
  libraryId: string;
  code: string;
  title: string;
  capacity: number;
  /** Shelf labels in order; existing shelves keep their copies. */
  shelves: string[];
  active: boolean;
  rowVer?: number;
}

export interface LibraryPolicyInput {
  borrowerType: OperationsPersonType;
  loanDays: number;
  graceDays: number;
  ratePerDay: Rupees;
  maxLoans: number;
  capAtCost: boolean;
}

export interface OperationsSmsResult {
  /** Messages written to the outbox. They are held there (SMS sending is off), never sent from this system. */
  queued: number;
  skipped: Array<{ name: string; reason: string }>;
}

/* ================================================================================================ Warehouse */

export const WAREHOUSE_UNITS = ["Piece", "Packet", "Box", "Ream", "Dozen", "Set", "Pair", "Litre", "Bottle", "Kg", "Metre", "Roll", "Can"] as const;

export type WarehouseStockStatus = "OK" | "LOW" | "OUT";
export const WAREHOUSE_STOCK_STATUS_LABEL: Record<WarehouseStockStatus, string> = { OK: "In stock", LOW: "Low", OUT: "Out of stock" };

export interface WarehouseCategory {
  id: string;
  name: string;
  /** Sold to students in the book shop (books, uniform, stationery). */
  forSale: boolean;
  items: number;
  active: boolean;
}

export interface WarehouseItem {
  id: string;
  campus: CampusCode;
  /** "ST-0012" */
  code: string;
  /** The item family: "Register" (legacy item); name is the stocked variety: "Register 200 pages". */
  group: string;
  name: string;
  categoryId: string;
  category: string;
  unit: string;
  consumable: boolean;
  reorderLevel: number;
  /** In the store, ready to issue. */
  onHand: number;
  /** Issued to rooms and not returned (non-consumables: furniture, equipment). */
  inRooms: number;
  /** Weighted average cost of what is in the store. */
  avgCost: Rupees;
  value: Rupees;
  forSale: boolean;
  salePrice: Rupees | null;
  status: WarehouseStockStatus;
  active: boolean;
  lastMovementOn: IsoDate | null;
}

export type WarehouseMovementType = "OPENING" | "RECEIPT" | "ISSUE" | "RETURN" | "SALE" | "SALE_CANCEL" | "ADJUSTMENT" | "REVERSAL";
export const WAREHOUSE_MOVEMENT_LABEL: Record<WarehouseMovementType, string> = {
  OPENING: "Opening balance",
  RECEIPT: "Goods received",
  ISSUE: "Issued",
  RETURN: "Returned",
  SALE: "Sold in book shop",
  SALE_CANCEL: "Sale cancelled",
  ADJUSTMENT: "Stock count adjustment",
  REVERSAL: "Receipt reversed",
};

/** One line of the stock ledger. Rows are never edited: a correction is a new row. */
export interface WarehouseMovement {
  id: string;
  itemId: string;
  date: IsoDate;
  at: IsoDateTime;
  type: WarehouseMovementType;
  docNo: string;
  qtyIn: number;
  qtyOut: number;
  /** Store balance after this row. */
  balance: number;
  /** Supplier, department and room, or student. */
  party: string;
  unitCost: Rupees;
  note: string;
  by: string;
}

export interface WarehouseItemDetail extends WarehouseItem {
  movements: WarehouseMovement[];
  rooms: Array<{ location: string; qty: number }>;
  suppliers: string[];
}

export interface WarehouseItemInput {
  group: string;
  name: string;
  categoryId: string;
  unit: string;
  consumable: boolean;
  reorderLevel: number;
  salePrice: Rupees | null;
  active: boolean;
  /** New items only: what is on the shelf today (posted as an opening balance). */
  openingQty?: number;
  openingCost?: Rupees;
}

export interface WarehouseSupplier {
  id: string;
  campus: CampusCode;
  name: string;
  contact: string;
  /** Landline. */
  phone: string;
  mobile: string;
  email: string;
  address: string;
  ntn: string;
  /** "Stationery, registers" */
  supplies: string;
  active: boolean;
  grns: number;
  purchased: Rupees;
  lastGrnOn: IsoDate | null;
  rowVer: number;
}

export type WarehouseSupplierInput = Pick<WarehouseSupplier, "name" | "contact" | "phone" | "mobile" | "email" | "address" | "ntn" | "supplies" | "active"> & { rowVer?: number };

/** A room or class stock can be issued to. Room numbers are unique across the campus. */
export interface WarehouseRoom {
  /** "Computer lab", "Class 7-B" */
  name: string;
  /** "204" */
  roomNo: string;
  /** 0 = ground floor; null when not recorded. */
  floor: number | null;
  active: boolean;
}

export interface WarehouseDepartment {
  id: string;
  campus: CampusCode;
  name: string;
  /** Rooms and classes stock can be issued to. */
  rooms: WarehouseRoom[];
  issuedThisSession: Rupees;
  active: boolean;
  rowVer: number;
}

export interface WarehouseDepartmentInput {
  name: string;
  rooms: WarehouseRoom[];
  active: boolean;
  rowVer?: number;
}

/** What is held in a room: issued and not returned (GET /warehouse/room-stock). */
export interface WarehouseRoomStock {
  departmentId: string;
  department: string;
  room: string;
  itemId: string;
  code: string;
  itemName: string;
  /** Item family ("Register"). */
  group: string;
  categoryId: string;
  category: string;
  unit: string;
  consumable: boolean;
  qty: number;
}

export interface WarehouseRoomStockQuery {
  departmentId?: string;
  room?: string;
  categoryId?: string;
}

export interface WarehouseSetup {
  categories: WarehouseCategory[];
  departments: WarehouseDepartment[];
  units: string[];
}

export interface WarehouseGrnLine {
  itemId: string;
  itemName: string;
  unit: string;
  qty: number;
  unitPrice: Rupees;
  discountPct: number;
  total: Rupees;
}

export interface WarehouseGrn {
  id: string;
  /** "KC-GRN-2627-0141" */
  no: string;
  campus: CampusCode;
  supplierId: string;
  supplierName: string;
  supplierInvoiceNo: string;
  date: IsoDate;
  lines: WarehouseGrnLine[];
  subtotal: Rupees;
  discount: Rupees;
  freight: Rupees;
  /** Sales tax on the supplier's bill. */
  tax: Rupees;
  /** Subtotal − discount + freight + tax. */
  total: Rupees;
  status: "POSTED" | "REVERSED";
  receivedBy: string;
  postedAt: IsoDateTime;
  note: string;
  reversal: { by: string; at: IsoDateTime; reason: string } | null;
}

export interface WarehouseGrnInput {
  supplierId: string;
  supplierInvoiceNo: string;
  date: IsoDate;
  freight: Rupees;
  tax: Rupees;
  note: string;
  lines: Array<{ itemId: string; qty: number; unitPrice: Rupees; discountPct: number }>;
}

export type WarehouseRequestStatus = "OPEN" | "PARTIAL" | "FULFILLED" | "CANCELLED";
export const WAREHOUSE_REQUEST_STATUS_LABEL: Record<WarehouseRequestStatus, string> = { OPEN: "Waiting", PARTIAL: "Part issued", FULFILLED: "Issued", CANCELLED: "Cancelled" };

export interface WarehouseRequest {
  id: string;
  no: string;
  campus: CampusCode;
  departmentId: string;
  department: string;
  room: string;
  requestedBy: string;
  requestedOn: IsoDate;
  lines: Array<{ itemId: string; itemName: string; unit: string; qty: number; issued: number }>;
  status: WarehouseRequestStatus;
  note: string;
  cancelReason: string;
}

export interface WarehouseRequestInput {
  departmentId: string;
  room: string;
  requestedBy: string;
  note: string;
  lines: Array<{ itemId: string; qty: number }>;
}

export interface WarehouseIssueLine {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  consumable: boolean;
  qty: number;
  returned: number;
  unitCost: Rupees;
  /** What it was used for (the legacy "consumption remarks"). */
  remarks: string;
}

export interface WarehouseIssue {
  id: string;
  /** "KC-ISS-2627-0412" */
  no: string;
  campus: CampusCode;
  date: IsoDate;
  departmentId: string;
  department: string;
  room: string;
  receivedBy: string;
  requestId: string | null;
  requestNo: string | null;
  lines: WarehouseIssueLine[];
  value: Rupees;
  issuedBy: string;
  postedAt: IsoDateTime;
  returns: Array<{ no: string; date: IsoDate; qty: number }>;
}

export interface WarehouseIssueInput {
  departmentId: string;
  room: string;
  receivedBy: string;
  requestId: string | null;
  lines: Array<{ itemId: string; qty: number; remarks: string }>;
}

export interface WarehouseReturn {
  id: string;
  no: string;
  campus: CampusCode;
  date: IsoDate;
  issueId: string;
  issueNo: string;
  department: string;
  room: string;
  lines: Array<{ issueLineId: string; itemId: string; itemName: string; unit: string; qty: number }>;
  reason: string;
  receivedBy: string;
  postedAt: IsoDateTime;
}

export interface WarehouseReturnInput {
  issueId: string;
  reason: string;
  lines: Array<{ issueLineId: string; qty: number }>;
}

export type WarehouseCountStatus = "COUNTING" | "SUBMITTED" | "APPROVED" | "REJECTED";
export const WAREHOUSE_COUNT_STATUS_LABEL: Record<WarehouseCountStatus, string> = { COUNTING: "Counting", SUBMITTED: "Waiting for approval", APPROVED: "Approved and posted", REJECTED: "Sent back" };

export interface WarehouseCountLine {
  itemId: string;
  code: string;
  itemName: string;
  unit: string;
  /** Store balance when the count started. */
  systemQty: number;
  countedQty: number | null;
  difference: number;
  unitCost: Rupees;
  /** Difference × average cost. */
  value: Rupees;
  reason: string;
}

export interface WarehouseCount {
  id: string;
  no: string;
  campus: CampusCode;
  name: string;
  categoryId: string | null;
  category: string;
  status: WarehouseCountStatus;
  startedOn: IsoDate;
  startedBy: string;
  submittedBy: string | null;
  submittedAt: IsoDateTime | null;
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  decisionNote: string;
  lines: WarehouseCountLine[];
  counted: number;
  differences: number;
  gainValue: Rupees;
  lossValue: Rupees;
}

export interface WarehouseSaleLine {
  itemId: string;
  itemName: string;
  qty: number;
  price: Rupees;
  total: Rupees;
}

export interface WarehouseSale {
  id: string;
  /** "KC-BS-2627-000231" */
  receiptNo: string;
  campus: CampusCode;
  campusName: string;
  campusAddress: string;
  at: IsoDateTime;
  grNo: string;
  studentName: string;
  classSection: string;
  father: string;
  relation: "s/o" | "d/o" | "";
  lines: WarehouseSaleLine[];
  total: Rupees;
  amountInWords: string;
  /** CASH: paid at the shop. FEE_ACCOUNT: added to the student's fee account (collected with the fee). */
  payment: "CASH" | "FEE_ACCOUNT";
  received: Rupees | null;
  change: Rupees | null;
  soldBy: string;
  status: "POSTED" | "CANCELLED";
  cancelReason: string;
}

export interface WarehouseSaleInput {
  grNo: string;
  payment: "CASH" | "FEE_ACCOUNT";
  received: Rupees | null;
  lines: Array<{ itemId: string; qty: number }>;
}

export interface WarehouseBookSet {
  id: string;
  campus: CampusCode;
  classShort: string;
  /** "Class 7 book set" */
  name: string;
  lines: Array<{ itemId: string; itemName: string; qty: number; price: Rupees }>;
  total: Rupees;
}

export interface WarehouseShop {
  items: WarehouseItem[];
  bookSets: WarehouseBookSet[];
  today: { sales: number; cash: Rupees; feeAccount: Rupees };
}

export interface WarehouseOverview {
  items: number;
  stockValue: Rupees;
  lowStock: number;
  outOfStock: number;
  openRequests: number;
  countsAwaitingApproval: number;
  receivedLast30: Rupees;
  issuedLast30: Rupees;
  shopToday: Rupees;
  /** Value received and issued per month of the session so far. */
  byMonth: Array<{ month: string; received: Rupees; issued: Rupees }>;
  byDepartment: Array<{ name: string; value: Rupees }>;
  /** Stock per campus (one row when a single campus is selected). */
  byCampus: Array<{ campus: CampusCode; name: string; items: number; value: Rupees; low: number }>;
  lowItems: WarehouseItem[];
  recent: WarehouseMovement[];
}

export interface WarehouseItemsQuery {
  q?: string;
  categoryId?: string;
  status?: WarehouseStockStatus | "";
  forSale?: boolean;
}

/* ================================================================================================ Transport */

export type TransportVehicleType = "BUS" | "COASTER" | "HIACE" | "VAN" | "CAR";
export const TRANSPORT_VEHICLE_TYPE_LABEL: Record<TransportVehicleType, string> = { BUS: "Bus", COASTER: "Coaster", HIACE: "Hiace", VAN: "Van", CAR: "Car" };

export type TransportDocKind = "FITNESS" | "INSURANCE" | "LICENCE" | "PERMIT";
export const TRANSPORT_DOC_LABEL: Record<TransportDocKind, string> = { FITNESS: "Fitness certificate", INSURANCE: "Insurance", LICENCE: "Driver's licence", PERMIT: "Route permit" };

export interface TransportAlert {
  vehicleId: string;
  regNo: string;
  kind: TransportDocKind;
  expiresOn: IsoDate;
  /** Days left; negative when already expired. */
  days: number;
}

export interface TransportVehicle {
  id: string;
  campus: CampusCode;
  /** "BSA-1427" */
  regNo: string;
  type: TransportVehicleType;
  make: string;
  model: string;
  year: number;
  capacity: number;
  ownership: "OWNED" | "CONTRACTED";
  contractor: string;
  driverName: string;
  driverMobile: string;
  licenceNo: string;
  licenceExpiry: IsoDate;
  conductorName: string;
  fitnessExpiry: IsoDate;
  insuranceExpiry: IsoDate;
  permitExpiry: IsoDate;
  odometer: number;
  active: boolean;
  routeId: string | null;
  routeCode: string | null;
  routeName: string | null;
  riders: number;
  alerts: TransportAlert[];
}

export type TransportVehicleInput = Omit<TransportVehicle, "id" | "campus" | "routeId" | "routeCode" | "routeName" | "riders" | "alerts">;

export interface TransportStop {
  id: string;
  name: string;
  /** "07:05" */
  pickupTime: string;
  dropTime: string;
  /** null = the route's fare. */
  fare: Rupees | null;
  riders: number;
}

export interface TransportRoute {
  id: string;
  campus: CampusCode;
  /** "R-03" */
  code: string;
  name: string;
  vehicleId: string | null;
  vehicleRegNo: string;
  /** "Toyota Hiace · BSA-1427" */
  vehicleLabel: string;
  capacity: number;
  riders: number;
  /** Monthly fare for the route; a stop may have its own. */
  fare: Rupees;
  stops: TransportStop[];
  driverName: string;
  driverMobile: string;
  active: boolean;
}

export interface TransportRouteInput {
  code: string;
  name: string;
  vehicleId: string | null;
  fare: Rupees;
  active: boolean;
  stops: Array<{ id?: string; name: string; pickupTime: string; dropTime: string; fare: Rupees | null }>;
}

export type TransportDirection = "BOTH" | "PICKUP" | "DROP";
export const TRANSPORT_DIRECTION_LABEL: Record<TransportDirection, string> = { BOTH: "Both ways", PICKUP: "Morning pickup only", DROP: "Afternoon drop only" };

export interface TransportRider {
  id: string;
  campus: CampusCode;
  type: OperationsPersonType;
  personId: string;
  name: string;
  detail: string;
  father: string;
  mobile: string;
  routeId: string;
  routeCode: string;
  routeName: string;
  stopId: string;
  stopName: string;
  pickupTime: string;
  dropTime: string;
  direction: TransportDirection;
  fromDate: IsoDate;
  toDate: IsoDate | null;
  monthlyFee: Rupees;
  /** BILLED: charged monthly with the fee. PAYROLL: staff, deducted from salary. */
  feeLink: "BILLED" | "PAYROLL";
  status: "ACTIVE" | "ENDED";
  endReason: string;
}

export interface TransportRiderInput {
  type: OperationsPersonType;
  personId: string;
  routeId: string;
  stopId: string;
  direction: TransportDirection;
  fromDate: IsoDate;
  /** Seat a rider on a route that is already full (the office was told). */
  allowOverCapacity?: boolean;
}

/** What assigning a student did in Fees. */
export interface TransportRiderResult {
  rider: TransportRider;
  /** "Transport fee – Nov 2026", or empty for staff. */
  feeHead: string;
  feeDueOn: IsoDate | null;
}

export interface TransportTrip {
  id: string;
  campus: CampusCode;
  date: IsoDate;
  vehicleId: string;
  regNo: string;
  routeId: string | null;
  routeCode: string;
  direction: "PICKUP" | "DROP" | "OTHER";
  /** "Morning pickup", or a trip purpose: "Science fair visit". */
  purpose: string;
  driverName: string;
  departAt: string;
  arriveAt: string;
  startKm: number;
  endKm: number;
  ridersPresent: number;
  note: string;
}

export type TransportTripInput = Omit<TransportTrip, "id" | "campus" | "regNo" | "routeCode">;

export interface TransportFuel {
  id: string;
  campus: CampusCode;
  date: IsoDate;
  vehicleId: string;
  regNo: string;
  litres: number;
  amount: Rupees;
  odometer: number;
  station: string;
  slipNo: string;
  enteredBy: string;
  kmSinceLast: number | null;
  kmPerLitre: number | null;
}

export type TransportFuelInput = Pick<TransportFuel, "date" | "vehicleId" | "litres" | "amount" | "odometer" | "station" | "slipNo">;

export interface TransportOverview {
  vehicles: number;
  activeVehicles: number;
  routes: number;
  riders: number;
  seats: number;
  fullRoutes: number;
  /** Transport fee charged a month to students on routes. */
  monthlyBilling: Rupees;
  alerts: TransportAlert[];
  load: Array<{ routeId: string; code: string; name: string; riders: number; capacity: number }>;
  fuel: Array<{ month: string; litres: number; amount: Rupees }>;
  fuelLast30: Rupees;
  tripsToday: number;
}

export interface TransportRouteSheet {
  route: TransportRoute;
  vehicle: TransportVehicle | null;
  stops: Array<{ stop: TransportStop; riders: TransportRider[] }>;
  campusName: string;
}

/* ================================================================================================ Client */

export const operationsApi = {
  people: (ctx: Ctx, q: string, type: OperationsPersonType | "" = "") => apiFetch<OperationsPerson[]>("/operations/people", { query: { ...ctxQuery(ctx), q, type } }),
};

export const libraryApi = {
  overview: (ctx: Ctx) => apiFetch<LibraryOverview>("/library/overview", { query: ctxQuery(ctx) }),
  titles: (ctx: Ctx) => apiFetch<LibraryTitle[]>("/library/titles", { query: ctxQuery(ctx) }),
  title: (id: string) => apiFetch<LibraryTitleDetail>(`/library/titles/${j(id)}`),
  saveTitle: (ctx: Ctx, body: LibraryTitleInput & { copies?: LibraryCopiesInput }, id?: string) =>
    apiFetch<LibraryTitleDetail>(id ? `/library/titles/${j(id)}` : "/library/titles", { method: id ? "PUT" : "POST", body, query: ctxQuery(ctx) }),
  // Writes on an existing record still send ctx, so the server refuses them while a closed session is selected.
  addCopies: (ctx: Ctx, id: string, body: LibraryCopiesInput) => apiFetch<LibraryTitleDetail>(`/library/titles/${j(id)}/copies`, { method: "POST", body, query: ctxQuery(ctx) }),
  updateCopy: (ctx: Ctx, id: string, body: { shelfId: string | null; condition: LibraryCondition; note: string }) =>
    apiFetch<LibraryCopy>(`/library/copies/${j(id)}`, { method: "PUT", body, query: ctxQuery(ctx) }),
  setCopyStatus: (ctx: Ctx, id: string, body: LibraryCopyStatusInput) => apiFetch<LibraryCopy>(`/library/copies/${j(id)}/status`, { method: "POST", body, query: ctxQuery(ctx) }),
  lookup: (ctx: Ctx, accessionNo: string) => apiFetch<LibraryLookup>("/library/lookup", { query: { ...ctxQuery(ctx), accessionNo } }),
  loans: (ctx: Ctx, q: LibraryLoansQuery = {}) => apiFetch<LibraryLoan[]>("/library/loans", { query: { ...ctxQuery(ctx), ...q } }),
  issue: (ctx: Ctx, body: LibraryIssueInput, idempotencyKey: string) => apiFetch<LibraryLoan>("/library/loans", { method: "POST", body, query: ctxQuery(ctx), idempotencyKey }),
  returnLoan: (ctx: Ctx, id: string, body: LibraryReturnInput) => apiFetch<LibraryLoan>(`/library/loans/${j(id)}/return`, { method: "POST", body, query: ctxQuery(ctx) }),
  renew: (ctx: Ctx, id: string, dueOn: IsoDate) => apiFetch<LibraryLoan>(`/library/loans/${j(id)}/renew`, { method: "POST", body: { dueOn }, query: ctxQuery(ctx) }),
  remind: (ctx: Ctx, body: { loanIds: string[]; language: "en" | "ur" }, idempotencyKey: string) =>
    apiFetch<OperationsSmsResult>("/library/reminders", { method: "POST", body, query: ctxQuery(ctx), idempotencyKey }),
  member: (ctx: Ctx, type: OperationsPersonType, id: string) => apiFetch<LibraryMember>(`/library/members/${type}/${j(id)}`, { query: ctxQuery(ctx) }),
  counts: (ctx: Ctx) => apiFetch<LibraryCountSummary[]>("/library/counts", { query: ctxQuery(ctx) }),
  count: (id: string) => apiFetch<LibraryCountDetail>(`/library/counts/${j(id)}`),
  startCount: (ctx: Ctx, body: { name: string; cabinetIds: string[] }) => apiFetch<LibraryCountDetail>("/library/counts", { method: "POST", body, query: ctxQuery(ctx) }),
  scan: (ctx: Ctx, id: string, body: { accessionNos: string[]; shelfId: string }) =>
    apiFetch<LibraryCountDetail>(`/library/counts/${j(id)}/scans`, { method: "POST", body, query: ctxQuery(ctx) }),
  unscan: (ctx: Ctx, id: string, accessionNo: string) => apiFetch<LibraryCountDetail>(`/library/counts/${j(id)}/scans/${j(accessionNo)}`, { method: "DELETE", query: ctxQuery(ctx) }),
  closeCount: (ctx: Ctx, id: string) => apiFetch<LibraryCountDetail>(`/library/counts/${j(id)}/close`, { method: "POST", query: ctxQuery(ctx) }),
  setup: (ctx: Ctx) => apiFetch<LibrarySetup>("/library/setup", { query: ctxQuery(ctx) }),
  /** Every copy, cabinet by cabinet (the copy-level shelf list). */
  copies: (ctx: Ctx, q: { cabinetId?: string; categoryId?: string; libraryId?: string } = {}) =>
    apiFetch<LibraryCopyRow[]>("/library/copies", { query: { ...ctxQuery(ctx), cabinetId: q.cabinetId || undefined, categoryId: q.categoryId || undefined, libraryId: q.libraryId || undefined } }),
  saveLibrary: (ctx: Ctx, body: LibraryLibraryInput, id?: string) =>
    apiFetch<LibraryLibrary>(id ? `/library/libraries/${j(id)}` : "/library/libraries", { method: id ? "PUT" : "POST", body, query: ctxQuery(ctx) }),
  saveCabinet: (ctx: Ctx, body: LibraryCabinetInput, id?: string) =>
    apiFetch<LibraryCabinet>(id ? `/library/cabinets/${j(id)}` : "/library/cabinets", { method: id ? "PUT" : "POST", body, query: ctxQuery(ctx) }),
  saveCategory: (ctx: Ctx, body: { name: string; nameUr: string; active: boolean }, id?: string) =>
    apiFetch<LibraryCategory>(id ? `/library/categories/${j(id)}` : "/library/categories", { method: id ? "PUT" : "POST", body, query: ctxQuery(ctx) }),
  savePolicy: (ctx: Ctx, body: LibraryPolicyInput) => apiFetch<LibraryFinePolicy>("/library/policies", { method: "PUT", body, query: ctxQuery(ctx) }),
};

export const warehouseApi = {
  overview: (ctx: Ctx) => apiFetch<WarehouseOverview>("/warehouse/overview", { query: ctxQuery(ctx) }),
  items: (ctx: Ctx, q: WarehouseItemsQuery = {}) =>
    apiFetch<WarehouseItem[]>("/warehouse/items", { query: { ...ctxQuery(ctx), q: q.q, categoryId: q.categoryId, status: q.status, forSale: q.forSale ? "1" : undefined } }),
  item: (id: string) => apiFetch<WarehouseItemDetail>(`/warehouse/items/${j(id)}`),
  saveItem: (ctx: Ctx, body: WarehouseItemInput, id?: string) =>
    apiFetch<WarehouseItem>(id ? `/warehouse/items/${j(id)}` : "/warehouse/items", { method: id ? "PUT" : "POST", body, query: ctxQuery(ctx) }),
  setup: (ctx: Ctx) => apiFetch<WarehouseSetup>("/warehouse/setup", { query: ctxQuery(ctx) }),
  saveCategory: (ctx: Ctx, body: { name: string; forSale: boolean; active: boolean }, id?: string) =>
    apiFetch<WarehouseCategory>(id ? `/warehouse/categories/${j(id)}` : "/warehouse/categories", { method: id ? "PUT" : "POST", body, query: ctxQuery(ctx) }),
  roomStock: (ctx: Ctx, q: WarehouseRoomStockQuery = {}) =>
    apiFetch<WarehouseRoomStock[]>("/warehouse/room-stock", { query: { ...ctxQuery(ctx), departmentId: q.departmentId || undefined, room: q.room || undefined, categoryId: q.categoryId || undefined } }),
  saveDepartment: (ctx: Ctx, body: WarehouseDepartmentInput, id?: string) =>
    apiFetch<WarehouseDepartment>(id ? `/warehouse/departments/${j(id)}` : "/warehouse/departments", { method: id ? "PUT" : "POST", body, query: ctxQuery(ctx) }),
  suppliers: (ctx: Ctx) => apiFetch<WarehouseSupplier[]>("/warehouse/suppliers", { query: ctxQuery(ctx) }),
  saveSupplier: (ctx: Ctx, body: WarehouseSupplierInput, id?: string) =>
    apiFetch<WarehouseSupplier>(id ? `/warehouse/suppliers/${j(id)}` : "/warehouse/suppliers", { method: id ? "PUT" : "POST", body, query: ctxQuery(ctx) }),
  grns: (ctx: Ctx) => apiFetch<WarehouseGrn[]>("/warehouse/grns", { query: ctxQuery(ctx) }),
  postGrn: (ctx: Ctx, body: WarehouseGrnInput, idempotencyKey: string) => apiFetch<WarehouseGrn>("/warehouse/grns", { method: "POST", body, query: ctxQuery(ctx), idempotencyKey }),
  reverseGrn: (ctx: Ctx, id: string, reason: string) => apiFetch<WarehouseGrn>(`/warehouse/grns/${j(id)}/reverse`, { method: "POST", body: { reason }, query: ctxQuery(ctx) }),
  requests: (ctx: Ctx) => apiFetch<WarehouseRequest[]>("/warehouse/requests", { query: ctxQuery(ctx) }),
  saveRequest: (ctx: Ctx, body: WarehouseRequestInput) => apiFetch<WarehouseRequest>("/warehouse/requests", { method: "POST", body, query: ctxQuery(ctx) }),
  cancelRequest: (ctx: Ctx, id: string, reason: string) => apiFetch<WarehouseRequest>(`/warehouse/requests/${j(id)}/cancel`, { method: "POST", body: { reason }, query: ctxQuery(ctx) }),
  issues: (ctx: Ctx) => apiFetch<WarehouseIssue[]>("/warehouse/issues", { query: ctxQuery(ctx) }),
  postIssue: (ctx: Ctx, body: WarehouseIssueInput, idempotencyKey: string) => apiFetch<WarehouseIssue>("/warehouse/issues", { method: "POST", body, query: ctxQuery(ctx), idempotencyKey }),
  setRemarks: (ctx: Ctx, issueId: string, lineId: string, remarks: string) =>
    apiFetch<WarehouseIssue>(`/warehouse/issues/${j(issueId)}/lines/${j(lineId)}`, { method: "PUT", body: { remarks }, query: ctxQuery(ctx) }),
  returns: (ctx: Ctx) => apiFetch<WarehouseReturn[]>("/warehouse/returns", { query: ctxQuery(ctx) }),
  postReturn: (ctx: Ctx, body: WarehouseReturnInput, idempotencyKey: string) => apiFetch<WarehouseReturn>("/warehouse/returns", { method: "POST", body, query: ctxQuery(ctx), idempotencyKey }),
  counts: (ctx: Ctx) => apiFetch<WarehouseCount[]>("/warehouse/counts", { query: ctxQuery(ctx) }),
  count: (id: string) => apiFetch<WarehouseCount>(`/warehouse/counts/${j(id)}`),
  startCount: (ctx: Ctx, body: { name: string; categoryId: string | null }) => apiFetch<WarehouseCount>("/warehouse/counts", { method: "POST", body, query: ctxQuery(ctx) }),
  saveCountLines: (ctx: Ctx, id: string, lines: Array<{ itemId: string; countedQty: number | null; reason: string }>) =>
    apiFetch<WarehouseCount>(`/warehouse/counts/${j(id)}/lines`, { method: "PUT", body: { lines }, query: ctxQuery(ctx) }),
  submitCount: (ctx: Ctx, id: string) => apiFetch<WarehouseCount>(`/warehouse/counts/${j(id)}/submit`, { method: "POST", query: ctxQuery(ctx) }),
  decideCount: (ctx: Ctx, id: string, body: { decision: "APPROVE" | "REJECT"; note: string }) =>
    apiFetch<WarehouseCount>(`/warehouse/counts/${j(id)}/decide`, { method: "POST", body, query: ctxQuery(ctx) }),
  shop: (ctx: Ctx) => apiFetch<WarehouseShop>("/warehouse/shop", { query: ctxQuery(ctx) }),
  sales: (ctx: Ctx, date?: IsoDate) => apiFetch<WarehouseSale[]>("/warehouse/sales", { query: { ...ctxQuery(ctx), date } }),
  sale: (id: string) => apiFetch<WarehouseSale>(`/warehouse/sales/${j(id)}`),
  postSale: (ctx: Ctx, body: WarehouseSaleInput, idempotencyKey: string) => apiFetch<WarehouseSale>("/warehouse/sales", { method: "POST", body, query: ctxQuery(ctx), idempotencyKey }),
  cancelSale: (ctx: Ctx, id: string, reason: string) => apiFetch<WarehouseSale>(`/warehouse/sales/${j(id)}/cancel`, { method: "POST", body: { reason }, query: ctxQuery(ctx) }),
  saveBookSet: (ctx: Ctx, id: string, lines: Array<{ itemId: string; qty: number }>) =>
    apiFetch<WarehouseBookSet>(`/warehouse/book-sets/${j(id)}`, { method: "PUT", body: { lines }, query: ctxQuery(ctx) }),
};

export const transportApi = {
  overview: (ctx: Ctx) => apiFetch<TransportOverview>("/transport/overview", { query: ctxQuery(ctx) }),
  vehicles: (ctx: Ctx) => apiFetch<TransportVehicle[]>("/transport/vehicles", { query: ctxQuery(ctx) }),
  saveVehicle: (ctx: Ctx, body: TransportVehicleInput, id?: string) =>
    apiFetch<TransportVehicle>(id ? `/transport/vehicles/${j(id)}` : "/transport/vehicles", { method: id ? "PUT" : "POST", body, query: ctxQuery(ctx) }),
  routes: (ctx: Ctx) => apiFetch<TransportRoute[]>("/transport/routes", { query: ctxQuery(ctx) }),
  saveRoute: (ctx: Ctx, body: TransportRouteInput, id?: string) =>
    apiFetch<TransportRoute>(id ? `/transport/routes/${j(id)}` : "/transport/routes", { method: id ? "PUT" : "POST", body, query: ctxQuery(ctx) }),
  sheets: (ctx: Ctx, routeId?: string) => apiFetch<TransportRouteSheet[]>("/transport/route-sheets", { query: { ...ctxQuery(ctx), routeId } }),
  riders: (ctx: Ctx, q: { routeId?: string; status?: "ACTIVE" | "ENDED" | "ALL" } = {}) => apiFetch<TransportRider[]>("/transport/riders", { query: { ...ctxQuery(ctx), ...q } }),
  assign: (ctx: Ctx, body: TransportRiderInput, idempotencyKey: string) => apiFetch<TransportRiderResult>("/transport/riders", { method: "POST", body, query: ctxQuery(ctx), idempotencyKey }),
  moveRider: (ctx: Ctx, id: string, body: { routeId: string; stopId: string; direction: TransportDirection; allowOverCapacity?: boolean }) =>
    apiFetch<TransportRiderResult>(`/transport/riders/${j(id)}`, { method: "PUT", body, query: ctxQuery(ctx) }),
  endRider: (ctx: Ctx, id: string, body: { toDate: IsoDate; reason: string }) =>
    apiFetch<TransportRider>(`/transport/riders/${j(id)}/end`, { method: "POST", body, query: ctxQuery(ctx) }),
  trips: (ctx: Ctx) => apiFetch<TransportTrip[]>("/transport/trips", { query: ctxQuery(ctx) }),
  addTrip: (ctx: Ctx, body: TransportTripInput) => apiFetch<TransportTrip>("/transport/trips", { method: "POST", body, query: ctxQuery(ctx) }),
  fuel: (ctx: Ctx) => apiFetch<TransportFuel[]>("/transport/fuel", { query: ctxQuery(ctx) }),
  addFuel: (ctx: Ctx, body: TransportFuelInput) => apiFetch<TransportFuel>("/transport/fuel", { method: "POST", body, query: ctxQuery(ctx) }),
};

/* ================================================================================================ Queries */

const lk = (ctx: Ctx, ...rest: unknown[]) => ["library", ...ctxKey(ctx), ...rest] as const;
const wk = (ctx: Ctx, ...rest: unknown[]) => ["warehouse", ...ctxKey(ctx), ...rest] as const;
const tk = (ctx: Ctx, ...rest: unknown[]) => ["transport", ...ctxKey(ctx), ...rest] as const;

export const operationsQueries = {
  people: (ctx: Ctx, q: string, type: OperationsPersonType | "" = "") =>
    queryOptions({ queryKey: ["operations", ...ctxKey(ctx), "people", type, q], queryFn: () => operationsApi.people(ctx, q, type), enabled: q.trim().length >= 2, staleTime: 30_000 }),
};

export const libraryQueries = {
  overview: (ctx: Ctx) => queryOptions({ queryKey: lk(ctx, "overview"), queryFn: () => libraryApi.overview(ctx) }),
  titles: (ctx: Ctx) => queryOptions({ queryKey: lk(ctx, "titles"), queryFn: () => libraryApi.titles(ctx) }),
  title: (ctx: Ctx, id: string) => queryOptions({ queryKey: lk(ctx, "title", id), queryFn: () => libraryApi.title(id), enabled: id !== "" }),
  lookup: (ctx: Ctx, accessionNo: string) =>
    queryOptions({ queryKey: lk(ctx, "lookup", accessionNo), queryFn: () => libraryApi.lookup(ctx, accessionNo), enabled: accessionNo.trim().length >= 1, retry: false }),
  // ^ legacy accession numbers can be 1-2 characters ("57"): the desk only sets accessionNo on Find, so any
  //   non-blank submitted value must run the lookup (fix L5 of backend/docs/modules/11_library.md §9).
  loans: (ctx: Ctx, q: LibraryLoansQuery = {}) =>
    queryOptions({
      queryKey: lk(ctx, "loans", q.status ?? "ALL", q.borrowerType ?? "", q.from ?? "", q.to ?? "", q.q ?? "", q.cls ?? "", q.section ?? "", q.staffGroup ?? ""),
      queryFn: () => libraryApi.loans(ctx, q),
    }),
  copies: (ctx: Ctx, q: { cabinetId?: string; categoryId?: string; libraryId?: string } = {}) =>
    queryOptions({ queryKey: lk(ctx, "copies", q.cabinetId ?? "", q.categoryId ?? "", q.libraryId ?? ""), queryFn: () => libraryApi.copies(ctx, q) }),
  member: (ctx: Ctx, type: OperationsPersonType, id: string) => queryOptions({ queryKey: lk(ctx, "member", type, id), queryFn: () => libraryApi.member(ctx, type, id), enabled: id !== "" }),
  counts: (ctx: Ctx) => queryOptions({ queryKey: lk(ctx, "counts"), queryFn: () => libraryApi.counts(ctx) }),
  count: (ctx: Ctx, id: string) => queryOptions({ queryKey: lk(ctx, "count", id), queryFn: () => libraryApi.count(id) }),
  setup: (ctx: Ctx) => queryOptions({ queryKey: lk(ctx, "setup"), queryFn: () => libraryApi.setup(ctx) }),
};

export const warehouseQueries = {
  overview: (ctx: Ctx) => queryOptions({ queryKey: wk(ctx, "overview"), queryFn: () => warehouseApi.overview(ctx) }),
  items: (ctx: Ctx, q: WarehouseItemsQuery = {}) =>
    queryOptions({ queryKey: wk(ctx, "items", q.q ?? "", q.categoryId ?? "", q.status ?? "", q.forSale ? 1 : 0), queryFn: () => warehouseApi.items(ctx, q) }),
  item: (ctx: Ctx, id: string) => queryOptions({ queryKey: wk(ctx, "item", id), queryFn: () => warehouseApi.item(id), enabled: id !== "" }),
  setup: (ctx: Ctx) => queryOptions({ queryKey: wk(ctx, "setup"), queryFn: () => warehouseApi.setup(ctx) }),
  roomStock: (ctx: Ctx, q: WarehouseRoomStockQuery = {}) =>
    queryOptions({ queryKey: wk(ctx, "room-stock", q.departmentId ?? "", q.room ?? "", q.categoryId ?? ""), queryFn: () => warehouseApi.roomStock(ctx, q) }),
  suppliers: (ctx: Ctx) => queryOptions({ queryKey: wk(ctx, "suppliers"), queryFn: () => warehouseApi.suppliers(ctx) }),
  grns: (ctx: Ctx) => queryOptions({ queryKey: wk(ctx, "grns"), queryFn: () => warehouseApi.grns(ctx) }),
  requests: (ctx: Ctx) => queryOptions({ queryKey: wk(ctx, "requests"), queryFn: () => warehouseApi.requests(ctx) }),
  issues: (ctx: Ctx) => queryOptions({ queryKey: wk(ctx, "issues"), queryFn: () => warehouseApi.issues(ctx) }),
  returns: (ctx: Ctx) => queryOptions({ queryKey: wk(ctx, "returns"), queryFn: () => warehouseApi.returns(ctx) }),
  counts: (ctx: Ctx) => queryOptions({ queryKey: wk(ctx, "counts"), queryFn: () => warehouseApi.counts(ctx) }),
  count: (ctx: Ctx, id: string) => queryOptions({ queryKey: wk(ctx, "count", id), queryFn: () => warehouseApi.count(id) }),
  shop: (ctx: Ctx) => queryOptions({ queryKey: wk(ctx, "shop"), queryFn: () => warehouseApi.shop(ctx) }),
  sales: (ctx: Ctx, date?: IsoDate) => queryOptions({ queryKey: wk(ctx, "sales", date ?? ""), queryFn: () => warehouseApi.sales(ctx, date) }),
  sale: (ctx: Ctx, id: string) => queryOptions({ queryKey: wk(ctx, "sale", id), queryFn: () => warehouseApi.sale(id), enabled: id !== "" }),
};

export const transportQueries = {
  overview: (ctx: Ctx) => queryOptions({ queryKey: tk(ctx, "overview"), queryFn: () => transportApi.overview(ctx) }),
  vehicles: (ctx: Ctx) => queryOptions({ queryKey: tk(ctx, "vehicles"), queryFn: () => transportApi.vehicles(ctx) }),
  routes: (ctx: Ctx) => queryOptions({ queryKey: tk(ctx, "routes"), queryFn: () => transportApi.routes(ctx) }),
  sheets: (ctx: Ctx, routeId?: string) => queryOptions({ queryKey: tk(ctx, "sheets", routeId ?? ""), queryFn: () => transportApi.sheets(ctx, routeId) }),
  riders: (ctx: Ctx, q: { routeId?: string; status?: "ACTIVE" | "ENDED" | "ALL" } = {}) =>
    queryOptions({ queryKey: tk(ctx, "riders", q.routeId ?? "", q.status ?? "ACTIVE"), queryFn: () => transportApi.riders(ctx, q) }),
  trips: (ctx: Ctx) => queryOptions({ queryKey: tk(ctx, "trips"), queryFn: () => transportApi.trips(ctx) }),
  fuel: (ctx: Ctx) => queryOptions({ queryKey: tk(ctx, "fuel"), queryFn: () => transportApi.fuel(ctx) }),
};
