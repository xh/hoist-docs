/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * hoist-chat-kit golden set. Queries are the kind an agent sends while adding a chat or assistant
 * to a Hoist app; expectations come from the kit's doc outlines and API, not from search output.
 * Source tags: `task` (a how-to while building a feature), `topic` (a concept lookup), `quick-ref`
 * (a lookup the docs index or a README answers as a whole), `common` (an API name), `member` (a
 * method or property an agent half-remembers), `barrel` (a less common public export).
 */
import {T, type DocCase, type SymbolCase} from './types.ts';

export const CHAT_KIT_DOC_CASES: DocCase[] = [
    // Getting started.
    {
        query: 'add a chat panel to my app',
        expect: [
            T('README.md', 'Quick Start: Add a Chat to an App'),
            T('desktop/cmp/chat/README.md', 'Configuration Pattern')
        ],
        source: 'task'
    },
    {
        query: 'install chat kit peer dependencies',
        expect: [T('README.md', 'Installation')],
        source: 'task'
    },
    {query: 'chat kit quick reference by task', expect: [T('docs/README.md')], source: 'quick-ref'},
    {
        query: 'desktop only mobile components',
        expect: [T('docs/architecture.md', 'Platform Split')],
        source: 'topic'
    },

    // Architecture.
    {
        query: 'flow of one turn',
        expect: [
            T('docs/architecture.md', 'The Flow of One Turn'),
            T('core/README.md', 'Architecture > Turns and steps')
        ],
        source: 'topic'
    },
    {
        query: 'historyMode server mode conversation',
        expect: [
            T('docs/architecture.md', 'Two Conversation Shapes'),
            T('core/README.md', 'Common Usage Patterns > Run a server-owned conversation')
        ],
        source: 'topic'
    },
    {
        query: 'immutable messages render performance',
        expect: [T('docs/architecture.md', 'Immutable Messages and Render Performance')],
        source: 'topic'
    },

    // Transports and backends.
    {
        query: 'relay requests through Hoist server secret API key',
        expect: [
            T('transport/README.md', 'Common Usage Patterns > Choose where requests go'),
            T('transport/README.md', 'Common Usage Patterns > Relay Claude through a Hoist server'),
            T(
                'transport/README.md',
                'Common Pitfalls > Leaving the API key or model choice to the client'
            )
        ],
        source: 'task'
    },
    {
        query: 'stream replies from OpenAI-compatible endpoint',
        expect: [
            T('transport/README.md', 'Common Usage Patterns > Bring your own LLM'),
            T('docs/protocols.md', 'OpenAI')
        ],
        source: 'task'
    },
    {
        query: 'Claude system prompt prompt caching',
        expect: [
            T('transport/README.md', 'Common Usage Patterns > Relay Claude through a Hoist server'),
            T('docs/protocols.md', 'Anthropic Messages API')
        ],
        source: 'task'
    },
    {
        query: 'Grails controller stream model reply',
        expect: [T('transport/README.md', 'Hoist Server Example')],
        source: 'task'
    },
    {
        query: 'renderNDJSON',
        expect: [
            T('transport/README.md', 'Hoist Server Example > Why not `renderNDJSON`'),
            T('transport/README.md', 'Common Pitfalls > Sending through `renderNDJSON`')
        ],
        source: 'common'
    },
    {
        query: 'connect to AG-UI agent server',
        expect: [
            T('transport/README.md', 'Common Usage Patterns > Connect to an AG-UI agent server')
        ],
        source: 'task'
    },
    {
        query: 'scripted transport demo without backend',
        expect: [T('transport/README.md', 'Common Usage Patterns > Script a demo or a test')],
        source: 'task'
    },
    {
        query: 'write a custom codec',
        expect: [
            T('transport/README.md', 'Extension Points > Write a custom codec'),
            T('transport/README.md', 'Extension Points > Write a custom transport')
        ],
        source: 'task'
    },
    {
        query: 'xh.chat custom events',
        expect: [
            T('transport/README.md', 'Properties/API Reference > Kit events: `xh.chat.*`'),
            T('transport/README.md', 'Properties/API Reference > ChatEvent')
        ],
        source: 'common'
    },

    // Protocols.
    {
        query: 'AG-UI support by spec area',
        expect: [T('docs/protocols.md', 'AG-UI > Support by spec area')],
        source: 'topic'
    },
    {
        query: 'Vercel AI SDK UIMessage tool states',
        expect: [T('docs/protocols.md', 'Vercel AI SDK Vocabulary')],
        source: 'topic'
    },
    {
        query: 'A2UI OpenUI adapter',
        expect: [
            T('genui/README.md', "Common Usage Patterns > Adapt a protocol's UI payload"),
            T('docs/protocols.md', 'Generative UI > Protocol adapters'),
            T('docs/protocols.md', 'Generative UI > A2UI')
        ],
        source: 'topic'
    },

    // Generative UI.
    {
        query: 'render a component in a reply',
        expect: [
            T('genui/README.md', 'Overview'),
            T('genui/README.md', 'Common Usage Patterns > Write a component spec'),
            T('docs/protocols.md', 'Generative UI > The catalog: components as tools')
        ],
        source: 'task'
    },
    {
        query: 'show grids and charts by reference',
        expect: [
            T('genui/README.md', 'Common Usage Patterns > Show data by reference'),
            T('desktop/cmp/genui/README.md', 'Common Usage Patterns > Show a table by reference')
        ],
        source: 'task'
    },
    {
        query: 'show_chart chatUiChartSpec Highcharts',
        expect: [T('desktop/cmp/genui/README.md', 'Common Usage Patterns > Show a chart')],
        source: 'task'
    },
    {
        query: 'export catalog for server tool loop',
        expect: [T('genui/README.md', 'Common Usage Patterns > Export the catalog for a server')],
        source: 'task'
    },
    {
        query: 'generative UI safety urlAllowList',
        expect: [
            T('genui/README.md', 'Architecture > Safety model'),
            T('genui/README.md', 'Common Usage Patterns > Run actions')
        ],
        source: 'topic'
    },

    // Core: tools, turns and feedback.
    {
        query: 'approve tool call before it runs',
        expect: [
            T('core/README.md', 'Common Usage Patterns > Ask for approval before a tool runs'),
            T('desktop/cmp/chat/README.md', 'Common Usage Patterns > Approve a tool call')
        ],
        source: 'task'
    },
    {
        query: 'AG-UI interrupts answer agent questions',
        expect: [
            T('core/README.md', "Common Usage Patterns > Answer an agent's questions"),
            T('desktop/cmp/chat/README.md', "Common Usage Patterns > Answer an agent's questions")
        ],
        source: 'task'
    },
    {
        query: 'save and restore a conversation',
        expect: [T('core/README.md', 'Common Usage Patterns > Persist and restore a conversation')],
        source: 'task'
    },
    {
        query: 'handle errors finish reasons',
        expect: [T('core/README.md', 'Common Usage Patterns > Handle errors and finish reasons')],
        source: 'task'
    },
    {
        query: 'stop or detach a turn',
        expect: [T('core/README.md', 'Common Usage Patterns > Stop or detach a turn')],
        source: 'task'
    },
    {
        query: 'send live context every step',
        expect: [T('core/README.md', 'Common Usage Patterns > Send live context with every step')],
        source: 'task'
    },
    {
        query: 'thumbs up rating feedback on replies',
        expect: [
            T('core/README.md', 'Common Usage Patterns > Rate a reply'),
            T('desktop/cmp/chat/README.md', 'Common Usage Patterns > Collect feedback')
        ],
        source: 'task'
    },

    // Threads.
    {
        query: 'persist threads ChatThreadStore',
        expect: [
            T('threads/README.md', 'Configuration Pattern'),
            T('threads/README.md', 'Properties/API Reference > ChatThreadStore')
        ],
        source: 'task'
    },
    {
        query: 'rebuild history from stored AG-UI events',
        expect: [T('threads/README.md', 'Common Usage Patterns > Load history from stored events')],
        source: 'task'
    },
    {
        query: 'background turns other thread',
        expect: [T('threads/README.md', 'Common Usage Patterns > Let turns run in the background')],
        source: 'task'
    },
    {
        query: 'link to a thread route parameter',
        expect: [T('threads/README.md', 'Common Usage Patterns > Link to a thread')],
        source: 'task'
    },
    {
        query: 'thread list sidebar rename delete',
        expect: [
            T('desktop/cmp/threads/README.md', 'Overview'),
            T('desktop/cmp/threads/README.md', 'Configuration Pattern'),
            T('threads/README.md', 'Common Usage Patterns > Rename and delete')
        ],
        source: 'task'
    },

    // Desktop components.
    {
        query: 'full page chat workspace sidebar',
        expect: [
            T('desktop/cmp/workspace/README.md', 'Overview'),
            T('desktop/cmp/workspace/README.md', 'Configuration Pattern')
        ],
        source: 'task'
    },
    {
        query: 'open cited documents side panel',
        expect: [
            T(
                'desktop/cmp/workspace/README.md',
                'Common Usage Patterns > Open cited documents in the side panel'
            ),
            T('core/README.md', 'Common Usage Patterns > Side panel')
        ],
        source: 'task'
    },
    {
        query: 'customize composer send button',
        expect: [T('desktop/cmp/chat/README.md', 'Common Usage Patterns > Customize the composer')],
        source: 'task'
    },
    {
        query: 'chat theming CSS variables',
        expect: [T('desktop/cmp/chat/README.md', 'Theming')],
        source: 'topic'
    },

    // Markdown.
    {
        query: 'render streaming markdown',
        expect: [
            T('cmp/markdown/README.md', 'Common Usage Patterns > Render streaming text'),
            T('cmp/markdown/README.md', 'Overview')
        ],
        source: 'task'
    },
    {
        query: 'KaTeX math markdown plugins',
        expect: [
            T('cmp/markdown/README.md', 'Common Usage Patterns > Add markdown plugins'),
            T(
                'desktop/cmp/chat/README.md',
                'Common Usage Patterns > Render math and other markdown extensions'
            )
        ],
        source: 'task'
    },
    {
        query: 'allow images in replies',
        expect: [
            T(
                'cmp/markdown/README.md',
                'Common Usage Patterns > Allow images from a trusted source'
            ),
            T('desktop/cmp/chat/README.md', 'Common Usage Patterns > Allow images')
        ],
        source: 'task'
    },

    // Requesting changes.
    {
        query: 'request a feature from kit maintainers',
        expect: [
            T('docs/requesting-changes.md', 'Write the Request'),
            T('docs/requesting-changes.md', 'Template')
        ],
        source: 'task'
    },
    {
        query: 'report a bug in chat kit',
        expect: [T('docs/requesting-changes.md', 'Write the Request > Report a Bug')],
        source: 'task'
    },

    // Upgrading.
    {
        query: 'upgrade chat kit to v2',
        expect: [
            T('docs/upgrade-notes/v2-upgrade-notes.md', 'Overview'),
            T('docs/upgrade-notes/v2-upgrade-notes.md', 'Upgrade Steps')
        ],
        source: 'task'
    },
    {
        query: 'showStopHint busyIcon removed',
        expect: [
            T(
                'docs/upgrade-notes/v2-upgrade-notes.md',
                'Upgrade Steps > 1. Remove the Busy-Line Settings'
            )
        ],
        source: 'common'
    },
    {
        query: 'status region CSS tests v2',
        expect: [
            T(
                'docs/upgrade-notes/v2-upgrade-notes.md',
                'Upgrade Steps > 2. Check Status Region CSS and Tests'
            )
        ],
        source: 'task'
    }
];

export const CHAT_KIT_SYMBOL_CASES: SymbolCase[] = [
    // Common class and component names.
    {query: 'ChatModel', expect: ['ChatModel'], source: 'common'},
    {query: 'chatPanel', expect: ['ChatPanel'], source: 'common'},
    {query: 'ChatThreadsModel', expect: ['ChatThreadsModel'], source: 'common'},
    {query: 'ChatUiCatalog', expect: ['ChatUiCatalog'], source: 'common'},
    {query: 'HoistChatTransport', expect: ['HoistChatTransport'], source: 'common'},
    {query: 'SseChatTransport', expect: ['SseChatTransport'], source: 'common'},
    {query: 'chatMarkdown', expect: ['ChatMarkdown'], source: 'common'},
    {query: 'chatWorkspace', expect: ['ChatWorkspace'], source: 'common'},
    {query: 'ChatThreadList', expect: ['ChatThreadList'], source: 'common'},
    {query: 'ChatComposerModel', expect: ['ChatComposerModel'], source: 'common'},
    {query: 'AnthropicCodec', expect: ['AnthropicCodec'], source: 'common'},
    {query: 'ChatToolSpec', expect: ['ChatToolSpec'], source: 'common'},
    {query: 'ChatEvent', expect: ['ChatEvent'], source: 'common'},
    {query: 'ChatModelConfig', expect: ['ChatModelConfig'], source: 'common'},

    // Members an agent half-remembers.
    {query: 'sendAsync', expect: ['ChatModel.sendAsync'], source: 'member'},
    {query: 'regenerateAsync', expect: ['ChatModel.regenerateAsync'], source: 'member'},
    {query: 'approveToolCallAsync', expect: ['ChatModel.approveToolCallAsync'], source: 'member'},
    {query: 'getMessageSpecs', expect: ['ChatModel.getMessageSpecs'], source: 'member'},
    {
        query: 'submitFeedbackAsync',
        expect: ['ChatModel.submitFeedbackAsync', 'ChatThreadStore.submitFeedbackAsync'],
        source: 'member'
    },
    {query: 'isBusy', expect: ['ChatModel.isBusy'], source: 'member'},
    {query: 'toPrompt', expect: ['ChatUiCatalog.toPrompt'], source: 'member'},
    {query: 'createDataRenderers', expect: ['ChatUiCatalog.createDataRenderers'], source: 'member'},
    {query: 'selectThreadAsync', expect: ['ChatThreadsModel.selectThreadAsync'], source: 'member'},
    {
        query: 'renameThreadAsync',
        expect: ['ChatThreadsModel.renameThreadAsync', 'ChatThreadStore.renameThreadAsync'],
        source: 'member'
    },
    {query: 'listThreadsAsync', expect: ['ChatThreadStore.listThreadsAsync'], source: 'member'},
    {query: 'clearLocalData', expect: ['ChatKit.clearLocalData'], source: 'member'},
    {query: 'encodeRequest', expect: ['ChatCodec.encodeRequest'], source: 'member'},

    // Task phrasings.
    {
        query: 'streaming transport',
        expect: ['SseChatTransport', 'HttpChatTransport', 'HoistChatTransport', 'ChatTransport'],
        source: 'task'
    },
    {query: 'markdown renderer', expect: ['ChatMarkdown'], source: 'task'},
    {query: 'OpenAI chat completions codec', expect: ['ChatCompletionsCodec'], source: 'task'},
    {query: 'scripted transport for tests', expect: ['ScriptedChatTransport'], source: 'task'},
    {query: 'group threads by recency', expect: ['groupThreadsByRecency'], source: 'task'},
    {query: 'replay stored events', expect: ['replayChatEvents'], source: 'task'},
    {
        query: 'fold events without ChatModel',
        expect: ['ChatStreamReducer', 'createChatRunRequest'],
        source: 'task'
    },
    {query: 'grid catalog component', expect: ['chatUiGridSpec', 'ChatUiGrid'], source: 'task'},
    {query: 'feedback thumbs controls', expect: ['ChatFeedbackControls'], source: 'task'},
    {query: 'tool result', expect: ['chatToolResult', 'ChatToolResult'], source: 'task'},

    // Less common barrel exports.
    {query: 'ChatArtifactRegistry', expect: ['ChatArtifactRegistry'], source: 'barrel'},
    {query: 'ChatDataHandle', expect: ['ChatDataHandle'], source: 'barrel'},
    {query: 'ChatUiDocument', expect: ['ChatUiDocument'], source: 'barrel'},
    {query: 'ChatComposerPill', expect: ['ChatComposerPill'], source: 'barrel'},
    {query: 'ChatSidePanelModel', expect: ['ChatSidePanelModel'], source: 'barrel'},
    {query: 'AgUiCodec', expect: ['AgUiCodec'], source: 'barrel'},
    {query: 'ChatRunError', expect: ['ChatRunError'], source: 'barrel'},
    {query: 'ChatMarkdownPlugins', expect: ['ChatMarkdownPlugins'], source: 'barrel'},
    {query: 'fmtChatUiNumber', expect: ['fmtChatUiNumber'], source: 'barrel'}
];
