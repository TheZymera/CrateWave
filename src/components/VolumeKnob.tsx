import { useEffect, useRef, useState } from "react";

interface VolumeKnobProps {
  value: number; // 0.0 .. 1.0
  onChange: (val: number) => void;
}

export function VolumeKnob({ value, onChange }: VolumeKnobProps) {
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);
  const startValRef = useRef(value);

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      const deltaY = startYRef.current - e.clientY;
      const next = Math.max(0, Math.min(1, startValRef.current + deltaY / 130));
      onChange(next);
    };

    const handleUp = () => setDragging(false);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, onChange]);

  // -135deg (0%) to +135deg (100%)
  const deg = -135 + value * 270;

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          setDragging(true);
          startYRef.current = e.clientY;
          startValRef.current = value;
        }}
        onWheel={(e) => {
          const step = e.deltaY < 0 ? 0.05 : -0.05;
          onChange(Math.max(0, Math.min(1, value + step)));
        }}
        title={`Master Volume: ${Math.round(value * 100)}% (Drag up/down or scroll)`}
        className="relative w-20 h-20 flex items-center justify-center cursor-ns-resize"
      >
        {/* Outer Engraved Dial Ring & Ticks */}
        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full pointer-events-none">
          {Array.from({ length: 11 }).map((_, idx) => {
            const tickAngle = -135 + idx * 27;
            const active = idx / 10 <= value + 0.01;
            return (
              <line
                key={idx}
                x1="50"
                y1="5"
                x2="50"
                y2={idx % 5 === 0 ? "11" : "9"}
                stroke={active ? "#ffb347" : "#646873"}
                strokeWidth={idx % 5 === 0 ? "2" : "1.3"}
                strokeLinecap="round"
                transform={`rotate(${tickAngle} 50 50)`}
              />
            );
          })}
        </svg>

        {/* Cast Drop Shadow */}
        <div className="w-14 h-14 rounded-full bg-black/75 blur-[3px] translate-y-1.5" />

        {/* Machined Brushed Aluminum Rotary Cap */}
        <div
          style={{ transform: `rotate(${deg}deg)` }}
          className="absolute w-14 h-14 rounded-full border border-[#14161a] shadow-[inset_0_2px_3px_rgba(255,255,255,0.65),inset_0_-3px_6px_rgba(0,0,0,0.85),0_4px_10px_rgba(0,0,0,0.8)] bg-[conic-gradient(from_35deg,#8d929c_0deg,#e4e7ec_48deg,#5a5e66_115deg,#cfd4dc_185deg,#484b52_265deg,#8d929c_360deg)] flex items-start justify-center pt-1.5"
        >
          {/* Inner Knurled Top Bevel */}
          <div className="w-10 h-10 rounded-full border border-black/40 bg-[radial-gradient(circle_at_35%_30%,#d6dae2_0%,#7b808a_60%,#43474f_100%)] shadow-inner flex items-start justify-center pt-1">
            {/* White/Amber Indicator Notch */}
            <span className="w-1 h-3 rounded-full bg-[#fff3d6] shadow-[0_0_6px_#ffb347]" />
          </div>
        </div>
      </div>

      <span className="font-chassis text-[10px] font-bold uppercase engraved-text">
        MASTER VOL
      </span>
    </div>
  );
}