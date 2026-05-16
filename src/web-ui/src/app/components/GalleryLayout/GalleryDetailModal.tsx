import React from 'react';
import { Dialog } from '@/design-system';
import './GalleryDetailModal.scss';

interface GalleryDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  icon?: React.ReactNode;
  iconGradient?: string;
  title: string;
  badges?: React.ReactNode;
  description?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

const GalleryDetailModal: React.FC<GalleryDetailModalProps> = ({
  isOpen,
  onClose,
  icon,
  iconGradient,
  title,
  badges,
  description,
  meta,
  actions,
  children,
}) => (
  <Dialog
    open={isOpen}
    onOpenChange={(nextOpen) => {
      if (!nextOpen) {
        onClose();
      }
    }}
    size="medium"
    title={title}
    contentInset
  >
    <div className="gallery-detail-modal">
      <div className="gallery-detail-modal__hero">
        {icon ? (
          <div
            className="gallery-detail-modal__icon"
            style={iconGradient ? ({ '--gallery-detail-gradient': iconGradient } as React.CSSProperties) : undefined}
          >
            {icon}
          </div>
        ) : null}
        <div className="gallery-detail-modal__summary">
          {badges ? <div className="gallery-detail-modal__badges">{badges}</div> : null}
          {description?.trim() ? (
            <p className="gallery-detail-modal__description">{description.trim()}</p>
          ) : null}
          {meta ? <div className="gallery-detail-modal__meta">{meta}</div> : null}
        </div>
      </div>

      {children ? <div className="gallery-detail-modal__content">{children}</div> : null}

      {actions ? <div className="gallery-detail-modal__actions">{actions}</div> : null}
    </div>
  </Dialog>
);

export default GalleryDetailModal;
export type { GalleryDetailModalProps };
