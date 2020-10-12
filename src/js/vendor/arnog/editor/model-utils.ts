import type { ParseMode } from '../public/core';
import type { Mathfield, Range } from '../public/mathfield';
import type { ModelPrivate } from './model-class';

import type { MacroDictionary } from '../core/definitions';
import type { Atom } from '../core/atom';
import { PositionIterator } from './model-iterator';

export type ModelOptions = {
    mode: ParseMode;
    macros: MacroDictionary;
    removeExtraneousParentheses: boolean;
};

export type ModelHooks = {
    announce?: (
        target: Mathfield, // @revisit: could drop this argument
        command: string, // verb
        // | 'plonk'
        // | 'replacement'
        //     | 'line'
        //     | 'move'
        //     | 'moveUp'
        //     | 'moveDown'
        //     | 'deleted'
        //     | 'deleted: numerator'
        //     | 'deleted: denominator'
        //     | 'deleted: root'
        //     | 'deleted: superscript',
        modelBefore: ModelPrivate,
        atoms: Atom[] // object of the command
    ) => void;
    moveOut?: (
        sender: ModelPrivate,
        direction: 'forward' | 'backward' | 'upward' | 'downward'
    ) => boolean;
    tabOut?: (
        sender: ModelPrivate,
        direction: 'forward' | 'backward'
    ) => boolean;
};

export function isEmptyMathlist(atoms: Atom[]): boolean {
    return (
        atoms.length === 0 || (atoms.length === 1 && atoms[0].type === 'first')
    );
}

export function removeSuggestion(model: ModelPrivate): void {
    const siblings = model.siblings();
    // Remove all `suggestion` atoms
    for (let i = siblings.length - 1; i >= 0; i--) {
        if (siblings[i].isSuggestion) {
            siblings.splice(i, 1);
        }
    }
}

/**
 * Clear the verbatim Latex property for the parent node and its parents.
 * This will cause the latex value to be re-calculated.
 */
export function invalidateVerbatimLatex(model: ModelPrivate): void {
    let depth = 1;
    let atom = model.ancestor(depth);
    while (atom) {
        atom.latex = undefined;
        depth += 1;
        atom = model.ancestor(depth);
    }
}

/**
 * Ensure that the range is valid and canonical, i.e.
 * start <= end
 * collapsed = start === end
 * start >= 0, end >=0
 * If optins.accesibleAtomsOnly, the range is limited to the values
 * that can produce an atom, specifically, the last value is excluded (it's
 * a valid position to insert, but it can't be read from)
 */
export function normalizeRange(
    iter: PositionIterator,
    range: Range,
    options: {
        accessibleAtomsOnly?: boolean;
    } = { accessibleAtomsOnly: false }
): Range {
    const result: Range = { ...range };

    const lastPosition = options.accessibleAtomsOnly
        ? iter.lastPosition - 1
        : iter.lastPosition;

    if (result.end === -1) {
        result.end = lastPosition;
    } else if (isNaN(result.end)) {
        result.end = result.start;
    } else {
        result.end = Math.min(result.end, lastPosition);
    }
    if (result.start < result.end) {
        result.direction = 'forward';
    } else {
        [result.start, result.end] = [result.end, result.start];
        result.direction = 'backward';
    }
    result.collapsed = result.start === result.end;
    if (result.collapsed) {
        result.direction = 'none';
    }
    if (iter.positions[result.start]) {
        result.depth = iter.positions[result.start].depth - 1;
    }
    return result;
}
