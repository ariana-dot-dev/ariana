import { useState, useEffect } from "react";
import { invoke } from '@tauri-apps/api/core';
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

	const [availableKinds, setAvailableKinds] = useState<OsSessionKind[]>([]);
	const [loading, setLoading] = useState(true);
	const [osKindOptions, setOsKindOptions] = useState<OsKindOption[]>([]);

	useEffect(() => {
		const loadAvailableKinds = async () => {
			try {
				const kinds = await invoke<OsSessionKind[]>("list_available_os_session_kinds");
				setAvailableKinds(kinds);
				
				// Convert to OsKindOption format
				const options: OsKindOption[] = kinds.map(kind => {
					if (kind === 'Local') {
						// Detect the OS using navigator
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
						return {
							id: 'local',
							kind: 'Local',
							label: getLocalLabel(),
							description: 'Use local filesystem'
						};
					} else if (typeof kind === 'object' && 'Wsl' in kind) {
						return {
							id: `wsl-${kind.Wsl.toLowerCase()}`,
							kind: kind,
							label: `WSL: ${kind.Wsl}`,
							description: 'Windows Subsystem for Linux'
						};
					}
					return null;
				}).filter(Boolean) as OsKindOption[];
				
				setOsKindOptions(options);
				
				// Auto-select the first option if none is selected
				if (!selectedKind && options.length > 0) {
					onSelect(options[0].kind);
				}
			} catch (error) {
				console.error("Failed to load available OS session kinds:", error);
				// Fallback to hardcoded local option
				const fallbackOption = {
					id: 'local',
					kind: 'Local' as OsSessionKind,
					label: 'Local',
					description: 'Use local filesystem'
				};
				setOsKindOptions([fallbackOption]);
				
				// Auto-select the fallback option if none is selected
				if (!selectedKind) {
					onSelect(fallbackOption.kind);
				}
			} finally {
				setLoading(false);
			}
		};

		loadAvailableKinds();
	}, [selectedKind, onSelect]);

	const getSelectedId = (): string | null => {
		if (!selectedKind) return null;
		
		if (selectedKind === 'Local') return 'local';
		if (typeof selectedKind === 'object' && 'Wsl' in selectedKind) {
			return `wsl-${selectedKind.Wsl.toLowerCase()}`;
		}
		return null;
	};

	if (loading) {
		return (
			<div className="w-fit max-w-full">
				<div className="flex justify-center p-4">
					<span className="text-[var(--base-500)]">Loading environments...</span>
				</div>
			</div>
		);
	}

	// If there's only one option, don't show the selector - it's auto-selected
	if (osKindOptions.length <= 1) {
		return null;
	}

	return (
		<div className="w-fit max-w-full">
			<div className="text-xs font-medium text-[var(--base-700)] mb-2">Pick an environment to open/create <br/> projects in ↓</div>
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
