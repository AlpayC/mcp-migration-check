const NOTES: Record<string, string[]> = {
  "/notes/work": ["standup.md", "adr-014.md"],
  "/notes/personal": ["reading-list.md"],
};

/** List note titles under a folder the caller named explicitly. */
export async function listNotes(folder: string, limit: number): Promise<string[]> {
  return (NOTES[folder] ?? []).slice(0, limit);
}

/** Read one note by its absolute path. */
export async function readNote(notePath: string): Promise<string> {
  return `# ${notePath}\n\nPlaceholder note body.\n`;
}
