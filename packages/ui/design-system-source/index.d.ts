import type * as React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'ghost' | 'danger' | 'danger-quiet';
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant; size?: 'sm' | 'lg' | 'touch'; icon?: IconName; iconRight?: IconName; block?: boolean; loading?: boolean; as?: React.ElementType;
}
export declare function Button(props: ButtonProps): React.ReactElement;
export interface IconButtonProps extends ButtonProps { icon: IconName; label: string }
export declare function IconButton(props: IconButtonProps): React.ReactElement;

export interface FieldProps { label?: React.ReactNode; required?: boolean; help?: React.ReactNode; error?: React.ReactNode; htmlFor?: string; className?: string; children: React.ReactNode | ((id: string, invalid: boolean) => React.ReactNode) }
export declare function Field(props: FieldProps): React.ReactElement;
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> { label?: React.ReactNode; required?: boolean; help?: React.ReactNode; error?: React.ReactNode; icon?: IconName; suffix?: React.ReactNode; size?: 'lg'; urdu?: boolean; inputClassName?: string }
export declare function Input(props: InputProps): React.ReactElement;
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> { label?: React.ReactNode; required?: boolean; help?: React.ReactNode; error?: React.ReactNode; options?: Array<string | { value: string; label: string; disabled?: boolean }> }
export declare function Select(props: SelectProps): React.ReactElement;
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> { label?: React.ReactNode; required?: boolean; help?: React.ReactNode; error?: React.ReactNode; urdu?: boolean }
export declare function Textarea(props: TextareaProps): React.ReactElement;
export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> { label?: React.ReactNode; size?: 'lg' }
export declare function Checkbox(props: CheckboxProps): React.ReactElement;
export declare function Radio(props: CheckboxProps): React.ReactElement;
export interface SwitchProps extends React.InputHTMLAttributes<HTMLInputElement> { label?: React.ReactNode; danger?: boolean }
export declare function Switch(props: SwitchProps): React.ReactElement;
export interface SegmentedProps { options: Array<string | { value: string; label: React.ReactNode }>; value: string; onChange: (value: string) => void; touch?: boolean; 'aria-label'?: string; className?: string }
export declare function Segmented(props: SegmentedProps): React.ReactElement;

export type FeeStatus = 'paid' | 'unpaid' | 'overdue' | 'cancelled';
export type AttendanceStatus = 'present' | 'absent' | 'leave' | 'late' | 'holiday';
export type ResultStatus = 'draft' | 'declared';
export type SignalStatus = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'pending' | 'queued' | 'delivered' | 'failed' | 'brand';
export interface StatusBadgeProps { status: FeeStatus | AttendanceStatus | ResultStatus | SignalStatus; children?: React.ReactNode; size?: 'lg'; dot?: boolean; className?: string }
export declare function StatusBadge(props: StatusBadgeProps): React.ReactElement;

export interface StatCardProps { label: React.ReactNode; value?: React.ReactNode; icon?: IconName; tone?: 'warning' | 'danger' | 'info' | 'neutral'; delta?: number; deltaLabel?: React.ReactNode; meter?: number; meterTone?: 'warning' | 'danger'; foot?: React.ReactNode; loading?: boolean; onClick?: () => void; children?: React.ReactNode }
export declare function StatCard(props: StatCardProps): React.ReactElement;
export interface CardProps { title?: React.ReactNode; actions?: React.ReactNode; pad?: boolean; className?: string; bodyClassName?: string; children?: React.ReactNode }
export declare function Card(props: CardProps): React.ReactElement;

export interface Tab { id: string; label: React.ReactNode; count?: number; icon?: IconName }
export interface TabsProps { tabs: Tab[]; value: string; onChange: (id: string) => void; touch?: boolean; className?: string; 'aria-label'?: string }
export declare function Tabs(props: TabsProps): React.ReactElement;
export declare function TabPanel(props: { id: string; active: boolean; className?: string; children?: React.ReactNode }): React.ReactElement | null;

export interface Column<Row> { key: string; header: React.ReactNode; align?: 'left' | 'right'; width?: number | string; render?: (row: Row, index: number) => React.ReactNode; sortable?: boolean; className?: string }
export interface DataTableProps<Row = any> {
  columns: Column<Row>[]; rows: Row[]; rowKey?: string; loading?: boolean; skeletonRows?: number; empty?: React.ReactNode; density?: 'dense' | 'roomy';
  selectable?: boolean; selected?: Set<any>; onSelectedChange?: (next: Set<any>) => void; onRowClick?: (row: Row) => void; rowClassName?: (row: Row) => string | undefined;
  footer?: Record<string, React.ReactNode>; caption?: string; sort?: { key: string; dir: 'asc' | 'desc' }; onSortChange?: (s: { key: string; dir: 'asc' | 'desc' }) => void;
  stickyHeader?: boolean; maxHeight?: number | string; toolbar?: React.ReactNode; pagination?: React.ReactNode;
}
export declare function DataTable<Row = any>(props: DataTableProps<Row>): React.ReactElement;
export declare function Money(props: { value: number; strike?: boolean; sign?: boolean; className?: string }): React.ReactElement;
export declare function DateText(props: { value: string | Date; className?: string }): React.ReactElement;

export declare function Skeleton(props: { width?: number | string; height?: number | string; style?: React.CSSProperties; className?: string }): React.ReactElement;
export interface EmptyStateProps { icon?: IconName; title?: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }
export declare function EmptyState(props: EmptyStateProps): React.ReactElement;
export interface BannerProps { tone?: 'info' | 'warning' | 'danger' | 'success' | 'neutral'; icon?: IconName; title?: React.ReactNode; actions?: React.ReactNode; className?: string; role?: string; children?: React.ReactNode }
export declare function Banner(props: BannerProps): React.ReactElement;
export declare function Avatar(props: { name?: string; size?: 'sm' | 'lg' | 'xl'; tone?: 1 | 2 | 3 | 4; src?: string; className?: string }): React.ReactElement;
export declare function Stepper(props: { steps: string[]; current: number }): React.ReactElement;

export interface SidePanelProps { open: boolean; onClose: () => void; title: React.ReactNode; description?: React.ReactNode; footer?: React.ReactNode; wide?: boolean; children?: React.ReactNode }
export declare function SidePanel(props: SidePanelProps): React.ReactElement | null;
export interface ModalProps { open: boolean; onClose?: () => void; title?: React.ReactNode; description?: React.ReactNode; footer?: React.ReactNode; footerSplit?: boolean; size?: 'lg' | 'xl'; children?: React.ReactNode }
export declare function Modal(props: ModalProps): React.ReactElement | null;
export interface ConfirmDialogProps { open: boolean; onClose: () => void; onConfirm: () => void; title: React.ReactNode; message?: React.ReactNode; details?: Array<[React.ReactNode, React.ReactNode]>; confirmLabel?: string; cancelLabel?: string; tone?: 'brand' | 'danger' | 'warning'; icon?: IconName; loading?: boolean; children?: React.ReactNode }
export declare function ConfirmDialog(props: ConfirmDialogProps): React.ReactElement | null;

export interface ToastOptions { tone?: 'success' | 'danger' | 'warning' | 'info'; title: React.ReactNode; message?: React.ReactNode; action?: React.ReactNode; duration?: number }
export declare function ToastProvider(props: { children?: React.ReactNode }): React.ReactElement;
export declare function useToast(): (t: ToastOptions | string) => string;
export declare function Toast(props: ToastOptions & { onDismiss?: () => void }): React.ReactElement;

export declare function Menu(props: { open: boolean; onClose: () => void; align?: 'left' | 'right'; style?: React.CSSProperties; children?: React.ReactNode }): React.ReactElement | null;
export declare function MenuItem(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName; checked?: boolean }): React.ReactElement;
export declare function KeyValue(props: { items: Array<[React.ReactNode, React.ReactNode]>; className?: string }): React.ReactElement;

export type IconName = 'dashboard' | 'students' | 'admissions' | 'attendance' | 'exams' | 'fees' | 'accounts' | 'warehouse' | 'sms' | 'hr' | 'settings' | 'search' | 'bell' | 'chevronDown' | 'chevronUp' | 'chevronRight' | 'chevronLeft' | 'arrowLeft' | 'arrowRight' | 'arrowUp' | 'arrowDown' | 'x' | 'check' | 'checkCircle' | 'alert' | 'alertCircle' | 'info' | 'plus' | 'minus' | 'printer' | 'download' | 'upload' | 'wifi' | 'wifiOff' | 'refresh' | 'lock' | 'unlock' | 'shield' | 'eye' | 'eyeOff' | 'calendar' | 'filter' | 'more' | 'menu' | 'sun' | 'moon' | 'logout' | 'home' | 'user' | 'phone' | 'mapPin' | 'idCard' | 'receipt' | 'ban' | 'edit' | 'trash' | 'copy' | 'send' | 'pause' | 'play' | 'merge' | 'split' | 'clock' | 'globe' | 'layers' | 'folder' | 'folderOpen' | 'file' | 'book' | 'trendUp' | 'trendDown' | 'inbox' | 'bolt' | 'cloudOff' | 'cloud' | 'checkSquare' | 'square' | 'star' | 'award' | 'key' | 'smartphone' | 'message' | 'listChecks' | 'building' | 'flag';
export declare function Icon(props: React.SVGAttributes<SVGSVGElement> & { name: IconName; size?: number; label?: string }): React.ReactElement;

export declare const format: {
  money(n: number, opts?: { sign?: boolean }): string; fmtDate(d: string | Date): string; fmtDateLong(d: string | Date): string; fmtTime(d: Date): string; session(startYear: number): string;
  daysBetween(a: string | Date, b: string | Date): number; addDays(d: string | Date, n: number): Date; cnic(s: string): string; phone(s: string): string; initials(name: string): string; TODAY: Date;
};

declare global { interface Window { MTB: typeof import('./index') } }
