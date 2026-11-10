/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * hoist-react golden set, carried over verbatim from the specs in hoist-react's former `mcp/data`
 * (`doc-search.spec.ts`, `symbol-search.spec.ts`) at commit 788f56b3d. Source tags name what each
 * case guards: an agent experiment trail, an entry from the docs/README.md quick reference, a
 * topic, a multi-word query that must not come back empty, a common API name, or a symbol that must
 * stay re-exported by its package barrel.
 */
import {T, type DocCase, type SymbolCase} from './types.ts';

export const REACT_DOC_CASES: DocCase[] = [
    // Experiment tasks: grid columns with renderers; confirm + fetch + mask + toast;
    // persisted grid + panel; validated form.
    {
        query: 'mask panel during async call',
        expect: [
            T('desktop/cmp/panel/README.md', 'Mask'),
            T('promise/README.md', 'Promise Prototype Extensions > UI Masking')
        ],
        source: 'experiment'
    },
    {
        query: 'form field required validation custom message',
        expect: [
            T('cmp/form/README.md', 'FieldModel > Validation Rules'),
            T('data/README.md', 'Validation System > Custom Constraints')
        ],
        source: 'experiment'
    },
    {
        query: 'lazy load tabs route',
        expect: [
            T('docs/routing.md', 'TabContainerModel Route Integration'),
            T('cmp/tab/README.md', 'TabContainerModel > Routing'),
            T('cmp/tab/README.md', 'TabContainerModel > Render Modes')
        ],
        source: 'experiment'
    },
    {
        query: 'how to show a confirmation dialog',
        expect: [T('appcontainer/README.md', 'Messages > XH.confirm')],
        source: 'experiment'
    },
    {
        query: 'grid column custom renderer',
        expect: [
            T('cmp/grid/README.md', 'Common Usage Patterns > Custom Renderers'),
            T('format/README.md', 'Formatters vs Renderers > Renderer Factories')
        ],
        source: 'experiment'
    },
    {
        query: 'number format renderer column',
        expect: [
            T('format/README.md', 'Formatters vs Renderers > Renderer Factories'),
            T('format/README.md', 'Common Patterns > Defining Reusable Column Specs')
        ],
        source: 'experiment'
    },
    {
        query: 'column spec properties width headerName',
        expect: [T('cmp/grid/README.md', 'Column Properties Reference')],
        source: 'experiment'
    },
    {
        query: 'fetchJson post body',
        expect: [
            T('svc/README.md', 'Built-in Services > Core Data Access'),
            T('svc/README.md', 'Common Pitfalls > params Triggers a POST')
        ],
        source: 'experiment'
    },
    {
        query: 'toast message',
        expect: [T('appcontainer/README.md', 'Toasts')],
        source: 'experiment'
    },
    {
        query: 'deleteSelectedAsync grid selected record',
        expect: [T('cmp/grid/README.md', 'Common Usage Patterns > Selection')],
        source: 'experiment'
    },
    {
        query: 'persist grid column state',
        expect: [T('docs/persistence.md', 'Built-in Model Support > GridModel')],
        source: 'experiment'
    },
    {
        query: 'persistWith',
        expect: [
            T('docs/persistence.md', 'Using Persistence > Approach 3'),
            T('docs/persistence.md', 'Common Pitfalls > Missing persistWith')
        ],
        source: 'experiment'
    },
    {
        query: 'panel collapse resize persist',
        expect: [
            T('docs/persistence.md', 'Common Patterns > Panel Collapse'),
            T('docs/persistence.md', 'Built-in Model Support > PanelModel'),
            T('desktop/cmp/panel/README.md', 'Persistence')
        ],
        source: 'experiment'
    },
    {
        query: 'create FormModel fields',
        expect: [T('cmp/form/README.md', 'FormModel > Creating a FormModel')],
        source: 'experiment'
    },
    {
        query: 'validate form before save',
        expect: [T('cmp/form/README.md', 'FormModel > Validation')],
        source: 'experiment'
    },

    // Rows of the "Quick Reference by Task" table in docs/README.md.
    {query: 'component model service pattern', expect: [T('core/README.md')], source: 'quick-ref'},
    {query: 'XH singleton API', expect: [T('core/README.md', 'XH Singleton')], source: 'quick-ref'},
    {query: 'configure data grid', expect: [T('cmp/grid/README.md')], source: 'quick-ref'},
    {
        query: 'input change commit lifecycle',
        expect: [T('cmp/input/README.md')],
        source: 'quick-ref'
    },
    {query: 'tabbed interface', expect: [T('cmp/tab/README.md')], source: 'quick-ref'},
    {
        query: 'configurable dashboard',
        expect: [T('desktop/cmp/dash/README.md')],
        source: 'quick-ref'
    },
    {
        query: 'panel toolbar',
        expect: [
            T('desktop/cmp/panel/README.md', 'Toolbars'),
            T('desktop/README.md', 'Component Sub-Packages > Toolbar')
        ],
        source: 'quick-ref'
    },
    {query: 'mobile app navigator', expect: [T('mobile/README.md')], source: 'quick-ref'},
    {
        query: 'save and restore named views',
        expect: [T('cmp/viewmanager/README.md')],
        source: 'quick-ref'
    },
    {
        query: 'date range presets',
        expect: [T('cmp/daterange/README.md', 'DateRangePickerModel > Presets')],
        source: 'quick-ref'
    },
    {
        query: 'layout containers hbox vbox',
        expect: [T('cmp/layout/README.md', 'Core Components > VBox')],
        source: 'quick-ref'
    },
    {query: 'store records fields', expect: [T('data/README.md')], source: 'quick-ref'},
    {
        query: 'cube aggregation views queries',
        expect: [T('data/cube/README.md')],
        source: 'quick-ref'
    },
    {query: 'ConfigService PrefService', expect: [T('svc/README.md')], source: 'quick-ref'},
    {query: 'tracing metrics', expect: [T('docs/telemetry.md')], source: 'quick-ref'},
    {
        query: 'format dates',
        expect: [T('format/README.md', 'Date Formatting')],
        source: 'quick-ref'
    },
    {
        query: 'localization locale',
        expect: [T('format/README.md', 'Localization')],
        source: 'quick-ref'
    },
    {query: 'app startup sequence', expect: [T('docs/lifecycle-app.md')], source: 'quick-ref'},
    {
        query: 'model lifecycle loading',
        expect: [T('docs/lifecycle-models-and-services.md')],
        source: 'quick-ref'
    },
    {
        query: 'OAuth login authentication',
        expect: [T('docs/authentication.md'), T('security/README.md')],
        source: 'quick-ref'
    },
    {query: 'check roles gates access', expect: [T('docs/authorization.md')], source: 'quick-ref'},
    {query: 'client-side routing', expect: [T('docs/routing.md')], source: 'quick-ref'},
    {
        query: 'handle exceptions error dialog',
        expect: [T('docs/error-handling.md'), T('appcontainer/README.md', 'Exception Handling')],
        source: 'quick-ref'
    },
    {
        query: 'testId selectors test automation',
        expect: [T('docs/test-automation.md')],
        source: 'quick-ref'
    },
    {
        query: 'promise error handling tracking',
        expect: [T('promise/README.md')],
        source: 'quick-ref'
    },
    {query: 'bindable observable', expect: [T('mobx/README.md')], source: 'quick-ref'},
    {
        query: 'timer decorators LocalDate hooks',
        expect: [T('utils/README.md')],
        source: 'quick-ref'
    },
    {
        query: 'theming app shell',
        expect: [T('appcontainer/README.md', 'Theme'), T('styles/README.md')],
        source: 'quick-ref'
    },
    {query: 'icons in buttons', expect: [T('icon/README.md')], source: 'quick-ref'},
    {
        query: 'customize spinner',
        expect: [T('icon/README.md', 'Usage Patterns > Spinner Component')],
        source: 'quick-ref'
    },
    {
        query: 'Auth0 MSAL client',
        expect: [T('security/README.md'), T('docs/authentication.md', 'OAuth Clients')],
        source: 'quick-ref'
    },
    {query: 'detect memory leaks', expect: [T('inspector/README.md')], source: 'quick-ref'},
    {query: 'third-party library kit', expect: [T('kit/README.md')], source: 'quick-ref'},
    {
        query: 'deploy docker nginx',
        expect: [T('docs/build-and-deploy-app.md')],
        source: 'quick-ref'
    },
    {
        query: 'local development environment setup',
        expect: [T('docs/development-environment.md')],
        source: 'quick-ref'
    },
    {query: 'MCP tools AI assistants', expect: [T('mcp/README.md')], source: 'quick-ref'},
    {query: 'customize colors fonts theme', expect: [T('styles/README.md')], source: 'quick-ref'},
    {query: 'coding conventions', expect: [T('docs/coding-conventions.md')], source: 'quick-ref'},
    {
        query: 'hoist-core version compatibility',
        expect: [T('docs/version-compatibility.md')],
        source: 'quick-ref'
    },

    // Topic lookups: specific APIs and patterns.
    {
        query: 'tab render mode lazy',
        expect: [T('cmp/tab/README.md', 'TabContainerModel > Render Modes')],
        source: 'topic'
    },
    {
        query: 'catchDefault',
        expect: [
            T('promise/README.md', 'Promise Prototype Extensions > Error Handling'),
            T('docs/error-handling.md', 'Promise.catchDefault()')
        ],
        source: 'topic'
    },
    {
        query: 'handleException options',
        expect: [
            T('docs/error-handling.md', 'XH.handleException()'),
            T('appcontainer/README.md', 'Exception Handling')
        ],
        source: 'topic'
    },
    {
        query: 'store loadData',
        expect: [T('data/README.md', 'Store > Data Loading')],
        source: 'topic'
    },
    {
        query: 'tree data children',
        expect: [
            T('data/README.md', 'Tree Data'),
            T('cmp/grid/README.md', 'Common Usage Patterns > Tree Mode')
        ],
        source: 'topic'
    },
    {
        query: 'custom cube aggregator',
        expect: [T('data/cube/README.md', 'Custom Aggregators')],
        source: 'topic'
    },
    {
        query: 'DashContainer viewSpecs',
        expect: [T('desktop/cmp/dash/README.md', 'DashContainer')],
        source: 'topic'
    },
    {
        query: 'view manager auto save',
        expect: [T('cmp/viewmanager/README.md', 'ViewManagerModel > Auto-Save')],
        source: 'topic'
    },
    {
        query: 'Timer create interval',
        expect: [T('utils/README.md', 'Async Utilities > Timer')],
        source: 'topic'
    },
    {
        query: 'fmtNumber precision',
        expect: [T('format/README.md', 'Number Formatting')],
        source: 'topic'
    },
    {
        query: 'loadSpec isStale',
        expect: [
            T(
                'docs/lifecycle-models-and-services.md',
                'LoadSupport Deep Dive > Staleness Checking'
            ),
            T(
                'docs/error-handling.md',
                'Error Handling in doLoadAsync > Why Check loadSpec.isStale'
            )
        ],
        source: 'topic'
    },
    {
        query: 'authoring container component children items',
        expect: [T('core/README.md', 'Element Factories > Authoring a Container Component')],
        source: 'topic'
    },
    {
        query: 'creates vs uses',
        expect: [T('core/README.md', 'Components and hoistCmp > Model Specs')],
        source: 'topic'
    },
    {
        query: 'websocket subscription',
        expect: [
            T('svc/README.md', 'Common Patterns > WebSocket Subscriptions'),
            T('svc/README.md', 'Built-in Services > Communication')
        ],
        source: 'topic'
    },
    {query: 'dark theme', expect: [T('styles/README.md', 'Dark Theme')], source: 'topic'},
    {
        query: 'BEM css class naming',
        expect: [
            T('styles/README.md', 'BEM Class Naming'),
            T('docs/coding-conventions.md', 'CSS Class Naming')
        ],
        source: 'topic'
    },
    {
        query: 'grid context menu',
        expect: [T('cmp/grid/README.md', 'Common Usage Patterns > Context Menus')],
        source: 'topic'
    },
    {
        query: 'grid export excel',
        expect: [T('cmp/grid/README.md', 'Common Usage Patterns > Export')],
        source: 'topic'
    },
    {
        query: 'grid inline editing',
        expect: [T('cmp/grid/README.md', 'Common Usage Patterns > Inline Editing')],
        source: 'topic'
    },
    {
        query: 'impersonation',
        expect: [
            T('appcontainer/README.md', 'Impersonation'),
            T('docs/authentication.md', 'Identity and Access Control > Impersonation')
        ],
        source: 'topic'
    },
    {
        query: 'navigate routerState',
        expect: [T('docs/routing.md', 'XH Routing API')],
        source: 'topic'
    },
    {query: 'changelog entry format', expect: [T('docs/changelog-format.md')], source: 'topic'},
    {
        query: 'managed decorator destroy',
        expect: [
            T('docs/lifecycle-models-and-services.md', 'HoistModel Lifecycle > Destruction'),
            T('core/README.md', 'HoistBase')
        ],
        source: 'topic'
    },
    {
        query: 'serve docs from my own Hoist library',
        expect: [T('docs/companion-library-docs.md')],
        source: 'topic'
    },
    {
        query: 'docRegistry package.json',
        expect: [T('docs/companion-library-docs.md')],
        source: 'topic'
    }
];
export const REACT_SYMBOL_CASES: SymbolCase[] = [
    // Experiment task: grid with custom column renderers.
    {query: 'GridModel', expect: ['GridModel'], source: 'experiment'},
    {
        query: 'column renderer',
        expect: ['ColumnRenderer', 'Column.renderer', 'ColumnSpec.renderer'],
        source: 'experiment'
    },
    {query: 'headerName', expect: ['ColumnSpec.headerName'], source: 'experiment'},
    {query: 'checkboxRenderer', expect: ['checkboxRenderer'], source: 'experiment'},
    {query: 'number renderer', expect: ['numberRenderer', 'fmtNumber'], source: 'experiment'},
    {query: 'dateRenderer', expect: ['dateRenderer'], source: 'experiment'},
    {
        query: 'column width flex',
        expect: ['ColumnSpec.width', 'ColumnSpec.flex', 'Column.flex', 'Column.width'],
        source: 'experiment'
    },
    {
        query: 'grid columns',
        expect: ['GridConfig.columns', 'GridModel.columns'],
        source: 'experiment'
    },
    {query: 'store fields', expect: ['StoreConfig.fields', 'Store.fields'], source: 'experiment'},
    {
        query: 'selected record',
        expect: ['GridModel.selectedRecord', 'StoreSelectionModel.selectedRecord'],
        source: 'experiment'
    },
    {
        query: 'groupSortFn',
        expect: ['GridConfig.groupSortFn', 'GridModel.groupSortFn'],
        source: 'experiment'
    },

    // Experiment task: confirm, fetch, mask, toast.
    {query: 'confirm', expect: ['XHApi.confirm'], source: 'experiment'},
    {query: 'XH confirm dialog', expect: ['XHApi.confirm', 'MessageSpec'], source: 'experiment'},
    {query: 'toast', expect: ['XHApi.toast', 'ToastSpec'], source: 'experiment'},
    {
        query: 'fetchJson',
        expect: ['FetchService.fetchJson', 'XHApi.fetchJson'],
        source: 'experiment'
    },
    {
        query: 'fetch params post',
        expect: ['FetchOptions.params', 'FetchOptions.method', 'FetchOptions'],
        source: 'experiment'
    },
    {
        query: 'fetchJson options',
        expect: ['FetchOptions', 'FetchService.fetchJson'],
        source: 'experiment'
    },
    {query: 'mask', expect: ['Mask', 'mask', 'MaskProps'], source: 'experiment'},
    {
        query: 'panel mask loading',
        expect: ['PanelProps.mask', 'Mask', 'Panel'],
        source: 'experiment'
    },
    {
        query: 'loading',
        expect: ['LoadSupport', 'LoadSpec', 'LoadSupport.loadAsync'],
        source: 'experiment'
    },
    {query: 'catchDefault', expect: ['catchDefault', 'Promise.catchDefault'], source: 'experiment'},
    {
        query: 'handleException',
        expect: ['XHApi.handleException', 'ExceptionHandler'],
        source: 'experiment'
    },
    {query: 'linkTo', expect: ['linkTo', 'Promise.linkTo'], source: 'experiment'},
    {query: 'TaskObserver', expect: ['TaskObserver'], source: 'experiment'},

    // Experiment task: persisted grid and panel.
    {query: 'persistWith', expect: ['*.persistWith', 'PersistOptions'], source: 'experiment'},
    {query: 'PanelModel', expect: ['PanelModel'], source: 'experiment'},
    {
        query: 'panel collapsible side',
        expect: ['PanelConfig.side', 'PanelConfig.collapsible', 'PanelModel'],
        source: 'experiment'
    },
    {
        query: 'panel modal',
        expect: ['ModalSupportModel', 'PanelConfig.modalSupport', 'PanelModel.isModal'],
        source: 'experiment'
    },
    {
        query: 'grid persist columns',
        expect: ['GridModelPersistOptions', 'GridConfig.persistWith'],
        source: 'experiment'
    },
    {query: 'PersistOptions', expect: ['PersistOptions'], source: 'experiment'},
    {
        query: 'local storage persistence provider',
        expect: ['LocalStorageProvider', 'PersistenceProvider'],
        source: 'experiment'
    },

    // Experiment task: validated form.
    {query: 'FormModel', expect: ['FormModel'], source: 'experiment'},
    {query: 'required', expect: ['required'], source: 'experiment'},
    {
        query: 'field rules validation',
        expect: ['FieldModel.rules', 'FieldConfig.rules', 'Rule', 'BaseFieldModel.rules'],
        source: 'experiment'
    },
    {
        query: 'validate form',
        expect: ['FormModel.validateAsync', 'FormModel.isValid', 'FormModel'],
        source: 'experiment'
    },
    {query: 'lengthIs', expect: ['lengthIs'], source: 'experiment'},
    {query: 'textInput', expect: ['TextInput', 'textInput'], source: 'experiment'},
    {
        query: 'select input options',
        expect: ['Select', 'select', 'SelectProps.options'],
        source: 'experiment'
    },
    {query: 'dateInput', expect: ['DateInput', 'dateInput'], source: 'experiment'},
    {
        query: 'formField label',
        expect: ['FormFieldProps.label', 'FormField', 'formField'],
        source: 'experiment'
    },
    {query: 'numberInput', expect: ['NumberInput', 'numberInput'], source: 'experiment'},

    // Multi-word queries that must not come back empty. Strict AND matching over name, JSDoc,
    // and member names returns nothing for these; ranked matching must return the obvious hit.
    {query: 'PanelModel persistWith collapsed', expect: ['PanelModel'], source: 'zero-result'},
    {
        query: 'required validator rule constraint',
        expect: ['required', 'Rule', 'Constraint'],
        source: 'zero-result'
    },
    {
        query: 'toolbar onClick button',
        expect: ['Toolbar', 'toolbar', 'Button', 'button', 'ButtonProps.onClick'],
        source: 'zero-result'
    },

    // Most-used classes, configs, and components.
    {query: 'Store', expect: ['Store'], source: 'common'},
    {query: 'StoreRecord raw', expect: ['StoreRecord.raw'], source: 'common'},
    {query: 'HoistModel', expect: ['HoistModel'], source: 'common'},
    {query: 'hoistCmp', expect: ['hoistCmp'], source: 'common'},
    {query: 'XH', expect: ['XH', 'XHApi'], source: 'common'},
    {query: 'TabContainerModel', expect: ['TabContainerModel'], source: 'common'},
    {
        query: 'tab route',
        expect: ['TabContainerConfig.route', 'TabConfig.route', 'TabContainerModel.route'],
        source: 'common'
    },
    {query: 'LocalDate', expect: ['LocalDate'], source: 'common'},
    {query: 'fmtDate', expect: ['fmtDate'], source: 'common'},
    {query: 'Icon', expect: ['Icon'], source: 'common'},
    {query: 'button', expect: ['Button', 'button'], source: 'common'},
    {query: 'panel', expect: ['Panel', 'panel'], source: 'common'},
    {query: 'hbox vbox', expect: ['hbox', 'vbox', 'HBox', 'VBox'], source: 'common'},
    {query: 'managed', expect: ['managed'], source: 'common'},
    {query: 'bindable', expect: ['bindable'], source: 'common'},
    {query: 'Cube', expect: ['Cube'], source: 'common'},
    {query: 'DashContainerModel', expect: ['DashContainerModel'], source: 'common'},
    {query: 'useLocalModel', expect: ['useLocalModel'], source: 'common'},
    {query: 'creates uses', expect: ['creates', 'uses'], source: 'common'},
    {query: 'RecordAction', expect: ['RecordAction', 'RecordActionSpec'], source: 'common'},
    {query: 'sortBy', expect: ['*.sortBy'], source: 'common'},
    {query: 'emptyText', expect: ['GridConfig.emptyText', 'GridModel.emptyText'], source: 'common'},
    {query: 'treeMode', expect: ['GridConfig.treeMode', 'GridModel.treeMode'], source: 'common'},
    {query: 'selModel', expect: ['GridConfig.selModel', 'GridModel.selModel'], source: 'common'},
    {query: 'ViewManagerModel', expect: ['ViewManagerModel'], source: 'common'},
    {
        query: 'doLoadAsync',
        expect: ['LoadSupport.doLoadAsync', 'HoistModel.doLoadAsync', 'Loadable.doLoadAsync'],
        source: 'common'
    },
    {query: 'addReaction', expect: ['HoistBase.addReaction'], source: 'common'},

    // Symbols that must stay re-exported by their package barrel. Each must return itself in the
    // top 3 with a barrel import path, so dropping one of these exports fails the run.
    {query: 'CardModel', expect: ['CardModel'], source: 'barrel'},
    {query: 'BaseOAuthClient', expect: ['BaseOAuthClient'], source: 'barrel'},
    {query: 'DynamicTabSwitcherModel', expect: ['DynamicTabSwitcherModel'], source: 'barrel'},
    {query: 'FilterChooserFieldSpec', expect: ['FilterChooserFieldSpec'], source: 'barrel'},
    {query: 'DashContainerViewModel', expect: ['DashContainerViewModel'], source: 'barrel'},
    {query: 'BaseFilterFieldSpec', expect: ['BaseFilterFieldSpec'], source: 'barrel'},
    {query: 'ChartContextMenuSpec', expect: ['ChartContextMenuSpec'], source: 'barrel'},
    {query: 'WhatsNewButton', expect: ['WhatsNewButton'], source: 'barrel'},
    {query: 'EditorProps', expect: ['EditorProps'], source: 'barrel'},
    {query: 'RestField', expect: ['RestField'], source: 'barrel'},
    {query: 'PageConfig', expect: ['PageConfig'], source: 'barrel'}
];
