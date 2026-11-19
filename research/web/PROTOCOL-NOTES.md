# Official web research — 2026-10-17

## Confirmed from the official public web app

- Main site: https://www.airline-simulator.com/
- Web livery editor: https://livery.airline-simulator.com/
- Supabase custom base URL: https://auth.airline-simulator.com
- Public client publishable key: `sb_publishable_zGtQpUELNKHPluSkfQ9FOw__BXFJVlf`
- SDK: Supabase JS 2.58.0; Auth JS 2.72.0.
- SDK constructs `/auth/v1`, `/rest/v1`, `/storage/v1`, `/functions/v1`, and WebSocket `/realtime/v1`.
- Explicit auth config: autoRefreshToken true, persistSession true, detectSessionInUrl true. Default flowType is implicit.
- OAuth providers called by app: Google and Apple.
- Official app passes redirectTo `${window.location.origin}/auth/callback` with optional encoded internal redirect parameter.
- Official callback observes SIGNED_IN, removes token-related query parameters, then performs the internal redirect. No dedicated session export flow was found.
- Default storage key is `sb-${baseUrl.hostname.split('.')[0]}-auth-token`, hence **sb-auth-auth-token** on the official livery origin.
- Official app reads `master_player` selecting `diamondBalance`, filtering `masterUid` by the authenticated user ID. This proves the auth backend shares at least master account data with the game, but does not prove that game fleet/route tables reside on the same region.
- Other observed public application references: web_livery_editor_users, web_livery_editor_projects, web_livery_editor_aircrafts, web_livery_export_data, discover_livery_templates.
- Read-purpose RPCs referenced by app: get_server_time, search_project_ids (query and max_count), filter_projects_by_designed_aircraft (aircraft_names).
- No general airline-name/fleet/route lookup is exposed in the livery app code reviewed. search_project_ids searches livery project IDs, not operational airline data.

## Endpoint evidence files

- `7c8e0c6e0a6a6626.js` contains Supabase client construction and SDK.
- `0db8b7553388213b.js` contains signInWithGoogle/signInWithApple.
- `6e543a9c46cbe578.js` contains callback implementation.
- `1db01ab693247199.js` contains master_player and livery table/read RPC references.
- `livery-index.html`, `signin.html`, `auth-callback.html` are source snapshots.

Files are downloaded copies for research only; they are not application dependencies and should not be shipped.

## Read-only network probe

A single GET https://auth.airline-simulator.com/rest/v1/ with the publishable apikey and Accept application/openapi+json returned: `Secret API key required`, hint `Only secret API keys can be used for this endpoint.` No schema was returned. Do not attempt secret keys or auth bypass. No authentication, writes, or account-data reads were performed in this research.

## Secure connection recommendation

Do not assume localhost is an allowed OAuth redirect. Do not relay tokens via a registered redirect hosted by the game, and do not capture sessions from unrelated browser contexts.

Preferred long-term path is a developer-approved OAuth redirect or dedicated read-only export/API token. Pending that, a small user-installed extension can provide explicit user-assisted local connection:

1. User independently opens and signs into the official livery site with their existing game account.
2. User clicks an extension action labeled Connect AOCC.
3. The extension operates only on the exact official livery origin and reads only the `sb-auth-auth-token` localStorage entry after the explicit click.
4. It displays the destination localhost address and account identity, asks user to connect, and sends the session straight to localhost; alternatively downloads a local JSON the user imports into AOCC.
5. Never write the session to logs, browser console, UI text, telemetry, repository, or app static assets.
6. AOCC validates the token subject and user identity, stores secrets locally with user-only access, exposes only sanitized connection status to the frontend, and uses authenticated GET requests limited to the user's authorized airline(s).
7. Refresh only through Supabase's standard auth refresh path. Replacing or sharing a rotating refresh token with the live livery browser may cause races; serialize local refreshes and handle invalid refresh tokens by reconnecting rather than retry loops. Consider an extension-owned session/export architecture only if explicitly approved by the game developer.

Note: official WLE application has normal post-login initialization that may create a WLE profile. This research did not log in or execute that behavior. A strict AOCC connector itself must not call profile creation, project, purchase, or gameplay write RPCs.

## Architecture implications

Use the APK findings to identify region selection and exact operational SELECT calls. Keep a server-side read-only transport with endpoint and table allowlists, bounded airline filters, 60–120 second sync (tune with permission/scale), exponential backoff and Retry-After, cached latest successful snapshot, explicit stale/offline status, and locally interpolated flight positions between snapshots using server time plus scheduled flight times. Do not poll arbitrary realtime subscriptions unless publication and authorization are confirmed.

## Official product context

Main website says the game supports real-time interactive flight maps and exploring other players' fleets, routes, and hubs. Latest official notes at the time reviewed are v1.30.3, October 7, 2026. Official FAQ clarifies that all in-game money numbers are displayed in K (thousands); preserve this unit in AOCC or convert with explicit labels.

Sources:
- https://www.airline-simulator.com/
- https://www.airline-simulator.com/faq
- https://www.airline-simulator.com/updates
- https://livery.airline-simulator.com/
- https://livery.airline-simulator.com/signin
- https://livery.airline-simulator.com/auth/callback
