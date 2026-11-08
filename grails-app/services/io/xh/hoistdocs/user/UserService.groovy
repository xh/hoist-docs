package io.xh.hoistdocs.user

import grails.gorm.transactions.ReadOnly
import grails.gorm.transactions.Transactional
import io.xh.hoist.user.BaseUserService
import io.xh.hoistdocs.security.TokenValidationResult

/**
 * Users are keyed by email and created on first login, as in Toolbox. See Toolbox's
 * `UserService` for the reasoning behind keying on email rather than the token's `sub`.
 */
class UserService extends BaseUserService {

    @ReadOnly
    List<User> list(boolean activeOnly) {
        return activeOnly ? User.findAllByEnabled(true) : User.list()
    }

    @ReadOnly
    User find(String username) {
        return User.findByEmail(username)
    }

    /** Look up or create a User from a validated ID token, keeping name and picture current. */
    @Transactional
    User getOrCreateFromTokenResult(TokenValidationResult tokenResult) {
        def email = tokenResult.email,
            name = tokenResult.name ?: email,
            profilePicUrl = tokenResult.picture,
            user = User.findByEmail(email)

        if (!user) {
            user = new User(email: email, name: name, profilePicUrl: profilePicUrl).save()
            logInfo('Created new user from JWT', email)
        } else if (user.name != name || user.profilePicUrl != profilePicUrl) {
            user.name = name
            user.profilePicUrl = profilePicUrl
            user = user.save()
        }

        return user
    }
}
