import type { ElementType, ReactNode } from "react";
import { cx } from "../lib/cx";

/**
 * Urdu text in Noto Nastaliq Urdu, right-to-left and isolated from the English around it.
 * Sizes follow the design system: title 20/44, body 15/34, small 13/30. Never tighten the line height.
 */
export function Urdu({ children, size = "body", as: Tag = "span", className }: { children: ReactNode; size?: "title" | "body" | "small"; as?: ElementType; className?: string }) {
  return (
    <Tag lang="ur" dir="rtl" className={cx(`urdu-${size}`, className)}>
      {children}
    </Tag>
  );
}
