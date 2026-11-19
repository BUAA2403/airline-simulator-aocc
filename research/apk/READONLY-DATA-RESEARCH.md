# Airline Simulator read-only data research

Research date: 2026-10-17. Input supplied by the user:
`base.apk.1.apk.1_tmp.apk.1_tmp` (125,170,679 bytes).
SHA-256: `de99a900eb7093578a348a8710443fa122e956e130c099cfad9eba32fac5e486`.

## Confirmed client

- Android package `com.xlr_games.airline_simulator`, version `1.30.6`, versionCode `114`.
- React Native / Expo SDK 57. `assets/index.android.bundle` is Hermes HBC version 98.
- 48,501 functions and 70,113 strings parsed with hermes-dec 0.1.8. The parser warns that v98 is recent; extracted constants and targeted disassembly were independently checked for coherent field names, values and arithmetic. This is static bytecode evidence, not a claim of having run the game.
- Backend is Supabase/PostgREST. Local offline caches use expo-sqlite.

## Connection contract

Native Supabase client creation is function 841. It uses the same public publishable key as the official browser livery editor; no account session or private credential is bundled in the APK. The public key is an application identifier and does not grant user-specific access by itself.

Native host constants are in function 919:

1. Primary `https://urmwaqnhesasfaeprcga-all.supabase.co`.
2. Fallback `https://urmwaqnhesasfaeprcga.supabase.co`.

The client falls back on infrastructure/network failures; it does not establish that a 401/403 can be overcome. The native primary timeout constant is 8 seconds. The custom browser host `auth.airline-simulator.com` maps to the same application key, but the native game client constructs its Supabase client against the primary host above.

Verified native reads (all queries must be scoped to the authorized airline UID):

| Entity | Read |
| --- | --- |
| Master account | `GET /rest/v1/rpc/get_master_player_by_master_uid?p_master_uid=<authenticated user id>` |
| Airline | `GET /rest/v1/rpc/get_player_by_uid?p_uid=<airline uid>` |
| Aircraft | `GET /rest/v1/player_aircraft_data?select=*&uid=eq.<airline uid>` |
| Weekly schedules | `GET /rest/v1/new_player_flight_data?select=*&uid=eq.<airline uid>` |
| Route development | `GET /rest/v1/player_route_data?select=*&uid=eq.<airline uid>` |

Native Supabase RPC calls default to POST; AOCC uses PostgREST GET for the verified read functions. A server refusal of GET must remain an explicit sync error; it must not silently lead to invoking transaction or upsert RPCs.

The account identifier and airline identifier differ. `MasterPlayer.masterUid` is the login user ID. `MasterPlayer.playerUidList` is an array of owned airline/subsidiary UIDs. Function 42030 calls the master RPC with `p_master_uid`; functions 19546 and 43811 consume `playerUidList` directly as an array. Function 41911 calls `get_player_by_uid` with `{p_uid}`. The RPC results are used as objects by `fromDict`, not indexed arrays.

Native public search is `players.select('*').ilike('airlineName', '%query%').gte('claimProfitTime', recentCutoff).limit(...)` (function 41917). A minimal, exact-name public query for a single airline, limited to 10 rows and a few identity fields, returned **HTTP 200 with []** without a session. This does not prove that the airline is missing: row security may conceal it. No broader enumeration or write endpoint was attempted.

## Native schemas

Names and casing matter. The old `player_flight_data` is a local/migration cache, while current network reads use **`new_player_flight_data`**.

`Player` (functions 19330, 19333):
`uid, airlineName, airlineCode, airlineCountry, claimProfitTime, hubAirports, airlineId, extraSpecialLiverySlot, versionString, flagshipAircraftModel`.

`PlayerAircraftData` (functions 18415–18417):
`uid, aircraftId, aircraftModel, registration, deliveryDate, backgroundImageIndex, ecoRatio, ecoProduct, ecoConfigType, ecoPitch, premEcoRatio, premEcoProduct, premEcoPitch, bizRatio, bizProduct, bizPitch, firstRatio, firstProduct, firstPitch, hubAirport, engineOption, wingletOption, eyemaskOption, liveryConfigId, isFullyScheduled`.

`PlayerFlightData` (functions 19196–19200):
`uid, flightId, outboundFlightNumber, inboundFlightNumber, flightString, originAirport, destinationAirport, departureDailyTimestamp, outboundFlightDuration, inboundFlightDuration, turnaroundOffset, isStopover, childStopoverFlightId, aircraftAssignments`.

`aircraftAssignments` is an object keyed by aircraft ID. Network or cache values may be a JSON string; function 19198 parses strings. Each assignment contains:
`aircraftId, dowList, ecoPrice, premEcoPrice, bizPrice, firstPrice, ecoPax, premEcoPax, bizPax, firstPax, flightProfit` (function 32789).

`PlayerRouteData` (functions 19310–19314):
`uid, routeId, flightString, originAirport, destinationAirport, ecoPoints, premEcoPoints, bizPoints, firstPoints`.

No confirmed per-airline cash balance, actual revenue ledger, actual load factor, actual aircraft position, condition, or seat count is exposed by these four entities. Configured cabin capacity requires reproducing the native cabin calculation, not simply substituting the type's maximum seating. AOCC therefore retains null for unconfirmed fields.

## Verified account cash and planned weekly economics

Further static tracing confirms usable financial values without inventing a realized revenue ledger:

- `MasterPlayer.goldBalance` is shared across subsidiaries. `StaticResourceDisplay` (28505, offsets 0x50 and 0x5d0–0x60b) reads the master balance and formats the gold resource as `'$ ' + splitNumberWithComma(goldBalance) + 'K'`. The balance unit is **thousands of game dollars**. The profit collection implementation (46676) credits the `gold` delta at the master UID, confirming account scope. AOCC exposes `metrics.accountCash = master.goldBalance × 1000` only when the master lists the selected airline. It keeps `airline.cash = null` and labels the value **集团共享现金 / 游戏美元**.
- `validateAndUpdateFlightData` (39999, offsets 0x1da–0x22d) calls `getFlightWeeklyProfitPax`, stores its `weeklyFlightPax[0..3]` directly into `ecoPax`, `premEcoPax`, `bizPax`, `firstPax`, and stores `weeklyFlightProfit` into `flightProfit`. `recomputeAssignmentsForLeg` (40819) does the same. These stored fields are **already weekly totals**, including assigned operating days. Passenger totals are for one direction: function 24099 passes `dowList.length` into closure 35484, which rounds per-flight pax × days. Never multiply them again by `dowList.length` or by 2.
- `FlightPaxAndProfitRow` (30462, 0x34 and 0xd4b–0xd68) accepts `weeklyProfit` and displays it as `$ ... K`, establishing the same ×1000 conversion. The native `calculateProfit` (27056, 0x14e–0x16c) sums `getTotalFlightProfit` and `getTotalPax` across all flight rows, including linked stopovers.
- AOCC exposes `metrics.weeklyPlannedProfit = Σ assignment.flightProfit × 1000` and `metrics.weeklyPlannedPassengers = Σ (ecoPax + premEcoPax + bizPax + firstPax)`. The passenger metric preserves the native one-direction weekly cache, not round-trip passenger segments or unique people. Per-flight cabin averages divide by operating days, never by twice that number. Summation covers valid scheduled assignments of owned aircraft. Missing stored economics or incomplete normalization leaves the affected aggregate null; explicit stored zeros remain zero.
- These are **the game's saved weekly estimates**, which can remain unchanged until the game recomputes them. They are not realized income, cash movement, or individual-day actual passengers. Per-flight `revenue` and `passengers` remain null. Costs, load factors and actual accounting balances are not inferred from the weekly profit estimate.

The runtime reads the already returned `master` object for this feature and makes no additional remote request. No collection, purchase, transaction, upsert or other mutation is invoked.

## Schedule semantics and map provenance

- `dowList`: Monday **0** through Sunday **6**. Confirmed by function 634's `dowDataList`, and by `getRealWeeklyTimestamp` (17577) computing `(getUTCDay()+6)%7`.
- `departureDailyTimestamp`: seconds in the origin airport's local clock. `-1` means unscheduled. Do **not** modulo by 86400: a child stopover departure can carry a following-day offset.
- `outboundFlightDuration` and `inboundFlightDuration`: minutes.
- Airport `timezone_offset`: seconds. Native map scheduling subtracts the origin offset to produce UTC (17805, 17806).
- UTC outbound departure = Monday UTC midnight + day index × 86400 seconds + daily timestamp − origin UTC offset.
- Return departure = outbound departure + outbound minutes + turnaround minutes.
- Turnaround (17583) is 60 minutes for distance <1500 km, 90 for <4000 km, 120 for <10000 km, and 150 otherwise, **plus `turnaroundOffset × 15` minutes** (constant verified in 634/17609).
- Linked stopovers can be processed as separate flight rows: the parent's configured turnaround includes child-flight/layover time. Native `getFlightDisplayBands` (27247) and `getStopoverLayoverTimeFromPlayerFlightData` (27246) show four sequential legs. The normalizer preserves each row's own local timestamp and assignments.
- The native map uses additional route planning and optional display staggering. AOCC currently estimates positions on the great-circle path from the verified schedule. These are **schedule estimates**, not actual game telemetry or ADS-B, and are labeled accordingly.

`server/game-normalize.mjs` materializes current UTC-day operations and still-airborne departures from the previous day, with deterministic occurrence IDs. It retains null financial and capacity fields, filters out foreign UIDs, and produces diagnostics for missing airports, invalid times, unknown assigned aircraft, missing stopover children, and conflicting scheduled tasks.

## Reference extraction

`extract_static.py` extracts HBC object-shape 298 (2,232 airports) and 337 (78 aircraft variants) into:

- `server/data/airports.json`: native `id`, IATA/ICAO, country/city, coordinates, fixed game timezone offsets, and airport operational constraints.
- `server/data/aircraft-types.json`: type/code/class, geometry, range, maximum seating, native price constants, runway requirements.

All 2,232 airport IDs are unique and coordinates are in range. HBC `IntegerTag` constants are signed 32-bit numbers; the extraction script corrects hermes-dec's unsigned integer representation, which otherwise corrupts negative timezone offsets. The regression check validates every timezone offset within ±14 hours. Native game offsets are fixed bundled values (e.g. JFK -14400, LHR +3600); use these for consistency with the game instead of replacing them with current real-world DST calculations.

Native IDs can differ from current IATA (`FRU` → `BSZ`, `CSL` → `CSW`), so IDs must not be discarded. Aircraft variants can share an ICAO type code (78 variants / 64 distinct codes), so `aircraft_code` is not a unique key.

The target disassembly files under `functions/` and the offline extraction scripts make findings reproducible against the supplied APK. They contain client implementation strings; keep research local with this project. Runtime uses only the extracted reference JSON, not Python or the analysis tools.

## Validation

`node --test tests/game-normalize.test.mjs` passes 12 tests covering Monday indexing, UTC+8 conversion to previous UTC day, a negative game UTC offset crossing Sunday into Monday, return turnaround, midnight carryover, JSON-encoded assignments, unknown and foreign aircraft filtering, unscheduled sentinel, child timestamps over 86400, exact turnaround thresholds, signed extracted reference coordinates/timezones, shared account cash units and ownership, already-weighted weekly economics, and unknown-versus-zero economics.

Format references used while inspecting Hermes:
- [Meta Hermes bytecode design](https://github.com/facebook/hermes/blob/static_h/doc/Design.md)
- [Meta bytecode format](https://github.com/facebook/hermes/blob/static_h/include/hermes/BCGen/HBC/BytecodeFileFormat.h)
- [hermes-dec parser source](https://github.com/P1sec/hermes-dec/blob/main/src/hermes_dec/parsers/hbc_file_parser.py)


## Corrected map clock (third pass, 2026-10-17)

The schedule-to-UTC arithmetic above is correct, but using real calendar time directly for map status was wrong for the native default display mode. Function 46063 loads `mapTimeSystem` from local AsyncStorage with default `accelerated`. Function 20749 (`getMapDisplayWeeklyTimestamp`) has two modes:

- `realtime`: use 17577 (`getRealWeeklyTimestamp`) — weekday and UTC time.
- Otherwise: UTC seconds-of-day × `ACCELERATION_FACTOR`, which is **7** (module 1239, environment slot 0). Milliseconds are not used.
- An active potion multiplies that value by `POTION_ACCELERATION_RATIO`, **6** (module 1240, environment slot 1), then modulo 604800. Thus 42×, and phase is derived from UTC time-of-day, not from elapsed time since potion activation.
- Accelerated mode restarts at virtual Monday on every real UTC midnight, irrespective of the real weekday. Potion activation/expiry can change phase abruptly, exactly as the native formula specifies.

Potion usage is read from `potion_usage`, scoped with `uid = Player.uid` (43821); 20757 checks strict `start < serverTime < end`. AOCC reads only start/end values by GET, evaluates intervals locally each second, and qualifies the clock when this optional read is unavailable. Native map mode is device-local, so AOCC stores its own matching display preference; the user confirmed accelerated mode.

Internal occurrence dates use the current real week's Monday solely as an anchor. UI plan dates display weekdays; collection/history timestamps remain real time. Snapshot timing metadata is separate from capture time. The frontend advances states, coordinates and real remaining seconds using the same clock. Native route avoidance, collision staggering and overflow hiding remain separate map presentation rules; no server telemetry is claimed.
