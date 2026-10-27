import { Lexer, type MarkedOptions, type Token, type TokensList } from 'marked';

/**
 * marked's block lexer, less the inline lexing no token keeps.
 *
 * marked lexes the blocks first and queues each paragraph's, heading's, and
 * cell's text for an inline lex after. A lazy line inside a quote whose last
 * child is a list or another quote makes marked lex that child again, and the
 * first lexing's text stays queued though no token holds it any more: four
 * quotes deep, a paragraph's marks are lexed four times. Here the queue runs,
 * in marked's order, only for the tokens the tree keeps, so the tokens are
 * the ones marked returns. A marked that keeps no such queue lexes as it
 * always has.
 */
export function lexBlocks(source: string, options: MarkedOptions): TokensList {
  const lexer = new Lexer(options);
  const queue: unknown = Reflect.get(lexer, 'inlineQueue');
  if (!Array.isArray(queue)) return lexer.lex(source);
  const { tokens } = lexer;
  lexer.blockTokens(source.replace(/\r\n|\r/g, '\n'), tokens);
  const kept = reachable(tokens);
  for (const { src, tokens: into } of queue.splice(0) as Array<{ src: string; tokens: Token[] }>) {
    if (kept.has(into)) lexer.inlineTokens(src, into);
  }
  return tokens;
}

/** Every object and array the tokens hold, however deep. */
function reachable(root: object): Set<unknown> {
  const seen = new Set<unknown>([root]);
  const stack: object[] = [root];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    for (const value of Object.values(next)) {
      if (value !== null && typeof value === 'object' && !seen.has(value)) {
        seen.add(value);
        stack.push(value);
      }
    }
  }
  return seen;
}
