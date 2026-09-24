import { useId } from "react";

/**
 * "k8n", with the mark as its 8: the k and n in the text colour, the rings in
 * violet into cyan. Letters and rings share one stroke, a cap height and a
 * baseline, so it reads as one word. The gap around the node is cut out with a
 * mask rather than painted, so it sits on any background. The same drawing as
 * docs/images/wordmark-*.svg.
 */
export default function Wordmark({ className = "h-6" }: { className?: string }) {
  const id = useId();
  const grad = `${id}-g`;
  const mask = `${id}-m`;
  return (
    <svg viewBox="0 0 104 64" className={`${className} w-auto`} role="img" aria-label="k8n">
      <defs>
        <linearGradient id={grad} x1="0" y1="10" x2="0" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#c4b5fd" />
          <stop offset=".5" stopColor="#818cf8" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="104" height="64">
          <rect width="104" height="64" fill="#fff" />
          <circle cx="50" cy="30.6" r="8.2" fill="#000" />
        </mask>
      </defs>
      <g fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 13.5V53M12 41L27 28M18.5 35.5L27.5 53" />
        <path d="M74 53V39A8 8 0 0 1 90 39V53" />
      </g>
      <g mask={`url(#${mask})`} fill="none" stroke={`url(#${grad})`} strokeWidth="6">
        <circle cx="50" cy="22" r="8.5" />
        <circle cx="50" cy="42" r="11" />
      </g>
      <circle cx="50" cy="30.6" r="5.4" fill="currentColor" />
    </svg>
  );
}
