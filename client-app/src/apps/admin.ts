import '../Bootstrap';

import {AppComponent} from '@xh/hoist/admin/AppComponent';
import {AppModel} from '@xh/hoist/admin/AppModel';
import {XH} from '@xh/hoist/core';
import {AppContainer} from '@xh/hoist/desktop/appcontainer';
import {AuthModel} from '../core/AuthModel';

XH.renderAdminApp({
    componentClass: AppComponent,
    modelClass: AppModel,
    containerClass: AppContainer,
    authModelClass: AuthModel,
    enableLogout: true
});
