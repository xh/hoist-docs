import type {CallContextLike, IdentityInfo, PlainObject} from '@xh/hoist/core';
import {HoistAuthModel, managed, XH} from '@xh/hoist/core';
import type {AuthZeroClientConfig} from '@xh/hoist/security/authzero';
import {AuthZeroClient} from '@xh/hoist/security/authzero';

/**
 * Authentication for the admin console - the same Auth0 OAuth flow as Toolbox,
 * with a username/password fallback when the server's `oauthProvider` is `NONE`.
 */
export class AuthModel extends HoistAuthModel {
    @managed
    client: AuthZeroClient;

    override async completeAuthAsync(ctx: CallContextLike): Promise<IdentityInfo> {
        this.setMaskMsg('Authenticating...');

        const config: PlainObject = await this.loadConfigAsync();
        if (!config.useOAuth) {
            XH.appSpec.enableLoginForm = true;
            const ret = await this.getAuthStatusFromServerAsync(ctx);
            this.setMaskMsg(null);
            return ret;
        }

        this.client = new AuthZeroClient({
            idScopes: ['profile'],
            ...(config as AuthZeroClientConfig)
        });
        await this.client.initAsync(ctx);

        // Send the ID token (a JWT) as a bearer header on relative requests back to this server,
        // where `AuthenticationService.completeAuthentication()` validates it.
        XH.fetchService.addDefaultHeaders(async opts => {
            if (opts.url.startsWith('http')) return null;
            try {
                const idToken = await this.client.getIdTokenAsync();
                return {Authorization: `Bearer ${idToken.value}`};
            } catch (e: any) {
                if (e.name == 'Auth Expired') {
                    XH.suspendApp({
                        reason: 'AUTH_EXPIRED',
                        message: 'Your authentication has expired.',
                        exception: e
                    });
                } else {
                    this.logDebug('Exception getting id token', e);
                    throw e;
                }
            }
        });

        const ret = await this.getAuthStatusFromServerAsync(ctx);
        this.setMaskMsg(null);
        return ret;
    }

    override async logoutAsync() {
        await super.logoutAsync();
        await this.client?.logoutAsync();
    }

    private setMaskMsg(msg: string) {
        XH.appContainerModel.initializingLoadMaskMessage = msg;
    }
}
