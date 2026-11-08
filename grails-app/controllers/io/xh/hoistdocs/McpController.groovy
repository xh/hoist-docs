package io.xh.hoistdocs

import io.xh.hoist.security.AccessAll

import static io.xh.hoist.json.JSONParser.parseObject
import static io.xh.hoist.json.JSONSerializer.serialize

/**
 * MCP Streamable HTTP endpoint at `/mcp`: one JSON-RPC message per POST, answered with a JSON
 * response (or 202 for a notification). No sessions and no SSE stream - see {@link McpService}.
 *
 * Open to anonymous callers - the URI is whitelisted in `AuthenticationService`.
 */
@AccessAll
class McpController extends BaseController {

    McpService mcpService

    def index() {
        if (request.method != 'POST') {
            response.setHeader('Allow', 'POST')
            response.status = 405
            render(text: '', contentType: 'text/plain')
            return
        }

        Map msg
        try {
            def parsed = parseObject(request.reader.text)
            msg = parsed instanceof Map ? parsed as Map : null
        } catch (Exception ignored) {
            msg = null
        }
        if (msg == null) {
            renderRpc([jsonrpc: '2.0', id: null, error: [code: -32700, message: 'Parse error - expected a single JSON-RPC object']], 400)
            return
        }

        Map params = (msg.params ?: [:]) as Map,
            meta = (params._meta ?: [:]) as Map,
            client = ((meta.clientInfo ?: params.clientInfo) ?: [:]) as Map
        Map clientInfo = [
            name     : client.name,
            version  : client.version,
            userAgent: request.getHeader('User-Agent')
        ].findAll { it.value }

        def response = mcpService.handle(msg, clientInfo)
        if (response == null) {
            this.response.status = 202
            render(text: '', contentType: 'text/plain')
        } else {
            renderRpc(response, 200)
        }
    }

    private void renderRpc(Map body, int status) {
        response.status = status
        render(text: serialize(body), contentType: 'application/json', encoding: 'UTF-8')
    }
}
