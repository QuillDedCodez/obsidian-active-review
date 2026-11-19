/** Wrapping chip list with an optional Show all / Show few toggle.
 *  Used by the Start screen preset rows and the Manage Questions preset bar. */

export interface ChipItem {
    label: string;
    active?: boolean;
    disabled?: boolean;
    title?: string;
    class?: string;
    onClick: () => void;
}

export interface ChipListOptions {
    parent: HTMLElement;
    items: ChipItem[];
    rowClass?: string;
    itemClass?: string;
    limit?: number;
    expanded: boolean;
    onExpandedChange: (expanded: boolean) => void;
}

export interface ChipListHandle {
    row: HTMLElement;
    buttons: HTMLButtonElement[];
    findLabel: (label: string) => HTMLButtonElement | undefined;
}

export function renderChipList(options: ChipListOptions): ChipListHandle {
    const {
        parent,
        items,
        rowClass = 'rv-chip-row',
        itemClass = 'rv-mode',
        limit = 5,
        expanded,
        onExpandedChange,
    } = options;

    const row = parent.createDiv({ cls: rowClass });
    const buttons: HTMLButtonElement[] = [];
    const visible = expanded ? items : items.slice(0, limit);

    for (const item of visible) {
        const btn = row.createEl('button', {
            text: item.label,
            cls: item.class ?? itemClass,
            attr: item.title ? { title: item.title } : {},
        });
        if (item.active) btn.addClass('is-active');
        if (item.disabled) btn.disabled = true;
        btn.addEventListener('click', item.onClick);
        buttons.push(btn);
    }

    if (items.length > limit) {
        const more = row.createEl('button', {
            cls: 'rv-chip-row-toggle',
            text: expanded ? 'Show few' : `Show all (${items.length})`,
        });
        more.addEventListener('click', () => onExpandedChange(!expanded));
        buttons.push(more);
    }

    return {
        row,
        buttons,
        findLabel: (label) => buttons.find((btn) => btn.textContent === label),
    };
}