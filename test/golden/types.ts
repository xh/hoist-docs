/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * Golden-set retrieval cases, shared by every library's set. A case is a realistic query an agent
 * would send, plus the results a person would want for it, chosen from the docs and API rather
 * than from what search happens to return.
 */

/** A doc, optionally narrowed to a section path prefix (headings below the doc title). */
export interface Target {
    doc: string;
    section?: string;
}

export const T = (doc: string, section?: string): Target => ({doc, section});

export interface DocCase {
    query: string;
    /** Any one of these in the top 3 sections counts as a hit. */
    expect: Target[];
    source: string;
}

export interface SymbolCase {
    query: string;
    /**
     * Any one of these in the top 3 symbols (including a folded factory or Props interface) or
     * the top 3 members counts as a hit. `Owner.member` names a member, `*.member` any owner's.
     */
    expect: string[];
    source: string;
}
