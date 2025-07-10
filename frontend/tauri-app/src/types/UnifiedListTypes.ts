import { GitProjectCanvas } from './GitProject';
import { BackgroundAgent } from './BackgroundAgent';

export type UnifiedListItemType = 'canvas' | 'background-agent';

export interface UnifiedListItem {
	type: UnifiedListItemType;
	id: string;
	data: GitProjectCanvas | BackgroundAgent;
}

export function createCanvasItem(canvas: GitProjectCanvas): UnifiedListItem {
	return {
		type: 'canvas',
		id: canvas.id,
		data: canvas
	};
}

export function createBackgroundAgentItem(agent: BackgroundAgent): UnifiedListItem {
	return {
		type: 'background-agent',
		id: agent.id,
		data: agent
	};
}

export function isCanvasItem(item: UnifiedListItem): item is UnifiedListItem & { data: GitProjectCanvas } {
	return item.type === 'canvas';
}

export function isBackgroundAgentItem(item: UnifiedListItem): item is UnifiedListItem & { data: BackgroundAgent } {
	return item.type === 'background-agent';
}