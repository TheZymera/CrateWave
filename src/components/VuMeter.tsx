interface VuMeterProps {
  level: number;
  isPlaying: boolean;
  label?: string;
  compact?: boolean;
}

export function VuMeter({
  level,
  isPlaying,
  label = "MASTER VU",
  compact = false,
}: VuMeterProps) {
  const safeLevel = Number.isFinite(level) ? level : 0;
  const clamped = Math.max(0, Math.min(1.15, isPlaying ? safeLevel : 0));
  // -48deg (-20 dB) -> +24deg (0 dB junction) -> +48deg (+3 dB)
  const angle = -48 + (clamped / 1.15) * 96;
  const isPeaking = isPlaying && clamped > 0.86;

  return (
    <div
      className={`relative rounded-xl bg-gradient-to-b from-[#343842] via-[#1c1e24] to-[#0f1014] p-2 border border-[#0a0b0e] shadow-[0_12px_24px_rgba(0,0,0,0.88),inset_0_1px_1px_rgba(255,255,255,0.22)] ${
        compact ? "w-44 h-24" : "w-56 h-28"
      }`}
    >
      {/* 4 Machined Bezel Screws */}
      <span className="absolute top-1.5 left-1.5 w-1.5 h-1.5 rounded-full bg-gradient-to-br from-slate-200 to-slate-700 z-20" />
      <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-gradient-to-br from-slate-200 to-slate-700 z-20" />
      <span className="absolute bottom-1.5 left-1.5 w-1.5 h-1.5 rounded-full bg-gradient-to-br from-slate-200 to-slate-700 z-20" />
      <span className="absolute bottom-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-gradient-to-br from-slate-200 to-slate-700 z-20" />

      {/* Deep Recessed Inner Housing Wall */}
      <div className="relative w-full h-full rounded-md p-[3px] bg-[#090a0d] shadow-[inset_0_4px_10px_rgba(0,0,0,0.95)]">
        {/* Warm Tungsten Backlit Dial Card */}
        <div className="relative w-full h-full rounded-[4px] overflow-hidden bg-[radial-gradient(ellipse_at_50%_78%,#ffe6a3_0%,#f0b048_55%,#8f5814_100%)] shadow-[inset_0_6px_12px_rgba(28,14,2,0.65)]">
          <svg viewBox="0 0 200 105" className="w-full h-full">
            {/* Concentric Black Scale Arc (-48deg to +24deg around pivot 100,102, R=76) */}
            <path
              d="M 43.52 51.15 A 76 76 0 0 1 130.91 32.57"
              fill="none"
              stroke="#1f160c"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            {/* Exact Continuation Red Overload Arc (+24deg to +48deg around pivot 100,102, R=76) */}
            <path
              d="M 130.91 32.57 A 76 76 0 0 1 156.48 51.15"
              fill="none"
              stroke="#b91c1c"
              strokeWidth="3.0"
              strokeLinecap="round"
            />

            {/* Concentric dB Scale Numbers (R=86 from 100,102) */}
            <g className="font-mono-tech text-[8.5px] font-bold" fill="#231709" textAnchor="middle">
              <text x="36" y="45">20</text>
              <text x="57" y="28">10</text>
              <text x="79" y="19">7</text>
              <text x="100" y="16">5</text>
              <text x="118" y="18">3</text>
              <text x="135" y="24">0</text>
            </g>
            <g className="font-mono-tech text-[8.5px] font-bold" fill="#b91c1c" textAnchor="middle">
              <text x="151" y="33">+1</text>
              <text x="165" y="46">+3</text>
            </g>

            <text
              x="100"
              y="66"
              textAnchor="middle"
              fill="#3a2510"
              className="font-chassis text-[10px] font-extrabold tracking-[0.2em]"
            >
              {label}
            </text>

            {/* Physical Needle + Cast Paper Drop Shadow (Native SVG Pivot 100,102) */}
            <g transform={`rotate(${angle.toFixed(2)}, 100, 102)`}>
              <line
                x1="103"
                y1="102"
                x2="103"
                y2="23"
                stroke="rgba(35,16,3,0.32)"
                strokeWidth="2.4"
              />
              <line
                x1="100"
                y1="102"
                x2="100"
                y2="21"
                stroke="#19120b"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </g>

            <circle cx="100" cy="98" r="14" fill="#141519" />
          </svg>

          {/* 3D Chrome-Ringed Blinking Red Jewel Lamp */}
          <div className="absolute top-1.5 right-2 p-[2px] rounded-full bg-gradient-to-b from-slate-200 to-slate-700 shadow-md">
            <div
              title={isPeaking ? "PEAK" : "ACTIVE"}
              className={`w-2 h-2 rounded-full ${
                isPeaking
                  ? "bg-[#ff2d20] shadow-[0_0_12px_#ff2d20]"
                  : "bg-[#ef4444] animate-peak-blink"
              }`}
            />
          </div>

          {/* Greasy Curved Glass Dome */}
          <div className="absolute inset-0 greasy-vu-glass pointer-events-none" />
        </div>
      </div>
    </div>
  );
}