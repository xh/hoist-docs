import {hoistCmp, uses} from '@xh/hoist/core';
import {appBar} from '@xh/hoist/desktop/cmp/appbar';
import {themeToggleButton} from '@xh/hoist/desktop/cmp/button';
import {panel} from '@xh/hoist/desktop/cmp/panel';
import {Icon} from '@xh/hoist/icon';
import {versionPicker} from './docs/VersionPicker';
import {docsTab} from './docs/DocsTab';
import {AppModel} from './AppModel';

export const AppComponent = hoistCmp({
    displayName: 'App',
    model: uses(AppModel),

    render() {
        return panel({
            tbar: appBar({
                icon: Icon.book({size: '2x'}),
                rightItems: [versionPicker(), themeToggleButton()],
                hideRefreshButton: true,
                appMenuButtonProps: {hideThemeItem: true}
            }),
            item: docsTab(),
            mask: 'onLoad'
        });
    }
});
