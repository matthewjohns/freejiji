import React from 'react';
import { ShoppingBag, Trophy } from 'lucide-react';

interface HeaderProps {
  totalItems: number;
  currentIndex: number;
  guesses: (boolean | null)[];
  score: number;
}

export const Header: React.FC<HeaderProps> = ({
  totalItems,
  currentIndex,
  guesses,
  score,
}) => {
  return (
    <header className="w-full flex flex-col gap-4 select-none">
      <div className="flex items-center justify-between">
        {/* Brand Logo */}
        <div className="flex items-center gap-2">
          <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-tr from-[#00ff87] to-[#8e2de2] shadow-lg shadow-[#00ff87]/20">
            <ShoppingBag className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight brand-gradient">
              Freejiji
            </h1>
            <p className="text-[10px] uppercase tracking-[2px] text-white/40 font-bold -mt-1">
              Daily Challenge
            </p>
          </div>
        </div>

        {/* Live Score */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-md">
          <Trophy className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-white/80">
            Score: <span className="text-white font-bold text-sm">{score}</span>
          </span>
        </div>
      </div>

      {/* Progress Dots */}
      <div className="flex justify-between items-center gap-2.5 px-1">
        {Array.from({ length: totalItems }).map((_, index) => {
          const guess = guesses[index];
          const isCurrent = index === currentIndex;
          const isPassed = index < currentIndex;

          let dotClass = "bg-white/15 border-transparent";
          if (isCurrent) {
            dotClass = "bg-white border-white scale-125 shadow-md shadow-white/30 animate-pulse";
          } else if (isPassed) {
            dotClass = guess === true
              ? "bg-[#00ff87] border-[#00ff87] shadow-lg shadow-[#00ff87]/30"
              : "bg-[#ff007f] border-[#ff007f] shadow-lg shadow-[#ff007f]/30";
          }

          return (
            <div
              key={index}
              className={`h-2.5 flex-1 rounded-full border transition-all duration-300 ${dotClass}`}
            />
          );
        })}
      </div>
    </header>
  );
};
