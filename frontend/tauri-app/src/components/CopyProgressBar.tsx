import React from 'react';
import { CopyProgress } from '../services/CopyPoolManager';
import './CopyProgressBar.css';

interface CopyProgressBarProps {
    progress: CopyProgress;
    visible: boolean;
    title?: string;
}

export const CopyProgressBar: React.FC<CopyProgressBarProps> = ({ 
    progress, 
    visible, 
    title = "Setting up workspace..." 
}) => {
    if (!visible) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-[1000]">
            <div className="bg-[var(--base-100)] border border-[var(--base-400)] rounded-lg p-6 min-w-[400px] max-w-[600px] shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
                <h3 className="m-0 mb-4 text-[var(--blackest)] text-lg font-medium">{title}</h3>
                
                <div className="flex justify-between mb-3">
                    <div className="flex gap-4 items-center">
                        <span className="text-2xl font-semibold text-[var(--acc-500)]">{progress.percentage.toFixed(1)}%</span>
                        <span className="text-sm text-[var(--base-700)]">{progress.speed}</span>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                        <span className="text-xs text-[var(--base-700)]">
                            {formatBytes(progress.copied)} / {formatBytes(progress.total)}
                        </span>
                        <span className="text-xs text-[var(--base-700)]">
                            {progress.estimatedTimeRemaining && `ETA: ${progress.estimatedTimeRemaining}`}
                        </span>
                    </div>
                </div>

                <div className="w-full h-2 bg-[var(--base-200)] rounded overflow-hidden mb-4">
                    <div 
                        className="h-full copy-progress-bar-fill rounded"
                        style={{ width: `${Math.min(progress.percentage, 100)}%` }}
                    />
                </div>

                {progress.currentFile && (
                    <div className="flex gap-2 items-center text-xs text-[var(--base-700)] mt-2">
                        <span className="font-medium shrink-0">Current file:</span>
                        <span className="font-mono overflow-hidden text-ellipsis whitespace-nowrap" title={progress.currentFile}>
                            {truncateFilePath(progress.currentFile)}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function truncateFilePath(path: string, maxLength: number = 50): string {
    if (path.length <= maxLength) return path;
    
    const parts = path.split('/');
    if (parts.length <= 2) return path;
    
    // Keep the first and last part, truncate the middle
    const first = parts[0];
    const last = parts[parts.length - 1];
    const middle = '...';
    
    let result = `${first}/${middle}/${last}`;
    
    // If still too long, truncate the last part
    if (result.length > maxLength) {
        const maxLastLength = maxLength - first.length - middle.length - 2;
        const truncatedLast = last.length > maxLastLength 
            ? last.substring(0, maxLastLength - 3) + '...'
            : last;
        result = `${first}/${middle}/${truncatedLast}`;
    }
    
    return result;
}

