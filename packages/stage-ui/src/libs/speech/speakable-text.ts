/**
 * Removes Markdown markup from one speech segment, so a voice does not read the markup aloud.
 *
 * Chat models often answer in Markdown, and a TTS provider reads `**` as "asterisk asterisk".
 * Only the text for synthesis passes through here. The chat caption keeps the Markdown.
 *
 * @example
 * toSpeakableText('**Done**, see [the docs](https://example.com).')
 * // => 'Done, see the docs.'
 */
export function toSpeakableText(text: string): string {
  return text
    // Images and links keep their visible text.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Code fences and inline code keep the code text.
    .replace(/`{1,3}/g, '')
    // Headings, block quotes and list bullets at a line start.
    .replace(/^[ \t]*(?:#{1,6}|[>*+-])[ \t]+/gm, '')
    // Emphasis with underscores, only around words, so `snake_case` stays.
    .replace(/(^|\W)_+([^_\s](?:[^_]*[^_\s])?)_+(?=\W|$)/g, '$1$2')
    // Every asterisk left is markup: bold, italic, or a narration marker such as `*smiles*`.
    .replace(/\*+/g, '')
}
