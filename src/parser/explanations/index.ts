/** Parse the `## EXPLANATIONS` section. Rendering stays in `ui/`. */
export function parseExplanationSection(section: string): string | undefined {
    const text = section.trim();
    return text !== '' ? text : undefined;
}
