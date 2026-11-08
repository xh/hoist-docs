/**
 * Bootstrap routine for client-side licenses and low-level library setup: TypeScript module
 * augmentation, AG Grid module and license registration, and Highcharts - all for the Admin
 * Console, this app's only client.
 */
import {XH} from '@xh/hoist/core';
import {when} from '@xh/hoist/mobx';

declare module '@xh/hoist/core' {
    export interface HoistUser {
        profilePicUrl: string;
    }
}

import {installAgGrid} from '@xh/hoist/kit/ag-grid';
import {
    CellStyleModule,
    ClientSideRowModelApiModule,
    ClientSideRowModelModule,
    ColumnApiModule,
    CustomEditorModule,
    ModuleRegistry,
    NumberFilterModule,
    PinnedRowModule,
    RenderApiModule,
    RowApiModule,
    RowAutoHeightModule,
    RowSelectionModule,
    RowStyleModule,
    ScrollApiModule,
    TextEditorModule,
    TextFilterModule,
    TooltipModule
} from 'ag-grid-community';
import {
    CellSelectionModule,
    ClipboardModule,
    ColumnsToolPanelModule,
    FiltersToolPanelModule,
    LicenseManager,
    MenuModule,
    RowGroupingModule,
    SideBarModule,
    TreeDataModule
} from 'ag-grid-enterprise';
import {AgGridReact} from 'ag-grid-react';

ModuleRegistry.registerModules([
    CellStyleModule,
    ClientSideRowModelApiModule,
    ClientSideRowModelModule,
    ColumnApiModule,
    CustomEditorModule,
    NumberFilterModule,
    PinnedRowModule,
    RenderApiModule,
    RowApiModule,
    RowAutoHeightModule,
    RowSelectionModule,
    RowStyleModule,
    ScrollApiModule,
    TextEditorModule,
    TextFilterModule,
    TooltipModule,
    CellSelectionModule,
    ClipboardModule,
    ColumnsToolPanelModule,
    FiltersToolPanelModule,
    MenuModule,
    RowGroupingModule,
    SideBarModule,
    TreeDataModule
]);
installAgGrid(AgGridReact as any, ClientSideRowModelModule.version);

when(
    () => XH.appIsRunning,
    () => {
        const agLicense = XH.getConf('jsLicenses', {}).agGrid;
        if (agLicense) LicenseManager.setLicenseKey(agLicense);
    }
);

import {installHighcharts} from '@xh/hoist/kit/highcharts';
import Highcharts from 'highcharts/highstock';
import 'highcharts/modules/exporting';
import 'highcharts/modules/export-data';
import 'highcharts/modules/offline-exporting';

installHighcharts(Highcharts);
