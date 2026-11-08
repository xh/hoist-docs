import '../Bootstrap';

import {XH} from '@xh/hoist/core';
import {AppContainer} from '@xh/hoist/desktop/appcontainer';
import {AuthModel} from '../core/AuthModel';
import {AppComponent} from '../desktop/AppComponent';
import {AppModel} from '../desktop/AppModel';

XH.renderApp({
    clientAppCode: 'app',
    clientAppName: 'Hoist Docs',
    componentClass: AppComponent,
    modelClass: AppModel,
    containerClass: AppContainer,
    authModelClass: AuthModel,
    isMobileApp: false,
    enableLogout: true,
    checkAccess: () => true
});
