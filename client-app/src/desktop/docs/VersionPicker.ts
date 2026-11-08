import {hbox} from '@xh/hoist/cmp/layout';
import {hoistCmp, XH} from '@xh/hoist/core';
import {select} from '@xh/hoist/desktop/cmp/input';

/**
 * One version select per documentation source (Hoist React, Hoist Core), listing the versions the
 * server has indexes for. Switching reloads that source's docs.
 */
export const versionPicker = hoistCmp.factory({
    displayName: 'VersionPicker',

    render() {
        const {docService} = XH;
        return hbox({
            gap: 8,
            items: docService.sourceNames.map(source => {
                const info = docService.sourceInfo[source];
                if (!info) return null;
                return select({
                    key: source,
                    width: 260,
                    enableFilter: false,
                    value: info.version,
                    options: (info.versions ?? []).map(v => ({
                        value: v,
                        label: `${info.label} ${v}`
                    })),
                    onChange: v => docService.setVersionAsync(source, v)
                });
            })
        });
    }
});
