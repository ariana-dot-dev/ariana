import { OsSession } from "../bindings/os";
import { CanvasElement, type ElementTargets } from "./types";

export interface CompletedTask {
	prompt: string;
	commitHash: string;
	isReverted: boolean;
	completedAt: number;
}

export class TextArea {
	public id: string;
	public content: string;
	public isLocked: boolean;
	public osSession: OsSession;
	public completedTasks: CompletedTask[];
	public currentPrompt: string;

	constructor(osSession: OsSession | null, content: string = "") {
		this.id = Math.random().toString(36).substring(2, 9);
		this.content = content;
		this.isLocked = false;
		this.osSession = osSession || { Local: "." };
		this.completedTasks = [];
		this.currentPrompt = content;
	}

	public targets(): ElementTargets {
		return {
			size: "medium",
			aspectRatio: 16 / 9,
			area: "center",
		};
	}

	public updateContent(content: string): void {
		if (!this.isLocked) {
			this.content = content;
		}
	}

	public setContentAndTriggerAutoGo(content: string): void {
		if (!this.isLocked) {
			this.content = content;
			this.shouldTriggerAutoGo = true;
		}
	}

	public shouldTriggerAutoGo: boolean = false;

	public lock(): void {
		this.isLocked = true;
	}

	public unlock(): void {
		this.isLocked = false;
	}

	public updateCurrentPrompt(prompt: string): void {
		this.currentPrompt = prompt;
		this.content = prompt;
	}

	public addCompletedTask(prompt: string, commitHash: string): void {
		this.completedTasks.push({
			prompt,
			commitHash,
			isReverted: false,
			completedAt: Date.now()
		});
		this.currentPrompt = "";
		this.content = "";
	}

	public revertTask(taskIndex: number): void {
		if (taskIndex >= 0 && taskIndex < this.completedTasks.length) {
			for (let i = taskIndex; i < this.completedTasks.length; i++) {
				this.completedTasks[i].isReverted = true;
			}
		}
	}

	public restoreTask(taskIndex: number): void {
		if (taskIndex >= 0 && taskIndex < this.completedTasks.length) {
			for (let i = 0; i <= taskIndex; i++) {
				this.completedTasks[i].isReverted = false;
			}
		}
	}

	public getTaskByIndex(index: number): CompletedTask | undefined {
		return this.completedTasks[index];
	}

	public getValidCommitTasks(): CompletedTask[] {
		return this.completedTasks.filter(task => task.commitHash && task.commitHash !== "NO_CHANGES");
	}

	static canvasElement(osSession: OsSession | null, content: string = ""): CanvasElement {
		const textArea = new TextArea(osSession, content);
		return new CanvasElement({ textArea }, 1);
	}
}
