/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {parseDocSections, type DocSection} from './doc-sections.ts';
import type {DocEntryJson} from './types.ts';

/** One doc of a library, with its sections parsed on first use. Browser-safe. */
export class DocEntry {
    readonly id: string;
    readonly title: string;
    readonly mcpCategory: string;
    readonly viewerCategory: string;
    readonly description: string;
    readonly keywords: string[];
    readonly aliases: string[];
    readonly markdown: string;
    private _sections: DocSection[] | null = null;

    constructor(json: DocEntryJson) {
        this.id = json.id;
        this.title = json.title;
        this.mcpCategory = json.mcpCategory;
        this.viewerCategory = json.viewerCategory;
        this.description = json.description ?? '';
        this.keywords = json.keywords ?? [];
        this.aliases = json.aliases ?? [];
        this.markdown = json.markdown ?? '';
    }

    get sections(): DocSection[] {
        return (this._sections ??= parseDocSections(this, this.markdown));
    }
}
