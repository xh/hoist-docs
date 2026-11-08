import type {InitContext} from '@xh/hoist/core';
import {HoistAppModel, XH} from '@xh/hoist/core';
import {DocService} from '../core/svc/DocService';

export class AppModel extends HoistAppModel {
    static instance: AppModel;

    override async initAsync(ctx: InitContext) {
        await XH.installServicesAsync([DocService], ctx);
    }

    override getRoutes() {
        return [
            {
                name: 'default',
                path: '/app',
                forwardTo: 'default.docs',
                children: [
                    {
                        name: 'docs',
                        path: '/docs',
                        children: [{name: 'docRef', path: '/:source/:docId?section'}]
                    }
                ]
            }
        ];
    }
}
