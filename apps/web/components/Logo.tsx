import { useId } from "react";

/**
 * The k8n mark: the 8 of the name, two rings joined at one node — two things
 * connected, which is what the canvas is for. The same drawing as
 * app/icon.svg; gradient ids are per instance so two marks on a page do not
 * share one.
 */
export default function Logo({ className = "h-7 w-7" }: { className?: string }) {
  const id = useId();
  const bg = `${id}-bg`;
  const wire = `${id}-wire`;
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="k8n">
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e2230" />
          <stop offset="1" stopColor="#0a0b0f" />
        </linearGradient>
        <linearGradient id={wire} x1="0" y1="10" x2="0" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#c4b5fd" />
          <stop offset=".5" stopColor="#818cf8" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${bg})`} />
      <rect x=".5" y=".5" width="63" height="63" rx="14.5" fill="none" stroke="#fff" strokeOpacity=".08" />
      <circle cx="32" cy="21.5" r="8" fill="none" stroke={`url(#${wire})`} strokeWidth="5.2" />
      <circle cx="32" cy="41" r="10.5" fill="none" stroke={`url(#${wire})`} strokeWidth="5.2" />
      <circle cx="32" cy="30.6" r="5.6" fill="#fff" stroke="#151822" strokeWidth="2.6" />
    </svg>
  );
}
