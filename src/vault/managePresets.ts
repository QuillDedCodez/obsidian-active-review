/** Manage Questions: presets, selection resolution, and category overrides. */
import { TFile, type App } from 'obsidian';
import { extractFolderCategory, type Question } from '../parser';
import { arraysEqualCI } from '../util/text';

export interface ManageQuestionPreset {
    id: string;
    name: string;
    includedPaths: string[];
    /** Whether this preset appears on the start screen. Hidden presets stay saved and remain usable elsewhere. */
    showOnStart: boolean;
}

export interface ManageSelection {
    name: string;
    includedPaths: string[];
    questions: Question[];
}

/** Resolve the selected question set for a manage preset id. */
export function resolveManageSelection(
    questions: Question[],
    managePresetId: string,
    managePresets: ManageQuestionPreset[],
    lastCustomSelection: string[],
): ManageSelection {
    let name: string;
    let included: string[];

    if (managePresetId === 'all') {
        name = 'All questions';
        included = questions.map((q) => q.path);
    } else if (managePresetId === 'last-custom') {
        name = 'Last custom';
        included = lastCustomSelection;
    } else {
        const preset = managePresets.find((p) => p.id === managePresetId);
        name = preset?.name ?? 'All questions';
        included = preset?.includedPaths ?? questions.map((q) => q.path);
    }

    const set = new Set(included);
    const selected = questions.filter((q) => set.has(q.path));
    return {
        name,
        includedPaths: selected.map((q) => q.path),
        questions: selected,
    };
}

/** Write `rv-category` to a note without touching any other frontmatter key. */
export async function writeCategoryFrontMatter(
    app: App,
    path: string,
    category: string[],
): Promise<boolean> {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;
    const value = category.join('/');
    try {
        await app.fileManager.processFrontMatter(file, (fm) => {
            const frontmatter = fm as Record<string, unknown>;
            if (value) frontmatter['rv-category'] = value;
            else delete frontmatter['rv-category'];
        });
        return true;
    } catch {
        return false;
    }
}

/** A question is manageable only when rv-category matches its actual folder (case-insensitive). */
export function isQuestionMatched(q: Question, reviewDir: string): boolean {
    return arraysEqualCI(q.declaredCategory, extractFolderCategory(q.path, reviewDir));
}

export interface FolderTreeNode {
    path: string[];
    label: string;
    children: FolderTreeNode[];
    questions: Question[];
    mismatchCount: number;
}

function sortFolderTree(node: FolderTreeNode): void {
    node.children.sort((a, b) => a.label.localeCompare(b.label));
    node.questions.sort((a, b) => a.path.localeCompare(b.path));
    for (const child of node.children) sortFolderTree(child);
}

/** Build a real-folder tree, including empty folders, for Manage Questions. */
export function buildFolderTree(
    folders: string[],
    questions: Question[],
    reviewDir: string,
): FolderTreeNode {
    const root: FolderTreeNode = {
        path: [],
        label: reviewDir,
        children: [],
        questions: [],
        mismatchCount: 0,
    };

    const ensure = (segments: string[]): FolderTreeNode => {
        let node = root;
        for (let i = 0; i < segments.length; i++) {
            const full = segments.slice(0, i + 1);
            const key = full.join('/');
            let child = node.children.find((c) => c.path.join('/') === key);
            if (!child) {
                child = {
                    path: full,
                    label: segments[i]!,
                    children: [],
                    questions: [],
                    mismatchCount: 0,
                };
                node.children.push(child);
            }
            node = child;
        }
        return node;
    };

    for (const folder of folders) {
        ensure(folder ? folder.split('/') : []);
    }

    for (const q of questions) {
        const folder = extractFolderCategory(q.path, reviewDir);
        const node = ensure(folder);
        if (isQuestionMatched(q, reviewDir)) node.questions.push(q);
        else node.mismatchCount++;
    }

    sortFolderTree(root);
    return root;
}

/** Every matched question path under a folder node, in tree order. */
export function collectFolderQuestionPaths(node: FolderTreeNode): string[] {
    const out = node.questions.map((q) => q.path);
    for (const child of node.children) out.push(...collectFolderQuestionPaths(child));
    return out;
}
