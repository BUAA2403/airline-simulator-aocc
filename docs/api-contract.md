# AOCC API contract

GET /api/state -> { connection, snapshot, history, logs }
connection: { status: 'disconnected'|'connecting'|'live'|'stale'|'error', source: 'game'|'import'|'demo'|null, lastAttemptAt, lastSuccessAt, nextSyncAt, intervalSeconds:60, message, airlineId, hasCredentials:boolean }
snapshot: null OR { schemaVersion:1, capturedAt:ISO, airline:{id,name,code,hub,cash,currency:'USD'}, airports:[{id,iata,name,city,country,lat,lon}], aircraft:[{id,registration,type,status,location,flightId,capacity,condition,utilization}], flights:[{id,number,aircraftId,origin,destination,departure:ISO,arrival:ISO,status,lat,lon,heading,progress,positionSource:'game'|'schedule',passengers,revenue}], routes:[{id,origin,destination,flightsPerDay,distanceKm,loadFactor,revenue,cost}], metrics:{}, provenance:{source,notes:[]} }
Unknown numeric values are null, never invented 0. Airport origin/destination resolves by id OR iata. history:[{capturedAt,cash,aircraftCount,flightCount,routeCount,revenue}]. logs:[{at,level,message}].

Game metrics: accountCash (master-account shared virtual USD; NOT airline.cash), weeklyPlannedProfit (virtual USD/week), weeklyPlannedPassengers (native one-direction weekly passenger cache; not round-trip pax legs), weeklyScheduledLegs, scheduledAssignments, gameFlightRows, normalizationIssues. Unknown totals are null, explicit zero preserved. history also includes accountCash. Aircraft utilization is 0..100 percent of weekly minutes spent flying. Route loadFactor is 0..1 when available. Game positions are schedule estimates. Sources and diagnostics are in snapshot.provenance.notes.

New game snapshots include `weeklySchedules` and `weeklySchedulesComplete`. Each row has the owned schedule ID, airports, flight numbers, `departureSeconds` in the origin's local clock, outbound/inbound/turnaround minutes, `distanceKm`, stopover linkage, and per-aircraft weekday assignments (`0` = Monday). This is the recurring plan used by the scheduling assistant. It also includes timed schedules with zero assignments. Airport `maxAircraftCode` stores the game's airport category. Older snapshots acquire these fields after the next successful sync.

POST /api/connection JSON {airlineId?, accessToken?, refreshToken?, apiKey?, intervalSeconds?} -> {ok,connection}; never return credentials.
POST /api/sync -> {ok,connection} (coalesces concurrent sync)
POST /api/disconnect -> {ok}
POST /api/import body {snapshot} or native game capture (adapter recognizes shapes) -> {ok,connection}
GET /api/export -> JSON state (no credentials)
GET /api/events SSE event:state data: same GET state
GET /api/health -> {ok,version}
GET /api/demo -> same state shape with clearly labeled demo data; does NOT set live server state. UI explicit demo opt-in only; banner must stay visible.

No writes to game. Connection config persists locally, tokens never in browser storage. Settings UI supports user-assisted Supabase session pairing (not passwords) and optional owned airline UID. POST /api/session-bridge with one-time pairingCode plus session access_token/refresh_token. GET /api/bridge-code returns a random code valid for 10 minutes, consumed on first submission. Empty state required and demo button optional. UI uses fetch /api/state + EventSource /api/events. All navigation tabs work with loaded data. Default connection no auth, real empty data.
