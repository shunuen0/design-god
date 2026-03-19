export function GodLogo({
  size = 28,
  onClick,
  tabIndex,
  onKeyDown,
  className,
}: {
  size?: number;
  onClick?: () => void;
  tabIndex?: number;
  onKeyDown?: (e: React.KeyboardEvent<SVGSVGElement>) => void;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 700 560"
      width={size}
      height={size * 560 / 700}
      onClick={onClick}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      className={className}
    >
      <rect width="700" height="560" fill="#111" />

      {/* copyright symbol top-left */}
      <text x="58" y="105" fill="white" fontSize="40" fontFamily="serif">©</text>

      {/* === TOP AREA (sparse) === */}
      {/* Row 1: medium-long bar, centered-right */}
      <rect x="355" y="40" width="220" height="28" rx="18" ry="18" fill="white" />

      {/* Row 2: short bar left-of-center + medium bar right-of-center */}
      <rect x="120" y="80" width="100" height="28" rx="18" ry="18" fill="white" />
      <rect x="355" y="80" width="180" height="28" rx="18" ry="18" fill="white" />

      {/* Row 3: longer bar left; medium bar right */}
      <rect x="55" y="120" width="215" height="28" rx="18" ry="18" fill="white" />
      <rect x="355" y="120" width="160" height="28" rx="18" ry="18" fill="white" />

      {/* Row 4: longer bar left only */}
      <rect x="55" y="160" width="215" height="28" rx="18" ry="18" fill="white" />

      {/* === MIDDLE AREA (dense, both columns) === */}
      {/* Row 5 */}
      <rect x="55" y="200" width="215" height="28" rx="18" ry="18" fill="white" />
      <rect x="355" y="200" width="285" height="28" rx="18" ry="18" fill="white" />

      {/* Row 6 */}
      <rect x="55" y="240" width="215" height="28" rx="18" ry="18" fill="white" />
      <rect x="355" y="240" width="285" height="28" rx="18" ry="18" fill="white" />

      {/* Row 7 */}
      <rect x="55" y="280" width="215" height="28" rx="18" ry="18" fill="white" />
      <rect x="355" y="280" width="285" height="28" rx="18" ry="18" fill="white" />

      {/* Row 8 */}
      <rect x="55" y="320" width="215" height="28" rx="18" ry="18" fill="white" />
      <rect x="355" y="320" width="285" height="28" rx="18" ry="18" fill="white" />

      {/* Row 9 */}
      <rect x="55" y="360" width="215" height="28" rx="18" ry="18" fill="white" />
      <rect x="355" y="360" width="285" height="28" rx="18" ry="18" fill="white" />

      {/* Row 10 */}
      <rect x="55" y="400" width="215" height="28" rx="18" ry="18" fill="white" />
      <rect x="355" y="400" width="250" height="28" rx="18" ry="18" fill="white" />

      {/* Row 11 */}
      <rect x="55" y="440" width="180" height="28" rx="18" ry="18" fill="white" />
      <rect x="355" y="440" width="200" height="28" rx="18" ry="18" fill="white" />

      {/* === BOTTOM AREA (tapering) === */}
      {/* Row 12 */}
      <rect x="55" y="480" width="140" height="28" rx="18" ry="18" fill="white" />
      <rect x="355" y="480" width="150" height="28" rx="18" ry="18" fill="white" />

      {/* Row 13: single centered bar */}
      <rect x="250" y="520" width="200" height="28" rx="18" ry="18" fill="white" />
    </svg>
  );
}
