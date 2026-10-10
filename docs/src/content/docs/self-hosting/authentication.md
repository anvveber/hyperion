---
title: Authentication
description: Password login, single sign-on with OIDC, and controlling registration.
sidebar:
  order: 4
---

By default, Nametag uses email and password authentication with accounts auto-verified on self-hosted instances. You can optionally add single sign-on through any OIDC-compliant provider, and control whether new accounts can register at all.

## Default: password authentication

Out of the box, users register with an email address and password. On self-hosted instances (unlike the hosted service), there's no email verification step: accounts are active immediately after registration, whether or not you've configured [email](/self-hosting/email/). This is intentional. Nametag assumes a self-hosted instance is being run by someone who trusts the people they're giving access to.

Password reset still requires email to be configured, since there needs to be somewhere to send the reset link.

Rate limiting protects the login and registration endpoints from brute-force attempts: 5 login attempts per 15 minutes and 3 registration attempts per hour, per client. See [Redis](/self-hosting/redis/) for how this is enforced and what changes without Redis configured.

## OIDC single sign-on (optional)

Nametag supports logging in via an external OIDC provider (Authentik, Keycloak, Pocket-ID, and others), letting you use an identity system you already run instead of managing separate passwords.

### Enabling OIDC

1. Register Nametag as a client application in your OIDC provider
2. Set the callback URL to `{NEXTAUTH_URL}/api/auth/callback/oidc`
3. Add the provider details to your `.env`:

```bash
OIDC_ISSUER_URL=https://auth.example.com/realms/main
OIDC_CLIENT_ID=nametag
OIDC_CLIENT_SECRET=your-client-secret
OIDC_DISPLAY_NAME=Authentik
```

All three connection variables, `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET`, must be set together for OIDC to activate. Your provider must serve a `/.well-known/openid-configuration` document at the issuer URL, which is standard for any compliant OIDC provider.

`OIDC_DISPLAY_NAME` controls the label shown on the login button (defaults to "SSO") so it can read "Continue with Authentik" or whatever fits your setup.

### Account behavior

- On first OIDC login, Nametag creates an account automatically using the email and name your provider returns
- If an account with that email already exists, the OIDC identity is linked to it rather than creating a duplicate
- Profile fields (name, etc.) are set only on that first login; edits you make later inside Nametag are never overwritten by the provider

### Common providers

| Provider | Issuer URL example |
| --- | --- |
| Authentik | `https://auth.example.com/application/o/nametag/` |
| Keycloak | `https://keycloak.example.com/realms/myrealm` |
| Pocket-ID | `https://pocket-id.example.com` |

Any provider that exposes a standard OIDC discovery document should work the same way.

### Disabling password login

Once OIDC is working reliably, you can hide the password form entirely and require SSO for everyone:

```bash
DISABLE_PASSWORD_LOGIN=true
```

This removes the credentials form, the "forgot password" link, and the registration page. The first SSO login on an empty instance creates the admin account; everyone else needs an account added by an admin first (see below).

The app refuses to start if `DISABLE_PASSWORD_LOGIN=true` is set without a fully configured OIDC provider, since that combination would lock everyone out. Fix the OIDC variables first, confirm SSO login works, and only then set this flag.

## Accounts and the admin

A self-hosted instance has one public signup: the first account. Whoever opens a fresh instance is sent to a setup screen, and the account they create becomes the **admin**. After that, the signup page is closed and the login page no longer links to it.

The admin creates every other account from **Settings > Users**. From there an admin can:

- Add an account with a name, email, role and password, then share the password with the person. They can change it in Settings > Security.
- Reset someone's password. This also clears a login lockout.
- Make another account an admin, or remove admin rights. The instance always keeps at least one admin.
- Delete an account and all of its data. Admins delete their own account from Settings > Account; the last admin can't do that while other accounts exist, so promote someone else first.

With OIDC configured, the password is optional. Leave it empty and the person signs in through your provider with that email, which links the SSO identity to the account. With `DISABLE_PASSWORD_LOGIN=true` the first SSO login on an empty instance creates the admin account, and later SSO logins only work for emails an admin has already added.

Upgrading an existing instance: the migration that adds roles makes the oldest account the admin. Nothing else changes for existing accounts.

`DISABLE_REGISTRATION` has no effect on self-hosted instances any more, since public signup is always closed once the first account exists. It still controls signup in SaaS mode.

### Accounts and outgoing webhooks

Self-hosted instances deliberately allow a webhook destination to point at a private address, any port, and plain http, since reaching a box on your own network is exactly the point of self-hosting the feature. That is a reasonable default for a single-user or trusted-family instance, but it means every account on the instance can make Nametag send a signed `POST` to any host, port, and path reachable from the server, not just an origin, since a webhook preserves the full path and query string (unlike an ntfy destination, which can only ever reach an origin's root).

Because only an admin can create accounts, that capability is limited to people the admin added. If you add people you don't fully trust and the instance sits on a network with anything sensitive reachable from it, run Nametag on a network segment isolated from anything their webhooks shouldn't be able to reach.

## Password and session specs

These aren't configurable, but they're worth knowing:

| Setting | Value |
| --- | --- |
| Password length | 8 to 128 characters |
| Password complexity | Must include an uppercase letter, a lowercase letter, a number, and a special character |
| Password hashing | bcrypt, 10 rounds |
| Session max age | 30 days |
| Session update age | 24 hours (a session is refreshed once this much time has passed since it was issued) |
| Password reset token expiry | 1 hour |
| Email verification token expiry | 24 hours |

## API token authentication

Beyond browser sessions and OIDC, Nametag also supports personal API tokens for programmatic access:

- Format: `ntag_` prefix followed by 32 random bytes, hex-encoded
- Storage: only a SHA-256 hash is stored, with a short plaintext prefix kept for identification in the tokens list
- Scopes: `READ` (read-only) and `READ_WRITE` (full access)

See [API Tokens](/api/tokens/) for how to create and use them.
