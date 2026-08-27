export default function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="16" className="brand-mark-fill" />
      <path
        d="M18 44c1.5-14 10-24 22-26"
        stroke="#E8C47A"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="42" cy="18" r="5" fill="#E8C47A" />
      <path d="M20 46h24" stroke="#E8C47A" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}
