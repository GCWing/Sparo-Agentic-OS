import React, { useEffect, useState } from 'react';
import type { ChatInputPetMood } from '@/flow_chat/utils/chatInputPetMood';
import type { AgentCompanionPetSelection } from '@/infrastructure/config/services/AIExperienceConfigService';
import { resolveAgentCompanionPetSrc } from '@/infrastructure/config/services/AgentCompanionPetService';
import './AgentCompanionPetSprite.scss';

export interface AgentCompanionPetSpriteProps {
  mood: AgentCompanionPetSpriteMood;
  className?: string;
  pet?: AgentCompanionPetSelection | null;
  nativePetdexSize?: boolean;
  petdexScale?: number;
  onPetFrameSizeChange?: (size: { width: number; height: number } | null) => void;
}

export type AgentCompanionPetSpriteMood = ChatInputPetMood | 'hover' | 'dragging';

const PETDEX_COLUMNS = 8;
const PETDEX_ROWS = 9;

const ROW_BY_MOOD: Record<AgentCompanionPetSpriteMood, number> = {
  rest: 0,
  hover: 1,
  dragging: 2,
  analyzing: 8,
  waiting: 6,
  working: 7,
};

function LoadingPet({ className }: { className: string }) {
  return (
    <div className={`bitfun-agent-companion-pet-sprite ${className}`.trim()} aria-hidden>
      <div className="bitfun-agent-companion-pet-sprite__loader">
        <span className="bitfun-agent-companion-pet-sprite__loader-orbit" />
        <span className="bitfun-agent-companion-pet-sprite__loader-face">
          <span className="bitfun-agent-companion-pet-sprite__loader-eye bitfun-agent-companion-pet-sprite__loader-eye--left" />
          <span className="bitfun-agent-companion-pet-sprite__loader-eye bitfun-agent-companion-pet-sprite__loader-eye--right" />
        </span>
        <span className="bitfun-agent-companion-pet-sprite__loader-spark bitfun-agent-companion-pet-sprite__loader-spark--a" />
        <span className="bitfun-agent-companion-pet-sprite__loader-spark bitfun-agent-companion-pet-sprite__loader-spark--b" />
        <span className="bitfun-agent-companion-pet-sprite__loader-spark bitfun-agent-companion-pet-sprite__loader-spark--c" />
      </div>
    </div>
  );
}

export const AgentCompanionPetSprite: React.FC<AgentCompanionPetSpriteProps> = ({
  mood,
  className = '',
  pet = null,
  nativePetdexSize = false,
  petdexScale = 1,
  onPetFrameSizeChange,
}) => {
  const [petSrc, setPetSrc] = useState<string | null>(null);
  const [isPetLoading, setIsPetLoading] = useState(() => Boolean(pet));
  const [petFrameSize, setPetFrameSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!pet) {
      setPetSrc(null);
      setIsPetLoading(false);
      setPetFrameSize(null);
      onPetFrameSizeChange?.(null);
      return;
    }

    let cancelled = false;
    setPetSrc(null);
    setIsPetLoading(true);
    if (!nativePetdexSize) {
      setPetFrameSize(null);
      onPetFrameSizeChange?.(null);
    }

    void resolveAgentCompanionPetSrc(pet).then(src => {
      if (cancelled) return;
      if (!src) {
        setPetSrc(null);
        setIsPetLoading(false);
        if (nativePetdexSize) {
          setPetFrameSize(null);
          onPetFrameSizeChange?.(null);
        }
        return;
      }

      const image = new Image();
      image.onload = () => {
        if (cancelled) return;
        if (nativePetdexSize) {
          const width = Math.round(image.naturalWidth / PETDEX_COLUMNS);
          const height = Math.round(image.naturalHeight / PETDEX_ROWS);
          if (width <= 0 || height <= 0) {
            setPetFrameSize(null);
            onPetFrameSizeChange?.(null);
          } else {
            const scale = Number.isFinite(petdexScale) && petdexScale > 0 ? petdexScale : 1;
            const nextSize = {
              width: Math.max(1, Math.round(width * scale)),
              height: Math.max(1, Math.round(height * scale)),
            };
            setPetFrameSize(nextSize);
            onPetFrameSizeChange?.(nextSize);
          }
        }
        setPetSrc(src);
        setIsPetLoading(false);
      };
      image.onerror = () => {
        if (cancelled) return;
        setPetSrc(null);
        setIsPetLoading(false);
        setPetFrameSize(null);
        onPetFrameSizeChange?.(null);
      };
      image.src = src;
    }).catch(() => {
      if (cancelled) return;
      setPetSrc(null);
      setIsPetLoading(false);
      setPetFrameSize(null);
      onPetFrameSizeChange?.(null);
    });

    return () => { cancelled = true; };
  }, [nativePetdexSize, onPetFrameSizeChange, pet, petdexScale]);

  if (isPetLoading || !petSrc) {
    return <LoadingPet className={className} />;
  }

  const nativePetdexStyle = nativePetdexSize && petFrameSize
    ? {
      '--bitfun-petdex-width': `${petFrameSize.width}px`,
      '--bitfun-petdex-height': `${petFrameSize.height}px`,
    }
    : {};

  return (
    <div
      className={`bitfun-agent-companion-pet-sprite ${className}`.trim()}
      style={nativePetdexStyle as React.CSSProperties}
      aria-hidden
    >
      <div
        className={`bitfun-agent-companion-pet-sprite__petdex bitfun-agent-companion-pet-sprite__petdex--${mood}`}
        style={{
          '--bitfun-petdex-src': `url("${petSrc}")`,
          '--bitfun-petdex-row': ROW_BY_MOOD[mood],
        } as React.CSSProperties}
      />
    </div>
  );
};
