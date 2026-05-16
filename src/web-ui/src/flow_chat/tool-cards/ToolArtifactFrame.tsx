import React from 'react';
import { CubeLoading } from '@/design-system';
import { ToolErrorBlock } from './ToolErrorBlock';
import './ToolArtifactFrame.scss';

export interface ToolArtifactFrameProps {
  loading?: boolean;
  error?: React.ReactNode;
  children?: React.ReactNode;
  loadingLabel?: React.ReactNode;
  className?: string;
}

export const ToolArtifactFrame: React.FC<ToolArtifactFrameProps> = ({
  loading,
  error,
  children,
  loadingLabel,
  className = '',
}) => {
  return (
    <div className={['tool-artifact-frame', className].filter(Boolean).join(' ')}>
      {loading && (
        <div className="tool-artifact-frame__loading">
          <CubeLoading size="small" />
          {loadingLabel && <span>{loadingLabel}</span>}
        </div>
      )}
      {error && <ToolErrorBlock message={error} />}
      {!loading && !error && children}
    </div>
  );
};

