import React from 'react';

interface SingleChoiceListProps<T> {
	items: T[];
	selectedItemId: string | null | undefined;
	onSelectItem?: (id: string | null) => void;
	renderItem: (item: T, isSelected: boolean) => React.ReactNode;
	getItemId: (item: T) => string;
	onContextMenu?: (event: React.MouseEvent, itemId: string) => void;
	className?: string;
    buttonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
}

export function SingleChoiceList<T>({
	items,
	selectedItemId,
	onSelectItem,
	renderItem,
	getItemId,
	onContextMenu,
	className = '',
    buttonProps = {},
}: SingleChoiceListProps<T>) {
	return (
		<div className={`${className} flex flex-col w-fit max-w-full`}>
			{items.map((item, index) => {
				const id = getItemId(item);
				const isSelected = selectedItemId === id;
				return (
					<button
						key={id}
						onClick={() => onSelectItem?.(id)}
						onContextMenu={(e) => onContextMenu?.(e, id)}
						className={`${buttonProps.className} group relative w-fit flex flex-col text-left px-4 py-3 text-sm first:rounded-t-xl last:rounded-b-xl transition-colors border-[var(--base-300)] border-(length:--border) not-last:border-b-transparent not-first:border-t-transparent ${
							isSelected
								? "bg-[var(--acc-200-30)] opacity-100"
								: "even:bg-[var(--base-100-40)] odd:bg-[var(--base-100-80)] cursor-pointer hover:border-solid border-dashed opacity-50 hover:opacity-100 hover:not-last:border-b-[var(--base-300)] hover:not-first:border-t-[var(--base-300)] hover:bg-[var(--acc-200-40)]"
						}`}
                        {...Object.fromEntries(Object.entries(buttonProps).filter(([key]) => key !== 'className'))}
					>
						{renderItem(item, isSelected)}
					</button>
				);
			})}
		</div>
	);
}
