/**
 * Token usage indicator.
 * Shows session token usage as percentage and count.
 */

import React, { useMemo } from 'react';
import './TokenUsageIndicator.scss';

export interface TokenUsageIndicatorProps {
  currentTokens: number;    // Current token usage
  maxTokens: number;        // Max token capacity
  className?: string;
}

export const TokenUsageIndicator: React.FC<TokenUsageIndicatorProps> = ({
  currentTokens,
  maxTokens,
  className = ''
}) => {
  const percentage = useMemo(() => {
    if (!maxTokens || maxTokens <= 0) return 0;
    return Math.min(Math.round((currentTokens / maxTokens) * 100), 100);
  }, [currentTokens, maxTokens]);

  const formatNumber = (num: number): string => {
    return num.toLocaleString('en-US');
  };

  const getStatusClass = (percent: number): string => {
    if (percent >= 90) return 'critical';
    if (percent >= 70) return 'warning';
    return 'normal';
  };

  const statusClass = getStatusClass(percentage);

  return (
    <div 
      className={`sparo-token-usage ${className} sparo-token-usage--${statusClass}`}
      title={`Token usage: ${formatNumber(currentTokens)} / ${formatNumber(maxTokens)}`}
    >
      <div className="sparo-token-usage__progress-track">
        <div 
          className="sparo-token-usage__progress-fill"
          style={{ width: `${percentage}%` }}
        />
      </div>
      
      <div className="sparo-token-usage__hover-content">
        <span className="sparo-token-usage__percentage">{percentage}%</span>
      </div>
    </div>
  );
};

export default TokenUsageIndicator;

