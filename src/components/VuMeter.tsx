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
  const clamped = Math.max(0, Math.min(1.15, isPlaying ? level : 0));
  const angle = -44 + clamped * 75;
  const isPeaking = isPlaying && clamped > 0.78;

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
            <path
              d="M 28 72 A 86 86 0 0 1 138 35"
              fill="none"
              stroke="#1f160c"
              strokeWidth="2.2"
            />
            <path
              d="M 138 35 A 86 86 0 0 1 174 52"
              fill="none"
              stroke="#b91c1c"
              strokeWidth="3.2"
            />

            <g className="font-mono-tech text-[9px] font-bold" fill="#231709">
              <text x="23" y="61">20</text>
              <text x="48" y="45">10</text>
              <text x="75" y="34">7</text>
              <text x="98" y="29">5</text>
              <text x="118" y="28">3</text>
              <text x="135" y="29">0</text>
            </g>
            <g className="font-mono-tech text-[9px] font-bold" fill="#b91c1c">
              <text x="152" y="34">+1</text>
              <text x="169" y="44">+3</text>
            </g>

            <text
              x="100"
              y="64"
              textAnchor="middle"
              fill="#3a2510"
              className="font-chassis text-[10px] font-extrabold tracking-[0.2em]"
            >
              {label}
            </text>

            {/* Physical Needle + Cast Paper Drop Shadow */}
            <g
              style={{
                transform: `rotate(${angle}deg)`,
                transformOrigin: "100px 102px",
                transition: isPlaying
                  ? "transform 65ms cubic-bezier(0.22, 1, 0.36, 1)"
                  : "transform 350ms ease-out",
              }}
            >
              <line
                x1="104"
                y1="102"
                x2="104"
                y2="18"
                stroke="rgba(35,16,3,0.34)"
                strokeWidth="2.6"
              />
              <line
                x1="100"
                y1="102"
                x2="100"
                y2="16"
                stroke="#19120b"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </g>

            <circle cx="100" cy="98" r="15" fill="#141519" />
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