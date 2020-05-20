/**
 * ## Reference
 * TeX source code:
 * {@link  http://tug.org/texlive/devsrc/Build/source/texk/web2c/tex.web | Tex.web}
 *
 * For a list of standard TeX macros, see:
 * {@link ftp://tug.ctan.org/pub/tex-archive/systems/knuth/dist/lib/plain.tex | plain.tex}
 */

import { splitGraphemes } from './grapheme-splitter';

/**
 *
 * A token can be of type:
 *  - `literal`: the value is the character this token represents. This can be
 * a combination of Unicode codepoints, for example for emojis.
 *  - `^` and `_`: superscript and subscript commands.
 *  - `command`: a command such as `\sin` or `\text` or `\alpha`
 *  - `{` and `}`: begin and end group (use for arguments of commands and for grouping)
 *  - `#`: parameter
 *
 *  - `placeholder`: a placeholder value meant to be replaced by some actual value
 *  - `space`: one or more space characters (including tab, etc...)
 *
 *  See: [TeX:289](http://tug.org/texlive/devsrc/Build/source/texk/web2c/tex.web)
 */
export class Token {
    type: string;
    value: string | number;
    constructor(type: string, value: string | number = '') {
        this.type = type;
        this.value = value;
        console.assert(!(type === 'literal' && value === '}'));
    }
}

/**
 * Given a LaTeX expression represented as a character string,
 * the Lexer class will scan and return Tokens for the lexical
 * units in the string.
 *
 * @param s A string of LaTeX
 */
class Lexer {
    s: string | string[];
    pos: number;
    constructor(s: string) {
        this.s = splitGraphemes(s);
        this.pos = 0;
    }
    /**
     * @return True if we reached the end of the stream
     */
    end(): boolean {
        return this.pos >= this.s.length;
    }
    /**
     * Return the next char and advance
     */
    get(): string {
        return this.pos < this.s.length ? this.s[this.pos++] : '';
    }
    /**
     * Return the next char, but do not advance
     */
    peek(): string {
        return this.s[this.pos];
    }
    /**
     * Return the next substring matching regEx and advance.
     */
    scan(regEx: RegExp): string | null {
        // this.s can either be a string, if it's made up only of ASCII chars
        // or an array of graphemes, if it's more complicated.
        let execResult: (string | null)[] | null;
        if (typeof this.s === 'string') {
            execResult = regEx.exec(this.s.slice(this.pos));
        } else {
            execResult = regEx.exec(this.s.slice(this.pos).join(''));
        }
        if (execResult?.[0]) {
            this.pos += execResult[0].length;
            return execResult[0];
        }
        return null;
    }
    /**
     * Return true if next char is white space. Does not advance.
     *
     * See [Stackoverflow](http://stackoverflow.com/questions/6073637/)
     */
    isWhiteSpace(): boolean {
        return /[ \f\n\r\t\v\xA0\u2028\u2029]/.test(this.s[this.pos]);
        /*
    Note that browsers are inconsistent in their definitions of the
    `\s` metacharacter, so we use an explicit pattern instead.

    - IE:          `[ \f\n\r\t\v]`
    - Chrome:      `[ \f\n\r\t\v\u00A0]`
    - Firefox:     `[ \f\n\r\t\v\u00A0\u2028\u2029]`

    - \f \u000C: form feed (FORM FEED)
    - \n \u000A: linefeed (LINE FEED)
    - \r \u000D: carriage return
    - \t \u0009: tab (CHARACTER TABULATION)
    - \v \u000B: vertical tab (LINE TABULATION)
    - \u00A0: NON-BREAKING SPACE
    - \u2028: LINE SEPARATOR
    - \u2029: PARAGRAPH SEPARATOR

    Could be considered:
    - \u2000-\u200a spacing
    - \u202f NARROW NO-BREAK SPACE
    - \u205F MEDIUM MATHEMATICAL SPACE
    - \u3000 IDEOGRAPHIC SPACE
    - \uFEFF ZERO WITH NON-BREAKING SPACE
*/
    }
    /**
     * Return a single token, or null, created from the lexer.
     */
    makeToken(): Token | null {
        // If we've reached the end, exit
        if (this.end()) return null;
        // Handle white space
        // Note that in text mode, spaces are significant and can't be coalesced.
        if (this.isWhiteSpace()) {
            this.get();
            return new Token('space');
        }
        let result: Token | null = null;
        // Is it a command?
        if (this.peek() === '\\') {
            this.get(); // Skip the initial \
            if (!this.end()) {
                // A command is either a string of letters and asterisks...
                let command = this.scan(/^[a-zA-Z*]+/);
                // There are a few special commands that are handled here...
                if (command === 'bgroup') {
                    // Begin group, synonym for opening brace
                    result = new Token('{');
                } else if (command === 'egroup') {
                    // End group, synonym for closing brace
                    result = new Token('}');
                } else {
                    if (!command) {
                        // ... or a single non-letter character
                        command = this.get();
                    }
                    result = new Token('command', command);
                }
            }
            // Is it a group start/end?
        } else if (this.peek() === '{' || this.peek() === '}') {
            result = new Token(this.get()!);
        } else if (this.peek() === '#') {
            // This could be either a param token, or a literal # (used for
            // colorspecs, for example). A param token is a '#' followed by
            // - a digit 0-9 followed by a non-alpha, non-digit
            // - or '?'.
            // Otherwise, it's a literal '#'.
            this.get();
            if (!this.end()) {
                let isParam = false;
                let next = this.peek();
                if (/[0-9?]/.test(next)) {
                    // Could be a param
                    isParam = true;
                    // Need to look ahead to the following char
                    if (this.pos + 1 < this.s.length) {
                        const after = this.s[this.pos + 1];
                        isParam = /[^0-9A-Za-z]/.test(after);
                    }
                }
                if (isParam) {
                    result = new Token('#');
                    next = this.get()!;
                    if (next >= '0' && next <= '9') {
                        result.value = parseInt(next);
                    } else {
                        result.value = '?';
                    }
                } else {
                    result = new Token('literal', '#');
                }
            }
        } else if (this.peek() === '$') {
            // Mode switch
            this.get();
            if (this.peek() === '$') {
                // $$
                this.get();
                result = new Token('$$');
            } else {
                // $
                result = new Token('$');
            }
        } else {
            result = new Token('literal', this.get()!);
        }
        return result;
    }
}

/**
 * Create Tokens from a stream of LaTeX
 *
 * @param s - A string o LaTeX. It can include comments (with the `%`
 * marker) and multiple lines.
 */
export function tokenize(s: string): Token[] {
    const result: Token[] = [];
    const lines = s.toString().split(/\r?\n/);
    let stream = '';
    let sep = '';
    for (const line of lines) {
        stream += sep;
        sep = ' ';
        // Remove everything after a % (comment marker)
        // (but \% should be preserved...)
        const m = line.match(/((?:\\%)|[^%])*/);
        if (m) stream += m[0];
    }

    const lex = new Lexer(stream);
    while (!lex.end()) {
        const token = lex.makeToken();
        if (token) result.push(token);
    }

    return result;
}
