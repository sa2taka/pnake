/**
 * Pull-style token stream with lookahead.
 *
 * Built on top of Lexer. Peek(n) reads n+1 tokens ahead — needed for
 * recognizing "N G R" indirect references (3 tokens of lookahead).
 */

import type { Token } from "./tokens";
import type { Lexer } from "./lexer";

export class TokenStream {
  private buffer: Token[] = [];

  constructor(readonly lexer: Lexer) {}

  peek(offset = 0): Token {
    while (this.buffer.length <= offset) {
      this.buffer.push(this.lexer.next());
    }
    return this.buffer[offset]!;
  }

  consume(): Token {
    if (this.buffer.length > 0) return this.buffer.shift()!;
    return this.lexer.next();
  }

  /** Drop buffered tokens — used after a manual reader.seek() invalidates lookahead. */
  reset(): void {
    this.buffer.length = 0;
  }
}
