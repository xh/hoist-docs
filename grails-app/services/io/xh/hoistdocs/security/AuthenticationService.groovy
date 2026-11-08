package io.xh.hoistdocs.security

import grails.compiler.GrailsCompileStatic
import grails.gorm.transactions.ReadOnly
import io.xh.hoist.security.BaseAuthenticationService
import io.xh.hoistdocs.user.User
import io.xh.hoistdocs.user.UserService
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse

import static io.xh.hoist.util.InstanceConfigUtils.getInstanceConfig

/**
 * Authentication for Hoist Docs.
 *
 * The docs viewer and admin console use the same Auth0 OAuth flow as Toolbox: the client sends its
 * ID token as a bearer header, validated here by {@link AuthZeroTokenService}. Set the
 * `oauthProvider` instance config to `NONE` for a local username/password login instead.
 *
 * The `/mcp` endpoint is whitelisted and open to anonymous callers. Per-user MCP auth (MCP OAuth,
 * gateway-supplied identity) is planned - see docs/design.md.
 */
@GrailsCompileStatic
class AuthenticationService extends BaseAuthenticationService {

    AuthZeroTokenService authZeroTokenService
    UserService userService

    private String AUTH_HEADER = 'Authorization'

    AuthenticationService() {
        super()
        whitelistURIs.push('/mcp')
    }

    Map getClientConfig() {
        return useOAuth ?
            [useOAuth: true, *: authZeroTokenService.clientConfig] :
            [useOAuth: false]
    }

    String getOauthProvider() {
        getInstanceConfig('oauthProvider') ?: 'AUTH_ZERO'
    }

    boolean getUseOAuth() {
        oauthProvider != 'NONE'
    }

    /**
     * Read the ID token installed by the client as a bearer header and set the corresponding user,
     * creating one on first login.
     */
    protected boolean completeAuthentication(HttpServletRequest request, HttpServletResponse response) {
        if (!useOAuth) return true

        String token = request.getHeader(AUTH_HEADER)?.replace('Bearer ', '')
        if (!token) {
            logTrace('Unable to validate inbound request - no token presented in header')
            return true
        }

        def tokenResult = authZeroTokenService.validateToken(token)
        if (tokenResult) {
            def user = userService.getOrCreateFromTokenResult(tokenResult)
            setUser(request, user)
            logDebug('User read from token and set on session', [_username: user.username])
        } else {
            logDebug('Invalid token - no user set on session - return 401')
        }
        return true
    }

    /** Interactive password login, for local users only - see `bootstrapAdminPassword`. */
    boolean login(HttpServletRequest request, String username, String password) {
        def user = lookupUser(username, password)
        if (user) {
            setUser(request, user)
            return true
        }
        return false
    }

    boolean logout() {
        return true
    }

    Map getAdminStats() {
        return [
            *: super.getAdminStats(),
            oauthProvider: oauthProvider,
            clientConfig: clientConfig
        ]
    }

    @ReadOnly
    private User lookupUser(String username, String password) {
        def user = User.findByEmailAndEnabled(username, true)
        return user?.checkPassword(password) ? user : null
    }
}
