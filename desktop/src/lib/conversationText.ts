// Recognize complete top-level Cursor envelopes, preserving XML and code in prompts.
export function cursorDisplayText(text: string): string {
  const block = /\s*\\?<(timestamp|system\\?_notification|user\\?_query)\\?>([\s\S]*?)\\?<\/\1\\?>\s*/gy;
  const sections: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    block.lastIndex = offset;
    const match = block.exec(text);
    if (!match) return text;
    const name = match[1].replaceAll('\\', '');
    const body = match[2];
    sections.push(name === 'system_notification'
      ? `**System notification**\n\n${body.replace(/\\?<task\\?>([\s\S]*?)\\?<\/task\\?>/g, '\n\n**Task**\n\n$1\n\n')}`
      : body);
    offset = block.lastIndex;
  }
  return sections.join('\n\n').trim();
}
