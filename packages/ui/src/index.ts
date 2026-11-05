// @mtb/ui — the MTB Campus design system in React.
// Components mirror the design system's API (components/index.d.ts) and render its classes (bundle.css).
// Items marked "MTB addition" in their docs are not in the design system yet.

export { Icon, ICON_NAMES, type IconName, type IconProps } from "./icons";
export { cx, initials } from "./lib/cx";
export { contrastRatio, formatRatio, parseHex } from "./lib/contrast";

export { Button, IconButton, buttonClassName, type ButtonProps, type ButtonSize, type ButtonVariant, type IconButtonProps } from "./components/button";
export {
  Checkbox,
  Field,
  Input,
  Radio,
  Segmented,
  Select,
  Switch,
  Textarea,
  type CheckboxProps,
  type FieldControl,
  type FieldProps,
  type InputProps,
  type SegmentedOption,
  type SegmentedProps,
  type SelectOption,
  type SelectProps,
  type SwitchProps,
  type TextareaProps,
} from "./components/field";
export {
  AmountInput,
  CnicInput,
  Combobox,
  DatePicker,
  type AmountInputProps,
  type CnicInputProps,
  type ComboboxOption,
  type ComboboxProps,
  type DatePickerProps,
} from "./components/special-inputs";
export {
  ATTENDANCE_LETTER,
  STATUS_LABEL,
  STATUS_LABEL_UR,
  StatusBadge,
  type ApprovalStatus,
  type AttendanceStatus,
  type FeeStatus,
  type ResultStatus,
  type SignalStatus,
  type SmsStatus,
  type Status,
  type StatusBadgeProps,
} from "./components/status-badge";
export { Card, KeyValue, StatCard, type CardProps, type StatCardProps } from "./components/card";
export { TabPanel, Tabs, type Tab, type TabsProps } from "./components/tabs";
export { DataTable, DateText, Money, Pagination, type Column, type DataTableProps, type PaginationProps, type SortState } from "./components/data-table";
export {
  Avatar,
  Banner,
  EmptyState,
  Kbd,
  PermissionDenied,
  ShortcutHints,
  Skeleton,
  Spinner,
  Stepper,
  Timeline,
  type AvatarProps,
  type BannerProps,
  type EmptyStateProps,
  type PermissionDeniedProps,
  type TimelineItem,
} from "./components/feedback";
export {
  ConfirmDialog,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Modal,
  SidePanel,
  Tooltip,
  TooltipProvider,
  type ConfirmDialogProps,
  type ModalProps,
  type SidePanelProps,
} from "./components/overlays";
export { Toast, ToastProvider, useToast, type ToastOptions } from "./components/toast";
export { ATTENDANCE_CODE_LABEL, AttendanceCalendar, AttendanceLegend, type AttendanceCalendarProps } from "./components/attendance-calendar";
export { Urdu } from "./components/urdu";

export {
  accentAlternatives,
  CONTRAST_MINIMUM,
  CONTRAST_PAIRS,
  resolveColor,
  tokens,
  type AccentId,
  type ColorToken,
  type ContrastPair,
  type ThemeId,
} from "./tokens/index";

// Charts and motion — MTB additions (see styles/charts.css and styles/motion.css).
export { AnimatedNumber, type AnimatedNumberProps } from "./charts/animated-number";
export { AreaChart, type AreaChartProps } from "./charts/area-chart";
export { DeviationChart, type DeviationChartProps } from "./charts/deviation-chart";
export { SegmentedBar, type BarSegment, type SegmentedBarProps } from "./charts/segmented-bar";
export { Sparkline, type SparklineProps } from "./charts/sparkline";
export { useCountUp, useElementWidth, useReducedMotion } from "./charts/hooks";
export { linearScale, monotonePath, niceStep, niceTicks } from "./charts/scale";
export { Panel, type PanelProps } from "./components/panel";
export { ColumnChart, type ColumnChartProps } from "./components/column-chart";
export { BottomSheet, type BottomSheetProps } from "./components/bottom-sheet";
