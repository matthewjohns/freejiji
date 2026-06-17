import React from 'react';
import { MapPin } from 'lucide-react';
import type { KijijiItem } from '../types';

interface GameCardProps {
  item: KijijiItem;
  isCurrent: boolean;
}

export const GameCard: React.FC<GameCardProps> = ({ item }) => {
  return (
    <div className="swipe-card">
      {/* Image container */}
      <div className="card-image-container select-none">
        <img
          src={item.image}
          alt={item.title}
          className="card-image"
          draggable={false}
        />
      </div>

      {/* Details container overlay */}
      <div className="card-details select-none">
        <div className="flex flex-col gap-2">
          {/* Location Badge */}
          <div className="flex items-center gap-1 text-xs font-semibold tracking-wider text-white/50">
            <MapPin className="w-3.5 h-3.5 text-[#00d2ff]" />
            <span>{item.location}</span>
          </div>
        </div>
        
        <div className="swipe-hint">
          Paid 👈 Swipe 👉 Free
        </div>
      </div>
    </div>
  );
};
