package io.xh.hoistdocs

import grails.gorm.transactions.Transactional
import io.xh.hoist.config.ConfigService
import io.xh.hoist.config.ConfigSpec
import io.xh.hoist.log.LogSupport
import io.xh.hoistdocs.security.Auth0Config
import io.xh.hoistdocs.user.User

import static io.xh.hoist.BaseService.parallelInit
import static io.xh.hoist.util.InstanceConfigUtils.getInstanceConfig
import static io.xh.hoist.util.Utils.*

class BootStrap implements LogSupport {

    ConfigService configService

    def init = {
        logInfo("${appName} v${appVersion} ${appBuild != 'UNKNOWN' ? "[build $appBuild] " : ''}${appEnvironment}")

        ensureRequiredConfigsCreated()
        createLocalAdminUserIfNeeded()

        def services = xhServices.findAll {
            it.class.canonicalName.startsWith(this.class.package.name)
        }
        parallelInit(services)
    }

    def destroy = {}

    //------------------------
    // Implementation
    //------------------------
    @Transactional
    private void createLocalAdminUserIfNeeded() {
        String adminUsername = getInstanceConfig('bootstrapAdminUser')
        String adminPassword = getInstanceConfig('bootstrapAdminPassword')
        if (adminUsername && adminPassword) {
            def user = User.findByEmail(adminUsername)
            if (!user) {
                new User(email: adminUsername, password: adminPassword, name: 'Hoist Docs Admin').save(flush: true)
            } else if (!user.checkPassword(adminPassword)) {
                user.password = adminPassword
                user.save(flush: true)
            }
            logInfo('Local admin user available as per instanceConfig', adminUsername)
        }
    }

    private void ensureRequiredConfigsCreated() {
        configService.ensureRequiredConfigsCreated([
            new ConfigSpec(
                name: 'auth0Config',
                valueType: 'json',
                defaultValue: [:],
                typedClass: Auth0Config,
                groupName: 'Auth',
                note: 'OAuth config for the docs viewer, shared with Toolbox at our Auth0 account. \n(https://manage.auth0.com/dashboard/us/xhio/)'
            ),
            new ConfigSpec(
                name: 'mcpConfig',
                valueType: 'json',
                defaultValue: [
                    logQueries: true,
                    anonymousUsername: 'mcp-anonymous'
                ],
                groupName: 'Hoist Docs',
                note: 'MCP endpoint settings. `logQueries` writes query text into track logs (turn off for on-prem installs whose queries may name client code). `anonymousUsername` is the identity tracked for unauthenticated calls.'
            ),
            new ConfigSpec(
                name: 'jsLicenses',
                valueType: 'json',
                defaultValue: [agGrid: null],
                clientVisible: true,
                groupName: 'Hoist Docs',
                note: 'License keys for client-side libraries. The Admin Console grids use AG Grid Enterprise.'
            )
        ])
    }
}
