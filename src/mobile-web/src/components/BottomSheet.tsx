import React, { useEffect, useRef } from 'react';
import './BottomSheet.scss';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

const BottomSheet: React.FC<BottomSheetProps> = ({ open, onClose, title, children }) => {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="bottom-sheet-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        ref={sheetRef}
        className="bottom-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bottom-sheet__handle" aria-hidden="true" />
        {title && (
          <div className="bottom-sheet__header">
            <span className="bottom-sheet__title">{title}</span>
          </div>
        )}
        <div className="bottom-sheet__body">{children}</div>
      </div>
    </div>
  );
};

export default BottomSheet;
