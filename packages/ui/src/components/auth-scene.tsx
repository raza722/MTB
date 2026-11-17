import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { Crest } from "./feedback";

export interface AuthSceneHighlight {
  icon: IconName;
  text: ReactNode;
}

export interface AuthSceneProps {
  /** The app's name beside the crest: "MTB", "MTB Teacher". */
  name: ReactNode;
  /** One line under the name. */
  tagline: ReactNode;
  /** What the app is for, shown on wide screens only (three or four short lines). */
  highlights?: readonly AuthSceneHighlight[];
  /** The crest's own wording, at the foot of the brand panel on wide screens. */
  motto?: ReactNode;
  /** Small controls in the top corner (language, light/dark). */
  tools?: ReactNode;
  /** The sign-in card and anything under it. */
  children: ReactNode;
}

const i = (n: number) => ({ "--i": n }) as CSSProperties;

/** Where each sparkle sits in the 600 x 800 sky, its size and when it starts to twinkle. */
const STARS: readonly (readonly [x: number, y: number, scale: number, delay: number])[] = [
  [70, 90, 1, 0],
  [210, 44, 0.6, 1.4],
  [330, 150, 0.8, 2.6],
  [120, 300, 0.55, 0.8],
  [520, 330, 0.9, 1.9],
  [60, 560, 0.7, 3.1],
  [300, 640, 0.5, 0.4],
  [540, 610, 0.75, 2.2],
  [430, 740, 0.6, 1.1],
];

/**
 * MTB addition: the frame around every sign-in screen (staff, teacher, parent portal).
 * A brand panel drawn from the school crest (the torch's light, the crescent and the star) sits above the form on a
 * phone and beside it on a computer. Everything that moves is decoration: it is hidden from screen readers and stops
 * under the reduced-motion setting.
 */
export function AuthScene({ name, tagline, highlights, motto, tools, children }: AuthSceneProps) {
  return (
    <div className="mtb-auth">
      <div className="mtb-auth-brand">
        <svg className="mtb-auth-sky" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
          <defs>
            <pattern id="mtb-auth-tile" width="72" height="72" patternUnits="userSpaceOnUse" fill="none" stroke="#fff" strokeWidth="1.2">
              <rect x="18" y="18" width="36" height="36" />
              <rect x="18" y="18" width="36" height="36" transform="rotate(45 36 36)" />
            </pattern>
            <mask id="mtb-auth-crescent-cut">
              <rect x="-200" y="-200" width="400" height="400" fill="#fff" />
              <circle cx="46" cy="-22" r="128" fill="#000" />
            </mask>
          </defs>
          <g className="mtb-auth-lattice">
            <rect x="-72" y="-72" width="744" height="944" fill="url(#mtb-auth-tile)" />
          </g>
          <g transform="translate(470 170)">
            <g className="mtb-auth-crescent">
              <circle r="150" mask="url(#mtb-auth-crescent-cut)" />
            </g>
            <path className="mtb-auth-star5" d="M0-17 4.9-5.3 17.6-5.3 7.3 2.3 11.2 14.4 0 7 -11.2 14.4 -7.3 2.3 -17.6-5.3 -4.9-5.3Z" transform="translate(52 -34)" />
          </g>
          {STARS.map(([x, y, s, d]) => (
            <g key={`${x}-${y}`} transform={`translate(${x} ${y}) scale(${s})`}>
              <path className="mtb-auth-twinkle" style={{ animationDelay: `${d}s` }} d="M0-11 2.4-2.4 11 0 2.4 2.4 0 11 -2.4 2.4 -11 0 -2.4-2.4Z" />
            </g>
          ))}
        </svg>

        <div className="mtb-auth-brand-inner">
          <div className="mtb-auth-crest" aria-hidden="true">
            <span className="mtb-auth-glow" />
            <span className="mtb-auth-ring" />
            {[0, 1, 2, 3, 4].map((n) => (
              <span key={n} className="mtb-auth-ember" style={i(n)} />
            ))}
            <span className="mtb-auth-plate">
              <Crest size={84} />
            </span>
          </div>
          <div className="mtb-auth-title">
            <p className="mtb-auth-name" style={i(1)}>
              {name}
            </p>
            <p className="mtb-auth-tagline" style={i(2)}>
              {tagline}
            </p>
          </div>
          {highlights && highlights.length > 0 && (
            <ul className="mtb-auth-points">
              {highlights.map((h, n) => (
                <li key={h.icon} style={i(n + 3)}>
                  <span className="mtb-auth-point-icon">
                    <Icon name={h.icon} size={18} />
                  </span>
                  <span>{h.text}</span>
                </li>
              ))}
            </ul>
          )}
          {motto && (
            <p className="mtb-auth-motto" style={i((highlights?.length ?? 0) + 4)}>
              {motto}
            </p>
          )}
        </div>
      </div>

      <div className="mtb-auth-main">
        <div className="mtb-auth-column">{children}</div>
      </div>

      {tools && <div className="mtb-auth-tools">{tools}</div>}
    </div>
  );
}
