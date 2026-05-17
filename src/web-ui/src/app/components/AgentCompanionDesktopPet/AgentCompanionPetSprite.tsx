import React, { useEffect, useState } from 'react';
import type { AgentCompanionPetSelection } from '@/infrastructure/config/services/AIExperienceConfigService';
import { resolveAgentCompanionPetSrc } from '@/infrastructure/config/services/AgentCompanionPetService';
import { PETDEX_COLUMNS, PETDEX_ROWS, resolvePetRenderAction } from './runtime/petActionMapper';
import type { PetSpriteAction } from './runtime/petTypes';
import './AgentCompanionPetSprite.scss';

export interface AgentCompanionPetSpriteProps {
  action: PetSpriteAction;
  motionSpeed?: number;
  className?: string;
  pet?: AgentCompanionPetSelection | null;
  nativePetdexSize?: boolean;
  petdexScale?: number;
  onPetFrameSizeChange?: (size: { width: number; height: number } | null) => void;
}

function LoadingPet({ className }: { className: string }) {
  return (
    <div className={`sparo-agent-companion-pet-sprite ${className}`.trim()} aria-hidden>
      <div className="sparo-agent-companion-pet-sprite__loader">
        <span className="sparo-agent-companion-pet-sprite__loader-orbit" />
        <span className="sparo-agent-companion-pet-sprite__loader-face">
          <span className="sparo-agent-companion-pet-sprite__loader-eye sparo-agent-companion-pet-sprite__loader-eye--left" />
          <span className="sparo-agent-companion-pet-sprite__loader-eye sparo-agent-companion-pet-sprite__loader-eye--right" />
        </span>
        <span className="sparo-agent-companion-pet-sprite__loader-spark sparo-agent-companion-pet-sprite__loader-spark--a" />
        <span className="sparo-agent-companion-pet-sprite__loader-spark sparo-agent-companion-pet-sprite__loader-spark--b" />
        <span className="sparo-agent-companion-pet-sprite__loader-spark sparo-agent-companion-pet-sprite__loader-spark--c" />
      </div>
    </div>
  );
}

export const AgentCompanionPetSprite: React.FC<AgentCompanionPetSpriteProps> = ({
  action,
  motionSpeed = 0,
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

  const isPixelPet = pet?.id === 'panda-pix';
  const nativePetdexStyle = nativePetdexSize && petFrameSize
    ? {
      '--sparo-petdex-width': `${petFrameSize.width}px`,
      '--sparo-petdex-height': `${petFrameSize.height}px`,
    }
    : {};
  const petdexAction = resolvePetRenderAction(action, motionSpeed);

  return (
    <div
      className={`sparo-agent-companion-pet-sprite ${className}`.trim()}
      style={nativePetdexStyle as React.CSSProperties}
      aria-hidden
    >
      <div
        className={`sparo-agent-companion-pet-sprite__petdex sparo-agent-companion-pet-sprite__petdex--${petdexAction.secondary}${isPixelPet ? ' sparo-agent-companion-pet-sprite__petdex--pixel' : ''}`}
        style={{
          '--sparo-petdex-src': `url("${petSrc}")`,
          '--sparo-petdex-row': petdexAction.row,
          '--sparo-petdex-frames': petdexAction.frames,
          '--sparo-petdex-frame-end': petdexAction.frameEnd,
          '--sparo-petdex-duration': `${petdexAction.durationMs}ms`,
        } as React.CSSProperties}
      />
    </div>
  );
};
