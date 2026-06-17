import React from 'react';

interface ControlsProps {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  disabled: boolean;
}

export const Controls: React.FC<ControlsProps> = ({
  onSwipeLeft,
  onSwipeRight,
  disabled,
}) => {
  return (
    <div className="flex justify-center items-center gap-6 py-4 select-none z-20">
      {/* Paid Button (Swipe Left / 🤑) */}
      <button
        onClick={onSwipeLeft}
        disabled={disabled}
        aria-label="Guess Paid"
        className="group relative flex justify-center items-center w-24 h-24 rounded-full border border-[#ff007f]/30 bg-black/40 backdrop-blur-md transition-all duration-300 hover:bg-[#ff007f]/10 active:scale-95 disabled:opacity-40 disabled:pointer-events-none hover:shadow-[0_0_20px_rgba(255,0,127,0.3)]"
      >
        <span className="text-5xl transition-transform duration-300 group-hover:scale-110 select-none">
          🤑
        </span>
        {/* Glow Ring */}
        <span className="absolute inset-0 rounded-full border border-transparent group-hover:border-[#ff007f]/50 transition-all duration-300" />
      </button>

      {/* Free Button (Swipe Right / 🆓) */}
      <button
        onClick={onSwipeRight}
        disabled={disabled}
        aria-label="Guess Free"
        className="group relative flex justify-center items-center w-24 h-24 rounded-full border border-[#00ff87]/30 bg-black/40 backdrop-blur-md transition-all duration-300 hover:bg-[#00ff87]/10 active:scale-95 disabled:opacity-40 disabled:pointer-events-none hover:shadow-[0_0_20px_rgba(0,255,135,0.3)]"
      >
        <span className="text-5xl transition-transform duration-300 group-hover:scale-110 select-none">
          🆓
        </span>
        {/* Glow Ring */}
        <span className="absolute inset-0 rounded-full border border-transparent group-hover:border-[#00ff87]/50 transition-all duration-300" />
      </button>
    </div>
  );
};
