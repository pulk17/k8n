import { useId } from "react";

/**
 * The k8n mark: three cards wired together on the canvas blue — the app in
 * miniature, with the sockets in the real connection colours. The same drawing
 * as app/icon.svg; the gradient id is per instance so two marks on one page do
 * not share one.
 */
export default function Logo({ className = "h-7 w-7" }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="k8n">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${id})`} />
      <path
        d="M26 32C34 32 31 19.5 38 19.5M26 32C34 32 31 44.5 38 44.5"
        fill="none"
        stroke="#fff"
        strokeOpacity=".85"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <rect x="7" y="24" width="20" height="16" rx="4.5" fill="#fff" />
      <rect x="37" y="11.5" width="20" height="16" rx="4.5" fill="#fff" />
      <rect x="37" y="36.5" width="20" height="16" rx="4.5" fill="#fff" />
      <circle cx="13" cy="32" r="2.6" fill="#22c55e" />
      <circle cx="43" cy="19.5" r="2.6" fill="#f59e0b" />
      <circle cx="43" cy="44.5" r="2.6" fill="#a855f7" />
    </svg>
  );
}
