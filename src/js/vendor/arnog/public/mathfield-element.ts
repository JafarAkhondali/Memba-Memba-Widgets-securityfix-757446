import { MathfieldOptions } from './options';
import { Selector } from './commands';
import { InsertOptions, Mathfield, OutputFormat, Range } from './mathfield';
import { MathfieldErrorCode, ParseMode, ParserErrorCode, Style } from './core';

import {
    get as getOptions,
    getDefault as getDefaultOptions,
    update as updateOptions,
} from '../editor/options';
import { MathfieldPrivate } from '../editor/mathfield-class';

//
// Custom Events
//

/*
    ## Event retargeting
    Some events bubble up through the DOM tree, so that they are detectable by
     any element on the page.

    Bubbling events fired from within shadow DOM are retargeted so that, to any
    listener external to your component, they appear to come from your component itself.

    ## Custom Event Bubbling

    By default, a bubbling custom event fired inside shadow DOM will stop
    bubbling when it reaches the shadow root.

    To make a custom event pass through shadow DOM boundaries, you must set
    both the `composed` and `bubbles` flags to true.
*/

/**
 * The `math-error` custom event signals an error while parsing an expression.
 *
 * ```javascript
 * document.getElementById('mf').addEventListener('math-error', (ev) => {
 *  const err = ev.detail;
 *  console.warn(err.code + (err.arg ? ': ' + err.arg : '') +
 *         '\n%c|  ' + err.before + '%c' + err.after +
 *         '\n%c|  ' + String(' ').repeat(err.before.length) +
 *         '▲',
 *         'font-weight: bold',
 *         'font-weight: normal; color: rgba(160, 160, 160)',
 *         'font-weight: bold; color: hsl(4deg, 90%, 50%)'
 *     );
 * });
 * ```
 */
export type MathErrorEvent = {
    code: ParserErrorCode | MathfieldErrorCode;
    arg?: string;
    latex?: string;
    before?: string;
    after?: string;
};

export type KeystrokeEvent = {
    keystroke: string;
    event: KeyboardEvent;
};

/**
 * This event signals that the mathfield has lost focus through keyboard
 * navigation with arrow keys or the tab key.
 *
 * The event `detail.direction` property indicates the direction the cursor
 * was moving which can be useful to decide which element to focus next.
 */
export type FocusOutEvent = {
    direction: 'forward' | 'backward' | 'upward' | 'downward';
};

declare global {
    /**
     * Map the custom event names to types
     * @internal
     */
    interface DocumentEventMap {
        ['math-error']: CustomEvent<MathErrorEvent>;
        ['keystroke']: CustomEvent<KeystrokeEvent>;
        ['focus-out']: CustomEvent<FocusOutEvent>;
    }
}

const MATHFIELD_TEMPLATE = document.createElement('template');
MATHFIELD_TEMPLATE.innerHTML = `<style>
:host {
    display: block;
}
:host([hidden]) {
    display: none;
}
:host([disabled]) {
    opacity:  .5;
}
:host(:host:focus), :host(:host:focus-within) {
    outline: -webkit-focus-ring-color auto 1px;
}
:host(:host:focus:not(:focus-visible)) {
    outline: none;
}
</style>
<div></div><slot style="display:none"></slot>`;

//
// Deferred State
//
// Methods such as `setOptions()` or `getOptions()` could be called before
// the element has been connected (i.e. `mf = new MathfieldElement(); mf.setConfig()`...)
// and therefore before the matfield instance has been created.
// So we'll stash any deferred operations on options (and value) here, and
// will apply them to the element when it gets connected to the DOM.
//
const gDeferredState = new WeakMap<
    MathfieldElement,
    { value: string; selection: Range[]; options: Partial<MathfieldOptions> }
>();

/**
 * The `MathfieldElement` class provides special properties and
 * methods to control the display and behavior of `<math-field>`
 * elements.
 *
 * It inherits many useful properties and methods from [[`HTMLElement`]] such
 * as `style`, `tabIndex`, `addListener()`, etc...
 *
 * To create a new `MathfieldElement`:
 *
 * ```javascript
 * // Create a new MathfieldElement
 * const mfe = new MathfieldElement();
 * // Attach it to the document
 * document.body.appendChild(mfe);
 * ```
 *
 * The `MathfieldElement` constructor has an optional argument of
 * [[`MathfieldOptions`]] to configure the element. The options can also
 * be modified later:
 * ```javascript
 * mfe.setOptions({smartFence: true});
 * ```
 *
 * ### CSS Variables
 *
 * The following CSS variables, if applied to the mathfield element or
 * to one of its ancestors, can be used to customize the appearance of the
 * mathfield.
 *
 * | CSS Variable | Usage |
 * |:---|:---|
 * | `--hue` | Hue of the highlight color and the caret |
 * | `--highlight` | Color of the selection |
 * | `--highlight-inactive` | Color of the selection, when the mathfield is not focused |
 * | `--caret` | Color of the caret/insertion point |
 * | `--primary` | Primary accent color, used for example in the virtual keyboard |
 * | `--text-font-family` | The font stack used in text mode |
 * | `--keyboard-zindex` | The z-index attribute of the virtual keyboard panel |
 *
 * ### CSS Parts
 *
 * The `virtual-keyboard-toggle` CSS part can be used to style the virtual
 * keyboard toggle. To use it, define a CSS style with a `::part()` selector
 * for example:
 * ```css
 * math-field::part(virtual-keyboard-toggle) {
 *  color: red;
 * }
 * ```
 *
 *
 * ### Attributes
 *
 * An attribute is a key-value pair set as part of the tag, for example in
 * `<math-field locale="fr"></math-field>`, `locale` is an attribute.
 *
 * The supported attributes are listed in the table below with their correspnding
 * property. The property can be changed either directly on the
 * `MathfieldElement` object, or using `setOptions()` when it is prefixed with
 * `options.`, for example
 * ```
 *  getElementById('mf').value = '\\sin x';
 *  getElementById('mf').setOptions({horizontalSpacingScale: 1.1});
 * ```
 *
 * Most properties are reflected: changing the attribute will also change the
 * property and vice versa) except for `value` whose attribute value is not
 * updated.
 *
 *
 * In addition, the following [global attributes](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes)
 * can also be used:
 * - `class`
 * - `data-*`
 * - `hidden`
 * - `id`
 * - `item*`
 * - `style`
 * - `tabindex`
 *
 * | Attribute | Property |
 * |:---|:---|
 * | `disabled` | `disabled` |
 * | `default-mode` | `options.defaultMode` |
 * | `fonts-directory` | `options.fontsDirectory` |
 * | `horizontal-spacing-scale` | `options.horizontalSpacingScale` |
 * | `ignore-spacebar-in-math-mode` | `options.ignoreSpacbarInMathMode` |
 * | `inline-shortcut-timeout` | `options.inlineShortcutTimeout` |
 * | `keypress-vibration` | `options.keypressVibration` |
 * | `letter-shape-style` | `options.letterShapeStyle` |
 * | `locale` | `options.locale` |
 * | `read-only` | `options.readOnly` |
 * | `remove-extraneous-parentheses` | `options.removeExtraneousParentheses` |
 * | `smart-fence` | `options.smartFence` |
 * | `smart-mode` | `options.smartMode` |
 * | `smart-superscript` | `options.superscript` |
 * | `speech-engine` | `options.speechEngine` |
 * | `speech-engine-rate` | `options.speechEngineRate` |
 * | `speech-engine-voice` | `options.speechEngineVoice` |
 * | `text-to-speech-markup` | `options.textToSpeechMarkup` |
 * | `text-to-speech-rules` | `options.textToSpeechRules` |
 * | `virtual-keyboard-layout` | `options.keyboardLayout` |
 * | `virtual-keyboard-mode` | `options.keyboardMode` |
 * | `virtual-keyboard-theme` | `options.keyboardTheme` |
 * | `virtual-keyboards` | `options.keyboards` |
 *
 *  See [[`MathfieldOptions`]] for more details about these options.
 *
 * ### Events
 *
 * Listen to these events by using `addEventListener()`. For events with additional
 * arguments, the arguments are availble in `event.detail`.
 *
 * | Event Name | Event Arguments | Description |
 * |:---|:---|:---|
 * | `input |  | The value of the mathfield has been modified |
 * | `change` |  | The user has commited the value of the mathfield |
 * | `selection-change` |  | The selection of the mathfield has changed |
 * | `mode-change` |  | The mode of the mathfield has changed |
 * | `undo-state-change` |  | The state of the undo stack has changed |
 * | `read-aloud-status-change` |  | The status of a read aloud operation has changed |
 * | `virtual-keyboard-toggle` |  | The visibility of the virtual keyboard has changed |
 * | `blur` |  | The mathfield is losing focus |
 * | `focus` |  | The mathfield is gaining focus |
 * | `focus-out` | `(direction: 'forward' | 'backward' | 'upward' | 'downward'): boolean` | The user is navigating out of the mathfield, typically using the keyboard |
 * | `math-error` | `ErrorListener<ParserErrorCode | MathfieldErrorCode>` | A parsing or configuration error happened |
 * | `keystroke` | `(keystroke: string, event: KeyboardEvent): boolean` | The user typed a keystroke with a physical keyboard |
 * | `mount` | | Fired once when the element has been attached to the DOM |
 * | `unmount` | | Fired once when the element is about to be removed from the DOM |
 *
 */
export class MathfieldElement extends HTMLElement implements Mathfield {
    /**
     * Private lifecycle hooks
     * @internal
     */
    static get optionsAttributes(): {
        [attribute: string]: 'number' | 'boolean' | 'string';
    } {
        return {
            'default-mode': 'string',
            'fonts-directory': 'string',
            'horizontal-spacing-scale': 'number',
            'ignore-spacebar-in-math-mode': 'boolean',
            'inline-shortcut-timeout': 'number',
            'keypress-vibration': 'boolean',
            'letter-shape-style': 'string',
            locale: 'string',
            'read-only': 'boolean',
            'remove-extraneous-parentheses': 'boolean',
            'smart-fence': 'boolean',
            'smart-mode': 'boolean',
            'smart-superscript': 'boolean',
            'speech-engine': 'string',
            'speech-engine-rate': 'string',
            'speech-engine-voice': 'string',
            'text-to-speech-markup': 'string',
            'text-to-speech-rules': 'string',
            'virtual-keyboard-layout': 'string',
            'virtual-keyboard-mode': 'string',
            'virtual-keyboard-theme': 'string',
            'virtual-keyboards': 'string',
        };
    }
    /**
     * Custom elements lifecycle hooks
     * @internal
     */
    static get observedAttributes(): string[] {
        return [...Object.keys(MathfieldElement.optionsAttributes), 'disabled'];
    }

    #mathfield: MathfieldPrivate;

    /**
     * A new mathfield can be created using
     * ```javascript
    let mfe = new MathfieldElement();
    // Set initial value and options
    mfe.value = "\\frac{\\sin(x)}{\\cos(x)}";
    // Options can be set either as an attribute (for simple options)...
    mfe.setAttribute('virtual-keyboard-layout', 'dvorak');
    // ... or using `setOptions()`
    mfe.setOptions({
        virtualKeyboardMode: 'manual',
    });
    // Attach the element
    document.body.appendChild(mfe);
    * ```
    */
    constructor(options?: Partial<MathfieldOptions>) {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.appendChild(MATHFIELD_TEMPLATE.content.cloneNode(true));
        const slot = this.shadowRoot.querySelector<HTMLSlotElement>(
            'slot:not([name])'
        );

        // When the elements get focused (through tabbing for example)
        // focus the mathfield
        this.shadowRoot.host.addEventListener('focus', (_event) =>
            this.focus()
        );

        // Inline options (as a JSON structure in the markup)
        try {
            const json = slot
                .assignedElements()
                .filter((x) => x['type'] !== 'application/json')
                .map((x) => x.textContent)
                .join('');
            if (json) {
                this.setOptions(JSON.parse(json));
            }
        } catch (e) {
            console.log(e);
        }

        // Record the (optional) configuration options, as a deferred state
        if (options) {
            this.setOptions(options);
        }

        // Check if there is a `value` attribute and set the initial value
        // of the mathfield from it
        if (this.hasAttribute('value')) {
            this.value = this.getAttribute('value');
        } else {
            this.value =
                slot
                    ?.assignedNodes()
                    .map((x) => (x.nodeType === 3 ? x.textContent : ''))
                    .join('')
                    .trim() ?? '';
        }

        slot.addEventListener('slotchange', (e) => {
            if (e.target !== slot) return;
            const value = slot
                .assignedNodes()
                .map((x) => (x.nodeType === 3 ? x.textContent : ''))
                .join('')
                .trim();
            if (!this.#mathfield) {
                this.value = value;
            } else {
                // Don't suppress notification changes. We need to know
                // if the value has changed indirectly through slot manipulation
                this.#mathfield.setValue(value, {
                    insertionMode: 'replaceAll',
                });
            }
        });
    }

    get mode(): ParseMode {
        return this.#mathfield?.mode;
    }
    set mode(value: ParseMode) {
        if (!this.#mathfield) return;
        this.#mathfield.mode = value;
    }

    /**
     *  @category Options
     */
    getOptions<K extends keyof MathfieldOptions>(
        keys: K[]
    ): Pick<MathfieldOptions, K>;
    getOptions(): MathfieldOptions;
    getOptions(
        keys?: keyof MathfieldOptions | (keyof MathfieldOptions)[]
    ): any | Partial<MathfieldOptions> {
        if (this.#mathfield) {
            return getOptions(this.#mathfield.options, keys);
        }
        if (!gDeferredState.has(this)) return null;
        return getOptions(
            updateOptions(
                getDefaultOptions(),
                gDeferredState.get(this).options
            ),
            keys
        );
    }
    getOption<K extends keyof MathfieldOptions>(key: K): MathfieldOptions[K] {
        return (this.getOptions([key]) as unknown) as MathfieldOptions[K];
    }

    /**
     *  @category Options
     */
    setOptions(options: Partial<MathfieldOptions>): void {
        if (this.#mathfield) {
            this.#mathfield.setOptions(options);
        } else {
            if (gDeferredState.has(this)) {
                gDeferredState.set(this, {
                    value: gDeferredState.get(this).value,
                    selection: [{ start: 0, end: -1 }],
                    options: {
                        ...gDeferredState.get(this).options,
                        ...options,
                    },
                });
            } else {
                gDeferredState.set(this, {
                    value: '',
                    selection: [{ start: 0 }],
                    options: options,
                });
            }
        }

        // Reflect options to attributes
        reflectAttributes(this);
    }
    /**
     * Execute a [[`Commands`|command]] defined by a selector.
     * ```javascript
     * mfe.executeCommand('add-column-after');
     * mfe.executeCommand(['switch-mode', 'math']);
     * ```
     *
     * @param command - A selector, or an array whose first element
     * is a selector, and whose subsequent elements are arguments to the selector.
     *
     * Selectors can be passed either in camelCase or kebab-case.
     *
     * ```javascript
     * // Both calls do the same thing
     * mfe.executeCommand('selectAll');
     * mfe.executeCommand('select-all');
     * ```
     */
    executeCommand(command: Selector | [Selector, ...any[]]): boolean {
        return this.#mathfield?.executeCommand(command) ?? false;
    }

    /**
     *  @category Accessing and Changing the content
     */
    getValue(format?: OutputFormat): string {
        if (this.#mathfield) {
            return this.#mathfield.getValue(format);
        }
        if (gDeferredState.has(this)) {
            return gDeferredState.get(this).value;
        }
        return '';
    }

    /**
     *  @category Accessing and Changing the content
     */
    setValue(value?: string, options?: InsertOptions): void {
        if (this.#mathfield) {
            this.#mathfield.setValue(value, options);
            return;
        }
        if (gDeferredState.has(this)) {
            gDeferredState.set(this, {
                value,
                selection: [{ start: 0, end: -1, direction: 'forward' }],
                options: gDeferredState.get(this).options,
            });
            return;
        }
        gDeferredState.set(this, {
            value,
            selection: [{ start: 0, end: -1, direction: 'forward' }],
            options: getOptionsFromAttributes(this),
        });
    }

    /**
     * Return true if the mathfield is currently focused (responds to keyboard
     * input).
     *
     * @category Focus
     *
     */
    hasFocus(): boolean {
        return this.#mathfield?.hasFocus() ?? false;
    }
    /**
     * Sets the focus to the mathfield (will respond to keyboard input).
     *
     * @category Focus
     *
     */
    focus(): void {
        this.#mathfield?.focus();
    }
    /**
     * Remove the focus from the mathfield (will no longer respond to keyboard
     * input).
     *
     * @category Focus
     *
     */
    blur(): void {
        this.#mathfield?.blur();
    }

    /**
     * Select the content of the mathfield.
     * @category Selection
     */
    select(): void {
        this.#mathfield?.select();
    }
    /**
     * Inserts a block of text at the current insertion point.
     *
     * This method can be called explicitly or invoked as a selector with
     * `executeCommand("insert")`.
     *
     * After the insertion, the selection will be set according to the
     * `options.selectionMode`.
     *
     *  @category Accessing and Changing the content
     */
    insert(s: string, options?: InsertOptions): boolean {
        return this.#mathfield?.insert(s, options) ?? false;
    }
    /**
     * Updates the style (color, bold, italic, etc...) of the selection or sets
     * the style to be applied to future input.
     *
     * If there is a selection, the style is applied to the selection
     *
     * If the selection already has this style, it is removed.
     *
     * If the selection has the style partially applied (i.e. only some
     * sections), it is removed from those sections, and applied to the
     * entire selection.
     *
     * If there is no selection, the style will apply to the next character typed.
     *
     * @category Accessing and Changing the content
     */
    applyStyle(style: Style): void {
        return this.#mathfield?.applyStyle(style);
    }

    /**
     * @category Selection
     */
    getCaretPosition(): { x: number; y: number } {
        return this.#mathfield?.getCaretPosition() ?? null;
    }
    /**
     * @category Selection
     */
    setCaretPosition(x: number, y: number): boolean {
        return this.#mathfield?.setCaretPosition(x, y) ?? false;
    }

    /**
     * Custom elements lifecycle hooks
     * @internal
     */
    connectedCallback(): void {
        if (!this.hasAttribute('role')) this.setAttribute('role', 'textbox');
        // this.setAttribute('aria-multiline', 'false');
        if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '0');

        this.#mathfield = new MathfieldPrivate(
            this.shadowRoot.querySelector(':host > div'),
            {
                ...getOptionsFromAttributes(this),
                ...(gDeferredState.has(this)
                    ? gDeferredState.get(this).options
                    : {}),
                onBlur: () => {
                    this.dispatchEvent(
                        new Event('blur', {
                            cancelable: false,
                            bubbles: false, // 'focus' and 'blur' don't bubble
                        })
                    );
                },
                onContentDidChange: () => {
                    this.dispatchEvent(
                        new Event('input', {
                            cancelable: false,
                            bubbles: true,
                        })
                    );
                },
                onError: (err: {
                    code: ParserErrorCode | MathfieldErrorCode;
                    arg?: string;
                    latex?: string;
                    before?: string;
                    after?: string;
                }) => {
                    this.dispatchEvent(
                        new CustomEvent<MathErrorEvent>('math-error', {
                            detail: {
                                code: err.code,
                                arg: err.arg,
                                latex: err.latex,
                                before: err.before,
                                after: err.after,
                            },
                            cancelable: false,
                            bubbles: true,
                        })
                    );
                },
                onFocus: () => {
                    this.dispatchEvent(
                        new Event('focus', {
                            cancelable: false,
                            bubbles: false, // 'focus' and 'blur' don't bubble
                        })
                    );
                },
                onKeystroke: (
                    _sender: Mathfield,
                    keystroke: string,
                    ev: KeyboardEvent
                ): boolean => {
                    return this.dispatchEvent(
                        new CustomEvent<KeystrokeEvent>('keystroke', {
                            detail: {
                                keystroke,
                                event: ev,
                            },
                            cancelable: true,
                            bubbles: true,
                        })
                    );
                },
                onModeChange: (_sender: Mathfield, _mode: ParseMode) => {
                    this.dispatchEvent(
                        new Event('mode-change', {
                            cancelable: false,
                            bubbles: true,
                        })
                    );
                },
                onCommit: (_sender: Mathfield) => {
                    // Match the DOM event sent by `<input>`, `<textarea>`, etc...
                    // Sent when the [Return] or [Enter] key is pressed, or on
                    // focus loss if the content has changed.
                    this.dispatchEvent(
                        new Event('change', {
                            cancelable: false,
                            bubbles: true,
                        })
                    );
                },
                onMoveOutOf: (
                    _sender: Mathfield,
                    direction: 'forward' | 'backward' | 'upward' | 'downward'
                ): boolean => {
                    return this.dispatchEvent(
                        new CustomEvent<FocusOutEvent>('focus-out', {
                            detail: { direction },
                            cancelable: true,
                            bubbles: true,
                        })
                    );
                },
                onTabOutOf: (
                    _sender: Mathfield,
                    direction: 'forward' | 'backward'
                ): boolean => {
                    return this.dispatchEvent(
                        new CustomEvent<FocusOutEvent>('focus-out', {
                            detail: { direction },
                            cancelable: true,
                            bubbles: true,
                        })
                    );
                },
                onReadAloudStatus: () => {
                    this.dispatchEvent(
                        new Event('read-aloud-status-change', {
                            cancelable: false,
                            bubbles: true,
                        })
                    );
                },
                onSelectionDidChange: () => {
                    this.dispatchEvent(
                        new Event('selection-change', {
                            cancelable: false,
                            bubbles: true,
                        })
                    );
                },
                onUndoStateDidChange: () => {
                    this.dispatchEvent(
                        new Event('undo-state-change', {
                            cancelable: false,
                            bubbles: true,
                        })
                    );
                },
                onVirtualKeyboardToggle: (
                    _sender: Mathfield,
                    _visible: boolean,
                    _keyboardElement: HTMLElement
                ) => {
                    this.dispatchEvent(
                        new Event('virtual-keyboard-toggle', {
                            bubbles: true,
                            cancelable: false,
                        })
                    );
                },
            }
        );

        if (gDeferredState.has(this)) {
            const suppressChangeNotifications = this.#mathfield.model
                .suppressChangeNotifications;
            this.#mathfield.model.suppressChangeNotifications = true;
            this.#mathfield.setValue(gDeferredState.get(this).value);
            this.#mathfield.selection = gDeferredState.get(this).selection;
            gDeferredState.delete(this);
            this.#mathfield.model.suppressChangeNotifications = suppressChangeNotifications;
        }

        this.upgradeProperty('disabled');

        // Notify listeners that we're mounted and ready
        this.dispatchEvent(
            new Event('mount', {
                cancelable: false,
                bubbles: true,
            })
        );
    }

    /**
     * Custom elements lifecycle hooks
     * @internal
     */
    disconnectedCallback(): void {
        // Notify listeners that we're about to be unmounted
        this.dispatchEvent(
            new Event('unmount', {
                cancelable: false,
                bubbles: true,
            })
        );

        if (!this.#mathfield) return;

        // Save the state (in case the elements get reconnected later)
        const options = {};
        Object.keys(MathfieldElement.optionsAttributes).forEach((x) => {
            options[toCamelCase(x)] = this.#mathfield.getConfig(
                toCamelCase(x) as any
            );
        });
        gDeferredState.set(this, {
            value: this.#mathfield.getValue(),
            selection: this.#mathfield.selection,
            options,
        });

        // Dispose of the mathfield
        this.#mathfield.dispose();
        this.#mathfield = null;
    }

    /**
     * Private lifecycle hooks
     * @internal
     */
    upgradeProperty(prop: string): void {
        if (this.hasOwnProperty(prop)) {
            const value: unknown = this[prop];
            // A property may have already been set on the object, before
            // the element was connected: delete the property (after saving its value)
            // and use the setter to (re-)set its value.
            delete this[prop];
            this[prop] = value;
        }
    }

    /**
     * Custom elements lifecycle hooks
     * @internal
     */
    attributeChangedCallback(
        name: string,
        oldValue: unknown,
        newValue: unknown
    ): void {
        if (oldValue === newValue) return;
        const hasValue: boolean = newValue !== null;
        switch (name) {
            case 'disabled':
                this.disabled = hasValue;
                break;
        }
    }

    set disabled(value: boolean) {
        const isDisabled = Boolean(value);
        if (isDisabled) this.setAttribute('disabled', '');
        else this.removeAttribute('disabled');

        this.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
        this.setOptions({ readOnly: isDisabled });
    }

    get disabled(): boolean {
        return this.hasAttribute('disabled');
    }

    /**
     *  @category Accessing and Changing the content
     */
    set value(value: string) {
        this.setValue(value);
    }

    /**
     * The content of the mathfield as a Latex expression.
     * ```
     * document.querySelector('mf').value = '\\frac{1}{\\pi}'
     * ```
     *  @category Accessing and Changing the content
     */
    get value(): string {
        return this.getValue();
    }

    /**
     * An array of ranges representing the selection.
     *
     * It is guaranteed there will be at least one element. If a discontinuous
     * selection is present, the result will include more than one element.
     *
     * @category Selection
     *
     */
    get selection(): Range[] {
        if (this.#mathfield) {
            return this.#mathfield.selection;
        }
        if (gDeferredState.has(this)) {
            return gDeferredState.get(this).selection;
        }
        return [{ start: 0, direction: 'forward' }];
    }

    /**
     * Change the selection
     *
     * @category Selection
     */
    set selection(value: Range[]) {
        if (this.#mathfield) {
            this.#mathfield.selection = value;
        }
        if (gDeferredState.has(this)) {
            gDeferredState.set(this, {
                value: gDeferredState.get(this).value,
                selection: value,
                options: gDeferredState.get(this).options,
            });
            return;
        }
        gDeferredState.set(this, {
            value: '',
            selection: value,
            options: getOptionsFromAttributes(this),
        });
    }

    /**
     * The position of the caret/insertion point, from 0 to `lastPosition`.
     *
     * @category Selection
     *
     */
    get position(): number {
        const selection = this.selection;
        if (selection[selection.length - 1].direction === 'backward') {
            return selection[selection.length - 1].start;
        }
        return selection[0].end ?? selection[0].start;
    }

    /**
     * @category Selection
     */
    set position(value: number) {
        this.selection = [{ start: value }];
    }

    /**
     * The last valid position.
     * @category Selection
     */
    get lastPosition(): number {
        return this.#mathfield?.lastPosition ?? -1;
    }
}

function toCamelCase(s: string): string {
    return s
        .toLowerCase()
        .replace(/[^a-zA-Z0-9]+(.)/g, (m, c) => c.toUpperCase());
}

function reflectAttributes(el: MathfieldElement) {
    const defaultOptions = getDefaultOptions();
    const options = el.getOptions();
    Object.keys(MathfieldElement.optionsAttributes).forEach((x) => {
        const prop = toCamelCase(x);
        if (defaultOptions[prop] !== options[prop]) {
            if (MathfieldElement.optionsAttributes[x] === 'boolean') {
                if (options[prop]) {
                    // add attribute
                    el.setAttribute(x, '');
                } else {
                    // remove attribute
                    el.removeAttribute(x);
                }
            } else {
                // set attribute (as string)
                el.setAttribute(x, options[prop].toString());
            }
        }
    });
}

// function toKebabCase(s: string): string {
//     return s
//         .match(
//             /[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g
//         )
//         .map((x: string) => x.toLowerCase())
//         .join('-');
// }

function getOptionsFromAttributes(
    mfe: MathfieldElement
): Partial<MathfieldOptions> {
    const result = {};
    const attribs = MathfieldElement.optionsAttributes;
    Object.keys(attribs).forEach((x) => {
        if (mfe.hasAttribute(x)) {
            const value = mfe.getAttribute(x);
            if (attribs[x] === 'boolean') {
                const lcValue = value.toLowerCase();
                if (
                    lcValue === 'true' ||
                    lcValue === 'yes' ||
                    lcValue === 'on'
                ) {
                    result[toCamelCase(x)] = true;
                } else {
                    result[toCamelCase(x)] = false;
                }
            } else if (attribs[x] === 'number') {
                result[toCamelCase(x)] = parseFloat(value);
            } else {
                result[toCamelCase(x)] = value;
            }
        }
    });
    return result;
}

export default MathfieldElement;

declare global {
    /** @internal */
    interface Window {
        MathfieldElement: typeof MathfieldElement;
    }
}

if (!window.customElements.get('math-field')) {
    window.MathfieldElement = MathfieldElement;
    window.customElements.define('math-field', MathfieldElement);
}
