/** Path classification for quiz notes. */

export function isQuizPath(path: string, reviewDir: string, sessionsSubdir: string): boolean {
    const prefix = reviewDir.endsWith('/') ? reviewDir : `${reviewDir}/`;
    const sessionsPrefix = `${prefix}${sessionsSubdir}/`;
    const base = path.split('/').pop() ?? '';
    return (
        path.startsWith(prefix) &&
        !path.startsWith(sessionsPrefix) &&
        base.endsWith('.md')
    );
}
