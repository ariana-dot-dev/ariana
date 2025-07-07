import { useState } from "react";
import { OsSessionKind } from "../bindings/os";
import { SingleChoiceList } from './ChoiceList';

interface OsSessionKindSelectorProps {
	onSelect: (kind: OsSessionKind) => void;
	selectedKind?: OsSessionKind;
}

interface OsKindOption {
	id: string;
	kind: OsSessionKind;
	label: string;
	description: string;
}

export function OsSessionKindSelector({ onSelect, selectedKind }: OsSessionKindSelectorProps) {
	// Available OS session kinds (you might want to dynamically detect WSL distributions)
	// Detect the OS using Tauri's API or fallback to navigator if running in web
	const getLocalLabel = () => {
		if (navigator.userAgent.indexOf("Windows") !== -1) {
			return "Local: Windows";
		} else if (navigator.userAgent.indexOf("Mac") !== -1) {
			return "Local: macOS";
		} else if (navigator.userAgent.indexOf("Linux") !== -1) {
			return "Local: Linux";
		}
		return "Local";
	};

	const osKindOptions: OsKindOption[] = [
		{
			id: 'local',
			kind: 'Local',
			label: getLocalLabel(),
			description: 'Use local filesystem'
		},
		{
			id: 'wsl-ubuntu',
			kind: { Wsl: 'Ubuntu' },
			label: 'WSL: Ubuntu',
			description: 'Windows Subsystem for Linux'
		},
	];

	const getSelectedId = (): string | null => {
		if (!selectedKind) return null;
		
		if (selectedKind === 'Local') return 'local';
		if (typeof selectedKind === 'object' && 'Wsl' in selectedKind) {
			return `wsl-${selectedKind.Wsl.toLowerCase()}`;
		}
		return null;
	};

	return (
		<div className="w-fit max-w-full">
			<SingleChoiceList
				items={osKindOptions}
				selectedItemId={getSelectedId()}
				onSelectItem={(id) => {
					if (id) {
						const option = osKindOptions.find(opt => opt.id === id);
						if (option) {
							onSelect(option.kind);
						}
					}
				}}
				getItemId={(option) => option.id}
				renderItem={(option, isSelected) => (
					<>
						<div className="flex w-56 items-center justify-between">
							<div className="flex-1 min-w-0">
								<div className="font-medium text-[var(--base-800)]">
									{option.label}
								</div>
							</div>
						</div>
					</>
				)}
			/>
		</div>
	);
}
