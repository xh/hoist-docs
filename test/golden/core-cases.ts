/**
 * hoist-core golden set. Queries are the kind an agent sends while writing Hoist server code;
 * expectations come from hoist-core's doc outlines and API, not from search output. Source tags:
 * `task` (a how-to while building a feature), `topic` (a concept lookup), `common` (an API name),
 * `member` (a method or property an agent half-remembers), `zero-result` (a multi-word query that
 * must not come back empty).
 *
 * hoist-core's index has no `memberNames` on symbols and member-indexes only some classes, so for
 * members of other classes (`TrackService.track`) the owning class also counts as a hit: it is one
 * hoist-get-members call away.
 */
import {T, type DocCase, type SymbolCase} from './types.ts';

export const CORE_DOC_CASES: DocCase[] = [
    // Services, lifecycle and resources.
    {
        query: 'service lifecycle init',
        expect: [T('docs/base-classes.md', 'BaseService > Lifecycle')],
        source: 'topic'
    },
    {
        query: 'createCache createTimer resource factories',
        expect: [
            T('docs/base-classes.md', 'BaseService > Resource Factories'),
            T(
                'docs/coding-conventions.md',
                'Services and Lifecycle > Use Managed Resource Factories'
            )
        ],
        source: 'task'
    },
    {
        query: 'clearCaches',
        expect: [
            T('docs/base-classes.md', 'Common Pitfalls > Forgetting to call super.clearCaches()'),
            T('docs/caching.md', 'Clearing and Invalidation'),
            T('docs/coding-conventions.md', 'Services and Lifecycle > clearCaches() Discipline')
        ],
        source: 'common'
    },
    {
        query: 'RestController CRUD endpoints',
        expect: [T('docs/base-classes.md', 'RestController')],
        source: 'task'
    },
    {
        query: 'how requests are processed filter interceptor',
        expect: [
            T('docs/request-flow.md', 'Architecture > Request Pipeline'),
            T('docs/request-flow.md', 'Key Classes > HoistInterceptor'),
            T('docs/request-flow.md', 'Key Classes > HoistFilter')
        ],
        source: 'topic'
    },
    {
        query: 'required app services UserService RoleService',
        expect: [
            T(
                'docs/application-structure.md',
                'Server Side (grails-app/) > Required App-Provided Services'
            ),
            T('docs/authentication.md', 'Application Implementation')
        ],
        source: 'task'
    },

    // Caching and clustering.
    {
        query: 'cache expiration',
        expect: [T('docs/caching.md', 'Cache > Expiration and Culling')],
        source: 'task'
    },
    {
        query: 'replicated cache across cluster',
        expect: [
            T('docs/caching.md', 'Replication'),
            T('docs/clustering.md', 'Key Classes > Distributed Data Structures'),
            T('docs/coding-conventions.md', 'Clustering and Caching > replicate: true')
        ],
        source: 'task'
    },
    {
        query: 'CachedValue vs Cache',
        expect: [
            T('docs/caching.md', 'CachedValue > Differences from Cache'),
            T('docs/caching.md', 'Choosing a Structure')
        ],
        source: 'topic'
    },
    {
        query: 'wait for cache value ensureAvailable',
        expect: [T('docs/caching.md', 'Waiting for Values')],
        source: 'task'
    },
    {
        query: 'cache onChange handler',
        expect: [T('docs/caching.md', 'Change Handlers')],
        source: 'task'
    },
    {
        query: 'timer primaryOnly',
        expect: [
            T('docs/clustering.md', 'Common Patterns > Primary-only Data Refresh'),
            T('docs/clustering.md', 'Common Pitfalls > Forgetting primaryOnly on scheduled tasks'),
            T('docs/coding-conventions.md', 'Clustering and Caching > primaryOnly: true'),
            T('docs/caching.md', 'Common Patterns > Timer-driven Cache Refresh')
        ],
        source: 'task'
    },
    {
        query: 'primary instance',
        expect: [T('docs/clustering.md', 'Architecture > Primary Instance')],
        source: 'topic'
    },
    {
        query: 'hazelcast network configuration',
        expect: [T('docs/clustering.md', 'Configuration > Hazelcast Network Configuration')],
        source: 'task'
    },
    {
        query: 'publish topic cluster event',
        expect: [
            T('docs/clustering.md', 'Key Classes > Pub/Sub via Topics'),
            T('docs/clustering.md', 'Common Patterns > Cluster-wide Event Broadcasting')
        ],
        source: 'task'
    },

    // Security.
    {
        query: 'access annotation controller',
        expect: [
            T('docs/authorization.md', 'Key Classes > Access Annotations'),
            T('docs/request-flow.md', 'Common Pitfalls > Missing access annotations'),
            T(
                'docs/coding-conventions.md',
                'Controllers and Security > Mandatory Access Annotations'
            )
        ],
        source: 'task'
    },
    {
        query: 'check user role in service',
        expect: [T('docs/authorization.md', 'Common Patterns > Checking Roles in Service Code')],
        source: 'task'
    },
    {
        query: 'custom role service',
        expect: [T('docs/authorization.md', 'Application Implementation > Custom RoleService')],
        source: 'task'
    },
    {
        query: 'implement authentication service',
        expect: [
            T('docs/authentication.md', 'Key Classes > BaseAuthenticationService'),
            T('docs/authentication.md', 'Application Implementation')
        ],
        source: 'task'
    },
    {
        query: 'impersonation',
        expect: [T('docs/authentication.md', 'Key Classes > Impersonation')],
        source: 'topic'
    },
    {
        query: 'LDAP group lookup',
        expect: [
            T('docs/directory-services.md', 'Configuration > LDAP'),
            T('docs/directory-services.md', 'Direct Query APIs')
        ],
        source: 'task'
    },
    {
        query: 'Entra ID configuration',
        expect: [T('docs/directory-services.md', 'Configuration > Entra ID')],
        source: 'task'
    },
    {
        query: 'json blob access control',
        expect: [T('docs/jsonblob.md', 'Access Control')],
        source: 'topic'
    },

    // Configuration and preferences.
    {
        query: 'soft config naming',
        expect: [T('docs/configuration.md', 'Soft Configuration > Naming Conventions')],
        source: 'topic'
    },
    {
        query: 'instance config environment variables',
        expect: [
            T('docs/configuration.md', 'Instance Configuration > Environment Variables'),
            T('docs/coding-conventions.md', 'Naming > Instance Config Environment Variables')
        ],
        source: 'task'
    },
    {
        query: 'configService getString',
        expect: [
            T('docs/configuration.md', 'Soft Configuration > Key Classes'),
            T('docs/configuration.md', 'Soft Configuration > Common Patterns'),
            T(
                'docs/coding-conventions.md',
                'Services and Lifecycle > Use configService Typed Getters'
            )
        ],
        source: 'common'
    },
    {
        query: 'user preferences',
        expect: [
            T('docs/preferences.md', 'Overview'),
            T('docs/preferences.md', 'Key Classes > PrefService')
        ],
        source: 'topic'
    },

    // JSON, HTTP, email, websockets.
    {
        query: 'renderJSON parseRequestJSON',
        expect: [
            T('docs/json-handling.md', 'Key Classes > Controller Methods'),
            T(
                'docs/coding-conventions.md',
                'Controllers and Security > renderJSON and parseRequestJSON'
            )
        ],
        source: 'common'
    },
    {
        query: 'implement formatForJSON',
        expect: [
            T('docs/json-handling.md', 'Common Patterns > Implementing JSONFormat'),
            T('docs/gorm-domain-objects.md', 'Common Patterns > formatForJSON()'),
            T('docs/gorm-domain-objects.md', 'Domain Class Anatomy > JSONFormat Implementation')
        ],
        source: 'task'
    },
    {
        query: 'JSONClient post json body',
        expect: [T('docs/http-client.md', 'Common Patterns > POST with JSON Body')],
        source: 'task'
    },
    {
        query: 'proxy service external api',
        expect: [
            T('docs/http-client.md', 'Key Classes > BaseProxyService'),
            T('docs/http-client.md', 'Common Patterns > Minimal Proxy Service')
        ],
        source: 'task'
    },
    {
        query: 'http client timeout',
        expect: [T('docs/http-client.md', 'Common Patterns > Configuring a Client with Timeouts')],
        source: 'task'
    },
    {
        query: 'send email attachment',
        expect: [T('docs/email.md', 'Common Patterns > Sending Email with Attachments')],
        source: 'task'
    },
    {
        query: 'email override dev',
        expect: [
            T('docs/email.md', 'Configuration > Recommended Non-Production Setup'),
            T('docs/email.md', 'Common Pitfalls > Relying on Filter Instead of Override'),
            T('docs/coding-conventions.md', 'HTTP, Email, and Background Work > xhEmailOverride')
        ],
        source: 'task'
    },
    {
        query: 'push websocket message to clients',
        expect: [
            T('docs/websocket.md', 'Common Patterns > Broadcasting to all connected clients'),
            T('docs/websocket.md', 'Key Classes > WebSocketService')
        ],
        source: 'task'
    },

    // Errors, logging, tracking, observability.
    {
        query: 'throw user facing error',
        expect: [
            T('docs/exception-handling.md', 'Common Patterns > Throwing Routine Errors'),
            T('docs/coding-conventions.md', 'Logging and Exceptions > RoutineRuntimeException')
        ],
        source: 'task'
    },
    {
        query: 'NotFoundException',
        expect: [
            T('docs/exception-handling.md', 'Common Patterns > Throwing NotFoundException'),
            T('docs/exception-handling.md', 'Common Pitfalls > Assuming NotFoundException')
        ],
        source: 'common'
    },
    {
        query: 'exception http status code',
        expect: [
            T('docs/exception-handling.md', 'HTTP Status Mapping'),
            T('docs/exception-handling.md', 'Key Classes > HttpException')
        ],
        source: 'topic'
    },
    {
        query: 'withInfo timed logging',
        expect: [
            T('docs/logging.md', 'Common Patterns > Timed execution blocks'),
            T('docs/coding-conventions.md', 'Logging and Exceptions > Time Blocks with withInfo')
        ],
        source: 'task'
    },
    {
        query: 'change log level at runtime',
        expect: [
            T('docs/logging.md', 'Configuration > Dynamic Log Level Changes'),
            T('docs/logging.md', 'Key Classes > LogLevelService')
        ],
        source: 'task'
    },
    {
        query: 'track activity server side',
        expect: [
            T('docs/activity-tracking.md', 'Common Patterns > Server-side Action Tracking'),
            T('docs/activity-tracking.md', 'Key Classes > TrackService')
        ],
        source: 'task'
    },
    {
        query: 'define a status monitor',
        expect: [
            T('docs/monitoring.md', 'Application Implementation'),
            T('docs/monitoring.md', 'Common Patterns > Pattern 1')
        ],
        source: 'task'
    },
    {
        query: 'prometheus metrics export',
        expect: [T('docs/metrics.md', 'Export Registries > Prometheus')],
        source: 'task'
    },
    {
        query: 'register custom metric counter',
        expect: [T('docs/metrics.md', 'MetricsService > Registry and meter registration')],
        source: 'task'
    },
    {
        query: 'tracing withSpan',
        expect: [T('docs/tracing.md', 'TraceService > withSpan')],
        source: 'common'
    },

    // GORM, testing, structure.
    {
        query: 'N+1 query',
        expect: [
            T('docs/gorm-domain-objects.md', 'The N+1 Query Problem'),
            T('docs/gorm-domain-objects.md', 'Common Pitfalls > N+1 queries in loops'),
            T('docs/coding-conventions.md', 'GORM and Data Access > Avoid N+1 Queries')
        ],
        source: 'topic'
    },
    {
        query: 'transactional readonly',
        expect: [
            T('docs/gorm-domain-objects.md', 'Transaction Management'),
            T('docs/coding-conventions.md', 'GORM and Data Access > @ReadOnly on Query Methods'),
            T('docs/gorm-domain-objects.md', 'Common Pitfalls > Missing @Transactional')
        ],
        source: 'task'
    },
    {
        query: 'hibernate second level cache',
        expect: [T('docs/gorm-domain-objects.md', 'Second-Level Cache')],
        source: 'topic'
    },
    {
        query: 'write spock test for service',
        expect: [
            T(
                'docs/testing.md',
                'Testing Hoist Applications > Writing a service or controller spec'
            )
        ],
        source: 'task'
    },
    {
        query: 'local development hot reload',
        expect: [T('docs/application-structure.md', 'Local Development > Server-Side Hot Reload')],
        source: 'task'
    }
];

export const CORE_SYMBOL_CASES: SymbolCase[] = [
    // Common class names.
    {query: 'BaseService', expect: ['BaseService'], source: 'common'},
    {query: 'BaseController', expect: ['BaseController'], source: 'common'},
    {query: 'RestController', expect: ['RestController'], source: 'common'},
    {query: 'Cache', expect: ['Cache'], source: 'common'},
    {query: 'CachedValue', expect: ['CachedValue'], source: 'common'},
    {query: 'Timer', expect: ['Timer'], source: 'common'},
    {query: 'ConfigService', expect: ['ConfigService'], source: 'common'},
    {query: 'PrefService', expect: ['PrefService'], source: 'common'},
    {query: 'JSONClient', expect: ['JSONClient'], source: 'common'},
    {query: 'ClusterService', expect: ['ClusterService'], source: 'common'},
    {query: 'TrackService', expect: ['TrackService'], source: 'common'},
    {query: 'JsonBlobService', expect: ['JsonBlobService'], source: 'common'},
    {query: 'WebSocketService', expect: ['WebSocketService'], source: 'common'},
    {query: 'EmailService', expect: ['EmailService'], source: 'common'},
    {query: 'IdentityService', expect: ['IdentityService'], source: 'common'},
    {query: 'TraceService', expect: ['TraceService'], source: 'common'},
    {query: 'MetricsService', expect: ['MetricsService'], source: 'common'},
    {query: 'RoutineRuntimeException', expect: ['RoutineRuntimeException'], source: 'common'},
    {query: 'NotFoundException', expect: ['NotFoundException'], source: 'common'},
    {query: 'HoistUser', expect: ['HoistUser'], source: 'common'},
    {query: 'AccessRequiresRole', expect: ['AccessRequiresRole'], source: 'common'},
    {query: 'JSONFormat', expect: ['JSONFormat'], source: 'common'},
    {query: 'LogSupport', expect: ['LogSupport'], source: 'common'},
    {query: 'MonitorResult', expect: ['MonitorResult'], source: 'common'},
    {query: 'BaseProxyService', expect: ['BaseProxyService'], source: 'common'},

    // Members an agent half-remembers.
    {query: 'createCache', expect: ['BaseService.createCache'], source: 'member'},
    {query: 'createTimer', expect: ['BaseService.createTimer'], source: 'member'},
    {query: 'createCachedValue', expect: ['BaseService.createCachedValue'], source: 'member'},
    {query: 'renderJSON', expect: ['BaseController.renderJSON'], source: 'member'},
    {query: 'parseRequestJSON', expect: ['BaseController.parseRequestJSON'], source: 'member'},
    {
        query: 'getOrCreate',
        expect: ['Cache.getOrCreate', 'CachedValue.getOrCreate'],
        source: 'member'
    },
    {query: 'ensureAvailable', expect: ['*.ensureAvailable'], source: 'member'},
    {query: 'withInfo', expect: ['LogSupport.withInfo'], source: 'member'},
    {query: 'primaryOnly', expect: ['Timer.primaryOnly'], source: 'member'},
    {query: 'executeAsMap', expect: ['JSONClient.executeAsMap'], source: 'member'},
    {
        query: 'isPrimary',
        expect: ['BaseService.getIsPrimary', 'ClusterService.getIsPrimary'],
        source: 'member'
    },
    {query: 'hasRole', expect: ['HoistUser.hasRole'], source: 'member'},
    // Exact member names on classes the index does not member-index yet. These miss until
    // hoist-core's index builder covers every class's members; no class fallback here.
    {query: 'pushToAllChannels', expect: ['WebSocketService.pushToAllChannels'], source: 'member'},
    {query: 'sendEmail', expect: ['EmailService.sendEmail'], source: 'member'},
    {query: 'withSpan', expect: ['TraceService.withSpan'], source: 'member'},

    // Multi-word concept queries.
    {query: 'replicated map', expect: ['BaseService.createReplicatedMap'], source: 'zero-result'},
    {query: 'subscribe to topic', expect: ['BaseService.subscribeToTopic'], source: 'zero-result'},
    {
        query: 'push to all channels',
        expect: ['WebSocketService.pushToAllChannels', 'WebSocketService'],
        source: 'zero-result'
    },
    {
        query: 'send email',
        expect: ['EmailService.sendEmail', 'EmailService'],
        source: 'zero-result'
    },
    {
        query: 'track activity',
        expect: ['TrackService.track', 'TrackService'],
        source: 'zero-result'
    },
    {
        query: 'tracing span',
        expect: ['TraceService.withSpan', 'TraceService', 'SpanRef'],
        source: 'zero-result'
    },
    {
        query: 'impersonate user',
        expect: ['IdentityService.impersonate', 'IdentityService'],
        source: 'zero-result'
    },
    {
        query: 'access annotation',
        expect: [
            'Access',
            'AccessAll',
            'AccessRequiresRole',
            'AccessRequiresAnyRole',
            'AccessRequiresAllRoles'
        ],
        source: 'zero-result'
    },
    {
        query: 'http exception',
        expect: ['HttpException', 'ExternalHttpException'],
        source: 'zero-result'
    },
    {query: 'json parse', expect: ['JSONParser'], source: 'zero-result'},
    {query: 'json serializer', expect: ['JSONSerializer'], source: 'zero-result'},
    {
        query: 'user preference',
        expect: ['PrefService', 'UserPreference', 'Preference'],
        source: 'zero-result'
    },
    {query: 'soft config', expect: ['ConfigService', 'AppConfig'], source: 'zero-result'},
    {query: 'log level', expect: ['LogLevel', 'LogLevelService'], source: 'zero-result'},
    {
        query: 'monitor status',
        expect: ['MonitorStatus', 'MonitorResult.status'],
        source: 'zero-result'
    },
    {query: 'instance config', expect: ['InstanceConfigUtils'], source: 'zero-result'},
    {
        query: 'cluster task',
        expect: [
            'ClusterTask',
            'ClusterService.submitToInstance',
            'ClusterService.submitToAllInstances'
        ],
        source: 'zero-result'
    },
    {query: 'spock test spec', expect: ['HoistSpec'], source: 'zero-result'},
    {query: 'field filter', expect: ['FieldFilter'], source: 'zero-result'}
];
