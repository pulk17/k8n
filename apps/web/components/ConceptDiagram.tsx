"use client";

/**
 * Small animated pictures of what each object actually does.
 *
 * Words explain a Deployment; watching three pods get replaced one at a time
 * while the Service keeps answering explains it faster and it stays explained.
 * These are the six or seven ideas that are genuinely hard to hold in your head
 * from prose — replacement, selection, mounting, persistence, scaling, blocking
 * — and each one is a mechanism, not decoration.
 *
 * Inline SVG on purpose: no images to load, no library, crisp at any size, and
 * it works on a page with no engine behind it. The animations are CSS, so the
 * global prefers-reduced-motion rule already stops them for anyone who asked
 * for that.
 */

const WIDTH = 320;
const HEIGHT = 150;

// The same colours the canvas uses for these kinds, so a diagram and a card
// are obviously about the same thing.
const BLUE = "#3b82f6";
const GREEN = "#10b981";
const PINK = "#ec4899";
const AMBER = "#f59e0b";
const VIOLET = "#a855f7";
const RED = "#ef4444";
const LINE = "#525252";
const TEXT = "#a3a3a3";
const FAINT = "#404040";

/** Which kinds have one. Everything else falls back to words alone. */
const DIAGRAMS: Record<string, () => React.ReactElement> = {
  Deployment: DeploymentDiagram,
  ReplicaSet: DeploymentDiagram,
  StatefulSet: StatefulSetDiagram,
  Service: ServiceDiagram,
  Ingress: IngressDiagram,
  ConfigMap: ConfigMapDiagram,
  Secret: SecretDiagram,
  PersistentVolumeClaim: StorageDiagram,
  PersistentVolume: StorageDiagram,
  HorizontalPodAutoscaler: AutoscalerDiagram,
  NetworkPolicy: NetworkPolicyDiagram,
  CronJob: CronJobDiagram,
  Job: CronJobDiagram,
};

export function hasDiagram(kind: string): boolean {
  return kind in DIAGRAMS;
}

export default function ConceptDiagram({ kind }: { kind: string }) {
  const Diagram = DIAGRAMS[kind];
  if (!Diagram) return null;

  return (
    <figure className="overflow-hidden rounded-md border border-neutral-800 bg-neutral-950">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block w-full"
        role="img"
        aria-label={`How a ${kind} works`}
      >
        <style>{CSS}</style>
        <Diagram />
      </svg>
    </figure>
  );
}

// Animations live here rather than in globals.css: they are only ever used by
// this file, and keeping them beside the shapes is how they stay in step.
const CSS = `
  .kd-label { font: 9px ui-sans-serif, system-ui, sans-serif; fill: ${TEXT}; }
  .kd-title { font: 600 9px ui-sans-serif, system-ui, sans-serif; fill: #e5e5e5; }
  .kd-mono  { font: 8px ui-monospace, SFMono-Regular, monospace; fill: ${TEXT}; }

  /* Traffic moving along a wire. */
  .kd-flow { stroke-dasharray: 4 6; animation: kd-dash 1.4s linear infinite; }
  @keyframes kd-dash { to { stroke-dashoffset: -20; } }

  /* One thing being replaced by another, staggered down a row. */
  .kd-swap  { animation: kd-swap 6s ease-in-out infinite; }
  .kd-swap2 { animation: kd-swap 6s ease-in-out infinite 0.7s; }
  .kd-swap3 { animation: kd-swap 6s ease-in-out infinite 1.4s; }
  @keyframes kd-swap {
    0%, 12% { opacity: 0; transform: translateY(-3px); }
    22%, 88% { opacity: 1; transform: translateY(0); }
    100% { opacity: 1; }
  }
  .kd-out  { animation: kd-out 6s ease-in-out infinite; }
  .kd-out2 { animation: kd-out 6s ease-in-out infinite 0.7s; }
  .kd-out3 { animation: kd-out 6s ease-in-out infinite 1.4s; }
  @keyframes kd-out {
    0%, 10% { opacity: 1; }
    24%, 100% { opacity: 0; }
  }

  /* Something appearing when a threshold is crossed. */
  .kd-grow  { animation: kd-grow 5s ease-in-out infinite; transform-origin: center; }
  .kd-grow2 { animation: kd-grow 5s ease-in-out infinite 0.4s; transform-origin: center; }
  @keyframes kd-grow {
    0%, 25% { opacity: 0; transform: scale(0.6); }
    40%, 92% { opacity: 1; transform: scale(1); }
    100% { opacity: 0; transform: scale(0.6); }
  }

  .kd-load { animation: kd-load 5s ease-in-out infinite; }
  @keyframes kd-load {
    0%, 100% { height: 6px; y: 96px; }
    50%, 85% { height: 34px; y: 68px; }
  }

  .kd-blink { animation: kd-blink 3s ease-in-out infinite; }
  @keyframes kd-blink { 0%, 60%, 100% { opacity: 1; } 75% { opacity: 0.15; } }

  .kd-tick { animation: kd-tick 4s steps(1) infinite; }
  @keyframes kd-tick { 0%, 45% { opacity: 0; } 55%, 100% { opacity: 1; } }
`;

// --- shared shapes -----------------------------------------------------------

function Box({
  x, y, w = 62, h = 30, color = LINE, label, sub, dashed, className,
}: {
  x: number; y: number; w?: number; h?: number; color?: string;
  label: string; sub?: string; dashed?: boolean; className?: string;
}) {
  return (
    <g className={className}>
      <rect
        x={x} y={y} width={w} height={h} rx={4}
        fill={`${color}14`} stroke={color} strokeWidth={1.2}
        strokeDasharray={dashed ? "3 3" : undefined}
      />
      <text x={x + w / 2} y={sub ? y + h / 2 - 1 : y + h / 2 + 3} className="kd-title" textAnchor="middle">
        {label}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 9} className="kd-mono" textAnchor="middle">
          {sub}
        </text>
      )}
    </g>
  );
}

function Arrow({
  x1, y1, x2, y2, color = LINE, flow, dashed, label,
}: {
  x1: number; y1: number; x2: number; y2: number;
  color?: string; flow?: boolean; dashed?: boolean; label?: string;
}) {
  return (
    <g>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color} strokeWidth={1.2}
        strokeDasharray={dashed && !flow ? "3 3" : undefined}
        className={flow ? "kd-flow" : undefined}
        markerEnd={markerFor(color)}
      />
      {label && (
        <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} className="kd-label" textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  );
}

// One marker per colour: an arrowhead in a different colour from its own line
// reads as a mistake, and `context-stroke` is not supported everywhere.
const ARROW_COLORS: Record<string, string> = {
  [LINE]: "line", [GREEN]: "green", [PINK]: "pink",
  [AMBER]: "amber", [VIOLET]: "violet", [RED]: "red", [BLUE]: "blue",
};

const markerFor = (color: string) => `url(#kd-arrow-${ARROW_COLORS[color] ?? "line"})`;

function Defs() {
  return (
    <defs>
      {Object.entries(ARROW_COLORS).map(([color, name]) => (
        <marker
          key={name} id={`kd-arrow-${name}`} viewBox="0 0 8 8"
          refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 z" fill={color} />
        </marker>
      ))}
    </defs>
  );
}

function Caption({ children }: { children: string }) {
  return (
    <text x={WIDTH / 2} y={HEIGHT - 8} className="kd-label" textAnchor="middle">
      {children}
    </text>
  );
}

// --- the diagrams ------------------------------------------------------------

/** Deployment → ReplicaSet → pods, with one rolling replacement. */
function DeploymentDiagram() {
  const pods = [0, 1, 2];
  return (
    <>
      <Defs />
      <Box x={8} y={20} w={72} h={28} color={BLUE} label="Deployment" sub="replicas: 3" />
      <Arrow x1={80} y1={34} x2={112} y2={34} />
      <Box x={112} y={20} w={66} h={28} color={BLUE} label="ReplicaSet" sub="v2" />

      {/* Rows start below the header line, not centred on it: the first one used
          to sit above the viewBox and got cropped. */}
      {pods.map(i => (
        <g key={i}>
          <Arrow x1={178} y1={34} x2={228} y2={28 + i * 34} />
          {/* the old pod fading out, the new one arriving in its place */}
          <g className={["kd-out", "kd-out2", "kd-out3"][i]}>
            <Box x={230} y={16 + i * 34} w={56} h={24} color={FAINT} label="pod v1" />
          </g>
          <g className={["kd-swap", "kd-swap2", "kd-swap3"][i]}>
            <Box x={230} y={16 + i * 34} w={56} h={24} color={GREEN} label="pod v2" />
          </g>
        </g>
      ))}

      <Caption>You declare the end state; it replaces pods a few at a time.</Caption>
    </>
  );
}

/** A stable address in front of pods that come and go. */
function ServiceDiagram() {
  return (
    <>
      <Defs />
      <text x={12} y={22} className="kd-label">traffic</text>
      <Arrow x1={12} y1={34} x2={58} y2={34} color={GREEN} flow />
      <Box x={58} y={18} w={76} h={32} color={GREEN} label="Service" sub="app=web" />

      <text x={168} y={16} className="kd-mono">pods labelled app=web</text>
      {[0, 1, 2].map(i => (
        <g key={i}>
          <Arrow x1={134} y1={34} x2={196} y2={30 + i * 30} color={GREEN} flow />
          <Box
            x={198} y={18 + i * 30} w={58} h={22} color={BLUE} label="pod"
            className={i === 2 ? "kd-blink" : undefined}
          />
        </g>
      ))}

      <Caption>Pods come and go. The address in front of them does not.</Caption>
    </>
  );
}

/** One entry point, split by host and path. */
function IngressDiagram() {
  return (
    <>
      <Defs />
      <Box x={6} y={54} w={58} h={28} color={FAINT} label="internet" />
      <Arrow x1={64} y1={68} x2={94} y2={68} color={PINK} flow />
      <Box x={94} y={48} w={74} h={40} color={PINK} label="Ingress" sub="shop.example" />

      <Arrow x1={168} y1={60} x2={214} y2={36} color={PINK} flow label="/" />
      <Arrow x1={168} y1={76} x2={214} y2={104} color={PINK} flow label="/api" />
      <Box x={216} y={22} w={64} h={26} color={GREEN} label="web svc" />
      <Box x={216} y={92} w={64} h={26} color={GREEN} label="api svc" />

      <Caption>A rule, not a server — an ingress controller has to act on it.</Caption>
    </>
  );
}

/** Settings handed to pods, and the restart that picks up a change. */
function ConfigMapDiagram() {
  return (
    <>
      <Defs />
      <Box x={10} y={40} w={76} h={40} color={AMBER} label="ConfigMap" sub="LOG_LEVEL" />
      <Arrow x1={86} y1={52} x2={140} y2={40} color={AMBER} flow label="env" />
      <Arrow x1={86} y1={68} x2={140} y2={98} color={AMBER} flow label="file" />
      <Box x={142} y={26} w={64} h={28} color={BLUE} label="pod" />
      <Box x={142} y={84} w={64} h={28} color={BLUE} label="pod" />

      <g className="kd-tick">
        <Arrow x1={206} y1={40} x2={250} y2={56} color={FAINT} dashed />
        <Box x={250} y={44} w={62} h={26} color={GREEN} label="restart" />
      </g>

      <Caption>Changing it does not reach running pods — they read it once.</Caption>
    </>
  );
}

/** base64 is not a lock, however much it looks like one. */
function SecretDiagram() {
  return (
    <>
      <Defs />
      <Box x={10} y={44} w={82} h={42} color={AMBER} label="Secret" sub="cGFzc3dvcmQ=" />
      <Arrow x1={92} y1={65} x2={140} y2={65} color={AMBER} flow />
      <Box x={142} y={50} w={62} h={30} color={BLUE} label="pod" sub="password" />

      <g className="kd-blink">
        <text x={214} y={58} className="kd-label" fill={RED}>base64 decodes</text>
        <text x={214} y={72} className="kd-label" fill={RED}>in one command</text>
      </g>

      <Caption>Encoding, not encryption. Anyone who can read it, can read it.</Caption>
    </>
  );
}

/** The pod is replaced; the disk is not. */
function StorageDiagram() {
  return (
    <>
      <Defs />
      <g className="kd-out">
        <Box x={28} y={22} w={72} h={28} color={FAINT} label="pod" sub="deleted" />
      </g>
      <g className="kd-swap2">
        <Box x={28} y={22} w={72} h={28} color={BLUE} label="new pod" />
      </g>
      <Arrow x1={64} y1={52} x2={64} y2={78} color={VIOLET} />

      <ellipse cx={64} cy={86} rx={40} ry={8} fill={`${VIOLET}22`} stroke={VIOLET} />
      <rect x={24} y={86} width={80} height={22} fill={`${VIOLET}22`} stroke={VIOLET} strokeWidth={1} />
      <ellipse cx={64} cy={108} rx={40} ry={8} fill={`${VIOLET}22`} stroke={VIOLET} />
      <text x={64} y={102} className="kd-title" textAnchor="middle">PVC</text>

      <text x={128} y={60} className="kd-label">the data outlives</text>
      <text x={128} y={74} className="kd-label">the pod that wrote it</text>

      <Caption>A claim asks for storage; the pod mounts what it is given.</Caption>
    </>
  );
}

/** Load crosses the target, copies appear. */
function AutoscalerDiagram() {
  return (
    <>
      <Defs />
      <text x={14} y={30} className="kd-label">CPU</text>
      <line x1={30} y1={102} x2={96} y2={102} stroke={LINE} />
      <line x1={30} y1={74} x2={96} y2={74} stroke={AMBER} strokeDasharray="3 3" />
      <text x={100} y={77} className="kd-mono" fill={AMBER}>target 70%</text>
      <rect x={44} y={96} width={22} height={6} fill={GREEN} className="kd-load" rx={1} />

      <Arrow x1={96} y1={40} x2={150} y2={40} color={VIOLET} label="scales" />
      <Box x={152} y={22} w={56} h={24} color={BLUE} label="pod" />
      <g className="kd-grow">
        <Box x={152} y={52} w={56} h={24} color={BLUE} label="pod" />
      </g>
      <g className="kd-grow2">
        <Box x={152} y={82} w={56} h={24} color={BLUE} label="pod" />
      </g>

      <Caption>No CPU requests on the pods means nothing to measure against.</Caption>
    </>
  );
}

/** Allowed and refused, side by side. */
function NetworkPolicyDiagram() {
  return (
    <>
      <Defs />
      <Box x={10} y={26} w={64} h={26} color={BLUE} label="web" />
      <Box x={10} y={88} w={64} h={26} color={BLUE} label="stranger" />
      <rect x={122} y={14} width={186} height={112} rx={6} fill={`${RED}08`} stroke={RED} strokeDasharray="4 3" />
      <text x={215} y={28} className="kd-label" textAnchor="middle" fill={RED}>NetworkPolicy: from app=web only</text>

      <Arrow x1={74} y1={39} x2={188} y2={62} color={GREEN} flow />
      <line x1={74} y1={101} x2={140} y2={84} stroke={RED} strokeWidth={1.2} />
      <g stroke={RED} strokeWidth={1.6}>
        <line x1={142} y1={78} x2={154} y2={90} />
        <line x1={154} y1={78} x2={142} y2={90} />
      </g>

      <Box x={190} y={50} w={68} h={30} color={GREEN} label="database" />

      <Caption>Once one policy selects a pod, everything else is refused.</Caption>
    </>
  );
}

/** A schedule that keeps producing runs. */
function CronJobDiagram() {
  return (
    <>
      <Defs />
      <Box x={10} y={54} w={76} h={34} color={GREEN} label="CronJob" sub="*/5 * * * *" />
      <Arrow x1={86} y1={71} x2={128} y2={71} color={GREEN} flow />
      <Box x={130} y={56} w={56} h={30} color={GREEN} label="Job" />

      <Arrow x1={186} y1={71} x2={222} y2={45} color={LINE} />
      <Arrow x1={186} y1={71} x2={222} y2={97} color={LINE} />
      <Box x={224} y={32} w={72} h={26} color={FAINT} label="pod ✓" />
      <g className="kd-grow">
        <Box x={224} y={84} w={72} h={26} color={BLUE} label="pod running" />
      </g>

      <Caption>Each run is a new Job, and finished pods stay until cleaned up.</Caption>
    </>
  );
}

/** Named, ordered pods with storage of their own. */
function StatefulSetDiagram() {
  return (
    <>
      <Defs />
      <Box x={8} y={54} w={74} h={30} color={BLUE} label="StatefulSet" sub="db" />
      {[0, 1, 2].map(i => (
        <g key={i}>
          <Arrow x1={82} y1={69} x2={118} y2={38 + i * 32} />
          <Box x={120} y={26 + i * 32} w={56} h={24} color={BLUE} label={`db-${i}`} />
          <Arrow x1={176} y1={38 + i * 32} x2={206} y2={38 + i * 32} color={VIOLET} />
          <Box x={208} y={26 + i * 32} w={62} h={24} color={VIOLET} label={`disk ${i}`} />
        </g>
      ))}
      <Caption>Stable names, stable disks, started and stopped in order.</Caption>
    </>
  );
}
