import React, { useEffect, useState } from 'react';
import { ExternalLink, Medal, Frown, Share2, BarChart3, X } from 'lucide-react';
import confetti from 'canvas-confetti';
import type { KijijiItem } from '../types';
import type { UserStats } from '../hooks/useFirebaseStats';

interface GameOverProps {
  items: KijijiItem[];
  score: number;
  guesses: (boolean | null)[];
  userSwipes: boolean[]; // Array representing whether the user guessed Free (true) or Paid (false) for each item
  stats: UserStats | null;
  statsLoading: boolean;
  globalScoreDistribution: { [key: number]: number } | null;
  onRestart: () => void;
  onResetStats?: () => void;
}

const GOD_MESSAGES = [
  "Ladies and gentlemen, behold your new god.",
  "Nobody's perfect... except for you!",
  "Put your thumb on ice, it's on fire!",
  "You win some, you don't lose some!",
  "Siiiiiick",
  "Swish!",
  "Have some internet bragging rights on the house."
];

const EXPERT_MESSAGES = [
  "Nobody's perfect, but you got pretty close.",
  "Did your thumb slip or something?",
  "Hold your head high, but not that high",
  "You're smarter than you look!",
  "Better a diamond with a flaw than a pebble without."
];

const REGULAR_MESSAGES = [
  "You win some, you lose some.",
  "Nobody's perfect, and you just proved it.",
  "Remember: swipe right if it's free, left if it's not free",
  "You're not as bad as you smell.",
  "You made some interesting choices there."
];

const RUBE_MESSAGES = [
  "A fool and his money are soon parted.",
  "Nobody's perfect, especially you.",
  "Were you playing with your eyes closed?",
  "At least you have your looks.",
  "Better luck next time... much better.",
  "They say you learn more from failure. You learned a lot.",
  "You missed 100% of the shots you did take.",
  "Imperfection is beauty... and you are so, so beautiful",
  "You're so brave.",
  "That was tough to watch.",
  "Oof. Did you think today was opposite day?",
  "Let's keep this between ourselves.",
  "Ignorance is bliss.",
  "Don't let this define you.",
  "Why do you make everything so complicated?"
];

export const GameOver: React.FC<GameOverProps> = ({
  items,
  score,
  guesses,
  userSwipes,
  stats,
  statsLoading,
  globalScoreDistribution,
  onResetStats,
}) => {
  const totalItems = items.length;
  const [copied, setCopied] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);

  useEffect(() => {
    // Only fire confetti on a perfect score
    if (score === totalItems) {
      const duration = 2.5 * 1000;
      const end = Date.now() + duration;

      const frame = () => {
        confetti({
          particleCount: 4,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ['#89cff0', '#4169e1', '#ffffff'],
        });
        confetti({
          particleCount: 4,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ['#89cff0', '#4169e1', '#ffffff'],
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      };

      frame();
    }
  }, [score, totalItems]);

  const percentage = (score / totalItems) * 100;

  const shareScore = () => {
    let performanceText = '';
    if (score === totalItems) {
      performanceText = "I'm Freejiji Elite! 🥇";
    } else if (percentage >= 75) {
      performanceText = "I Freejiji'd good. 🥈";
    } else if (percentage >= 50) {
      performanceText = "Ok Freejiji today 🥉";
    } else {
      performanceText = "I participated in today's Freejiji 😞";
    }

    const emojiSequence = guesses
      .map((guess) => (guess === true ? '✅' : '❌'))
      .join(' ');

    let streakText = '';
    if (stats && stats.currentStreak > 0) {
      streakText = `\nStreak: 🔥 ${stats.currentStreak} Days (Max: ⚡️ ${stats.maxStreak})`;
    }

    const shareMessage = `${performanceText}\nScore: ${score}/${totalItems}${streakText}\n${emojiSequence}\n\nPlay here: ${window.location.href}`;

    navigator.clipboard.writeText(shareMessage).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  };

  // Determine feedback message, rank, rank color, and icon
  let rank = '';
  let rankColor = '';
  let displayIcon = null;
  let messagePool: string[] = [];

  if (score === totalItems) {
    rank = 'Freejiji God';
    rankColor = 'text-gold';
    displayIcon = <Medal className="w-9 h-9 text-gold" style={{ filter: 'drop-shadow(0 0 8px rgba(251, 191, 36, 0.4))' }} />;
    messagePool = GOD_MESSAGES;
  } else if (percentage >= 75) {
    rank = 'Thrift Store Expert';
    rankColor = 'text-silver';
    displayIcon = <Medal className="w-9 h-9 text-silver" style={{ filter: 'drop-shadow(0 0 6px rgba(203, 213, 225, 0.3))' }} />;
    messagePool = EXPERT_MESSAGES;
  } else if (percentage >= 50) {
    rank = 'Garage Sale Regular';
    rankColor = 'text-bronze';
    displayIcon = <Medal className="w-9 h-9 text-bronze" style={{ filter: 'drop-shadow(0 0 6px rgba(205, 127, 50, 0.3))' }} />;
    messagePool = REGULAR_MESSAGES;
  } else {
    rank = 'Rummage Sale Rube';
    rankColor = 'text-disappointed';
    displayIcon = <Frown className="w-9 h-9 text-disappointed" style={{ filter: 'drop-shadow(0 0 6px rgba(244, 63, 94, 0.3))' }} />;
    messagePool = RUBE_MESSAGES;
  }

  const [message] = useState(() => {
    return messagePool[Math.floor(Math.random() * messagePool.length)];
  });

  // Calculate statistics for score distribution modal
  const gamesPlayed = stats?.gamesPlayed || 0;
  const currentStreak = stats?.currentStreak || 0;
  const maxStreak = stats?.maxStreak || 0;
  
  const distribution = stats?.scoreDistribution || {
    0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0
  };

  const avgScore = stats && stats.gamesPlayed > 0 ? (stats.allTimeScore / stats.gamesPlayed).toFixed(1) : '0';

  const totalGamesInDist = Object.values(distribution).reduce((a, b) => a + b, 0);
  const divisor = totalGamesInDist > 0 ? totalGamesInDist : 1;

  const scores = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  const dailyDistribution = globalScoreDistribution || {
    0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0
  };
  const dailyMaxCount = Math.max(...Object.values(dailyDistribution), 1);

  const distributionRows = scores.map(s => {
    const count = distribution[s] || 0;
    const pct = (count / divisor) * 100;
    const isCurrent = s === score;
    return {
      scoreLabel: s,
      count,
      pct,
      isCurrent,
    };
  });

  return (
    <div className="flex-1 flex flex-col w-full h-full select-none glass-card p-4 overflow-hidden border-white/10 bg-black/30 backdrop-blur-2xl">
      {/* Header Summary */}
      <div className="flex flex-col items-center text-center gap-1.5 pt-1">
        <div className="relative flex items-center justify-center w-12 h-12 rounded-xl bg-white/5 border border-white/10 shadow-inner mb-1">
          {displayIcon}
        </div>

        <h2 className={`text-xl font-extrabold uppercase tracking-wider ${rankColor}`}>
          {rank}
        </h2>

        {/* Giant Score Circle (Shrunk for better mobile layouts) */}
        <div className="relative my-2 flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-tr from-[#0b090f] to-white/5 border border-white/15 shadow-xl">
          <span className="text-2xl font-black text-white">
            {score}
            <span className="text-sm text-white/40 font-bold">/{totalItems}</span>
          </span>
        </div>

        <p className="text-[11px] text-white/60 px-4 max-w-sm">
          {message}
        </p>
      </div>

      {/* Recap List */}
      <div className="flex-1 min-h-0 flex flex-col gap-2 my-2 overflow-hidden">
        <div className="flex justify-between items-center px-1">
          <h4 className="text-[10px] font-bold uppercase tracking-[2.5px] text-white/30">
            Today's Items Recap
          </h4>
          <span className="text-[10px] font-bold uppercase tracking-[2.5px] text-white/30">
            Global Score
          </span>
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scroll pr-1 flex flex-col gap-2">
          {items.map((item, index) => {
            const hasHistoryData = guesses && guesses.length > 0;
            const isCorrect = hasHistoryData ? guesses[index] === true : false;
            const guessedFree = hasHistoryData ? userSwipes[index] : null;
            
            const totalCount = item.totalCount || 0;
            const correctCount = item.correctCount || 0;
            const globalPercent = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : (hasHistoryData && isCorrect ? 100 : 0);

            return (
              <div
                key={item.id}
                className={`flex items-center justify-between gap-3 p-2.5 rounded-2xl bg-white/5 border border-white/5 hover:border-white/10 transition-all duration-200 ${
                  hasHistoryData
                    ? (isCorrect ? 'border-[#00ff87]/20 bg-[#00ff87]/5' : 'border-[#ff007f]/20 bg-[#ff007f]/5')
                    : ''
                }`}
              >
                {/* Thumbnail */}
                <img
                  src={item.image}
                  alt={item.title}
                  className="w-10 h-10 rounded-xl object-cover border border-white/10 flex-shrink-0"
                />

                {/* Info */}
                <div className={`flex-1 min-w-0 ${
                  hasHistoryData
                    ? (isCorrect ? 'text-correct' : 'text-incorrect')
                    : 'text-white/70'
                }`}>
                  <h5 className="text-xs font-bold truncate leading-tight">
                    {item.title}
                  </h5>
                  <div className="flex items-center gap-1.5 mt-1 text-[10px]">
                    <span className={`font-bold px-1.5 py-0.5 rounded-md ${
                      item.isFree ? 'bg-[#00ff87]/20 text-[#00ff87]' : 'bg-white/10 text-white/70'
                    }`}>
                      Actual: {item.isFree ? 'FREE' : `$${item.actualPrice.toFixed(0)}`}
                    </span>
                    {hasHistoryData && (
                      <>
                        <span className="font-semibold">
                          Guess: {guessedFree ? 'Free' : 'Paid'}
                        </span>
                        <span className="text-white/30">•</span>
                      </>
                    )}
                    <span className="opacity-80">
                      {item.location}
                    </span>
                  </div>
                </div>

                {/* Score Status (Global correctness badge) & External Link */}
                <div className="flex items-center gap-2">
                  <div className={`text-[11px] font-black px-2 py-0.5 rounded-lg border ${
                    hasHistoryData
                      ? (isCorrect ? 'badge-correct' : 'badge-incorrect')
                      : 'bg-white/5 border-white/10 text-white/70'
                  }`}>
                    {globalPercent}%
                  </div>
                  
                  <a
                    href={item.listingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View ${item.title} original listing`}
                    className="p-1.5 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-all duration-200"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily Score Distribution Chart */}
      <div className="score-distribution-box">
        <div className="score-distribution-title">
          <h4 className="text-[10px] font-bold uppercase tracking-[2.5px] text-white/30">
            Today's Score Distribution
          </h4>
        </div>
        
        {/* Bars Container */}
        <div className="score-chart-bars">
          {scores.map((s) => {
            const count = dailyDistribution[s] || 0;
            const heightPct = dailyMaxCount > 0 ? (count / dailyMaxCount) * 100 : 0;
            const isCurrent = s === score;
            return (
              <div key={s} className="score-chart-col">
                <div
                  className={`score-chart-bar ${count > 0 ? 'has-score' : ''} ${isCurrent ? 'is-current' : ''}`}
                  style={{
                    height: count > 0 ? `${Math.max(heightPct, 6)}%` : '3px',
                  }}
                  title={`${count} games with score ${s}`}
                />
              </div>
            );
          })}
        </div>

        {/* Baseline and Labels Row */}
        <div className="score-chart-baseline" />
        <div className="score-chart-labels">
          {scores.map((s) => {
            const isCurrent = s === score;
            return (
              <span
                key={s}
                className={`score-chart-label ${isCurrent ? 'is-current' : ''}`}
              >
                {s}
              </span>
            );
          })}
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex gap-2 w-full mt-2 flex-shrink-0">
        <button
          onClick={shareScore}
          className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl bg-[#00ff87] text-black font-extrabold text-xs tracking-wider uppercase transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,255,135,0.6)] active:scale-[0.98] cursor-pointer"
        >
          <Share2 className="w-4 h-4" />
          {copied ? 'Copied!' : 'Share Score'}
        </button>

        <button
          onClick={() => setShowStatsModal(true)}
          className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl bg-gradient-to-r from-[#00ff87] via-[#00d2ff] to-[#8e2de2] text-white font-extrabold text-xs tracking-wider uppercase transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,255,135,0.4)] active:scale-[0.98] cursor-pointer"
        >
          <BarChart3 className="w-4 h-4" />
          {statsLoading ? 'Loading Stats...' : 'View Stats'}
        </button>
      </div>

      {/* Statistics and Score Distribution Modal Overlay */}
      {showStatsModal && (
        <div 
          className="stats-modal-overlay"
          onClick={() => setShowStatsModal(false)}
        >
          <div 
            className="stats-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={() => setShowStatsModal(false)}
              className="stats-modal-close"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Title */}
            <h3 className="stats-modal-title">STATISTICS</h3>

            {/* Statistics Row */}
            <div className="stats-grid select-none">
              <div className="flex flex-col">
                <span className="stats-number">{gamesPlayed}</span>
                <span className="stats-label">Played</span>
              </div>
              <div className="flex flex-col">
                <span className="stats-number">{avgScore}</span>
                <span className="stats-label">Avg Score</span>
              </div>
              <div className="flex flex-col">
                <span className="stats-number text-[#00ff87]">🔥 {currentStreak}</span>
                <span className="stats-label">Current</span>
              </div>
              <div className="flex flex-col">
                <span className="stats-number text-[#00d2ff]">⚡️ {maxStreak}</span>
                <span className="stats-label">Max</span>
              </div>
            </div>

            {/* Guess Distribution */}
            <h3 className="stats-modal-title">SCORE DISTRIBUTION</h3>

            <div className="dist-container select-none">
              {distributionRows.map(({ scoreLabel, count, pct, isCurrent }) => {
                return (
                  <div key={scoreLabel} className="dist-row">
                    <span className="dist-label">{scoreLabel}</span>
                    <div className="dist-track">
                      <div
                        className={`dist-bar ${isCurrent ? 'active' : 'inactive'}`}
                        style={{ width: `${Math.max(pct, 8)}%` }}
                      >
                        {count}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Reset Stats Button */}
            {onResetStats && (
              <div className="mt-5 pt-3 border-t border-white/5 flex justify-center">
                <button
                  onClick={() => {
                    if (window.confirm("Are you sure you want to completely reset your stats and replay today's game?")) {
                      onResetStats();
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-red-950/40 border border-red-500/20 text-red-400 hover:bg-red-950/60 font-bold text-[10px] uppercase tracking-wider transition-all duration-200 cursor-pointer"
                >
                  Reset Progress
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
