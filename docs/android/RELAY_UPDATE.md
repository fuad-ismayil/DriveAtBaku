# Updating the relay on the second PC

The 0.3 echo diagnostic confirms that the public relay now preserves indicators
and plates, but removes the new `au` engine load/shift/acceleration object.
Android and browser clients cannot recover fields removed by the server. The
current project server preserves these fields without changing protocol 1.
Publish the updated web build as well so web drivers send engine load/shift state
and hear Android engines through the complete mixer.

The portable `android/build/DriveAtBaku-relay-update.zip` contains the complete
relay source, its locked dependency list, the shared indicator helper and a
diagnostic. It does not contain website assets or Android build tools.

1. Copy the ZIP to the second PC and extract it into a **new folder**. Keep the
   old relay folder for rollback. Do not extract it over your website project.
2. Install Node.js 22 or newer if needed. Open a terminal in the extracted folder
   and run `npm ci --prefix server` once to install the locked dependency.
3. Preserve the existing relay environment, especially `PORT` and any
   `ALLOWED_ORIGINS`. The default port is 8787. Keep the existing public tunnel
   or reverse proxy pointed at that same port.
4. Stop the old relay process using its console (Ctrl+C) or its existing service
   manager. This briefly disconnects current players. Do not stop unrelated Node
   processes or the tunnel.
5. In the new folder run `npm start --prefix server`. If you use a service manager,
   instead change that service's working directory/script to this new relay and
   restart it with its existing environment.
6. From the extracted folder, run:

   ```text
   node tools/probe_relay.mjs wss://server.driveatbaku.games/
   ```

   The result should include `"indicatorsPreserved":true`,
   `"platesPreserved":true` and `"engineStatePreserved":true`. It writes a local
   report under `artifacts/android/`.
   The probe briefly connects one diagnostic vehicle and inspects only its own
   returned state.
7. Reconnect Android and browser players and check idle, neutral revving,
   acceleration, coast and gear changes on all four cars, plus the indicators.
   The server must keep running for multiplayer to remain available.

If the replacement cannot start, stop it and restart the old relay with its
original environment. No database migration is required. This package does not
change DNS, tunnel configuration, website hosting or saved player preferences.
