# Multipath Routing for Reliable Data Transmission

A course project that models a computer network and compares single-path routing with multipath delivery and recovery.

## Current build

The current build provides a loadable in-memory topology, Dijkstra's shortest path, Yen's K-shortest loopless paths, packet delivery and recovery simulation, fair seeded comparisons, congestion-aware routing, and a browser dashboard. The network is a simulation; it does not send traffic through physical routers.

## Run the backend

From this folder, create a virtual environment, install dependencies, then start Flask:

```powershell
python -m venv .venv
& .\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m backend.app
```

If PowerShell blocks environment activation, call the virtual environment interpreter directly after installing dependencies: `./.venv/Scripts/python.exe -m backend.app`. The dashboard and API are available at `http://127.0.0.1:5000` while the server is running. Keep that terminal open; press Ctrl+C there to stop it.

### API calls

- `GET /api/topology` — return nodes and links with cost, delay, capacity, and state.
- `POST /api/topology` — validate and load a topology with `nodes` and `links` arrays. The dashboard's “Load or edit a topology” panel provides the current topology JSON as a starting point.
- `POST /api/routes` — JSON body such as `{"source":"S","destination":"D","k":3}`. Set `"strategy":"congestion"` to rank paths by link cost, weighted delay, and estimated load adjusted by link capacity.
- `POST /api/simulate` — run packet delivery in `single`, `multipath`, or `congestion_aware` mode. Example body:

  ```json
  {"source":"S","destination":"D","message":"Hello network","mode":"multipath","k":2,"packet_size":4,"loss_probability":0.15,"max_retries":3,"seed":7}
  ```

  Optional controlled failure: add `"failure":{"source":"S","target":"R1","after_transmissions":2}`. The failure applies only to this experiment. The response includes packet outcomes, an event timeline, delivery metrics, the reassembled message, and its SHA-256 integrity result.
- `POST /api/compare` — run both modes from the same inputs, with matching seeded loss outcomes for each packet/retry. Accepts the same body fields as `/api/simulate`, except `mode`.
- `POST /api/failure` — JSON body such as `{"source":"S","target":"R1","available":false}` to manually change a link state.
- `POST /api/reset` — restore the demo topology.

## Dashboard workflow

Choose endpoints, write a message, adjust packet size and loss, then run either routing mode or compare both. Expand “Load or edit a topology” to change the JSON graph and apply it. Nodes require a unique `id`; optional `label` defaults to the id and `type` defaults to `router` (`computer` and `router` are supported). Links require existing `source` and `target` ids and a positive `cost`; `delay_ms` defaults to 1, `capacity_mbps` defaults to 100, and `available` defaults to true. Invalid topologies are rejected without replacing the active network.

The topology shows the selected routes; packet outcomes, acknowledgements, failures, recovery, metrics, and the received-message integrity check appear below. In congestion-aware mode, each packet triggers a route re-score using the estimated prior transmission count on each link, link capacity, and configured link delay. The event log records the selected route and its score. A scheduled link failure applies only to that experiment. A manual link outage stays in the in-memory topology until restored or reset.

## Run the checks

From the project folder, run:

```powershell
python -m pytest -q
```

The suite covers route selection including congestion-aware scoring, packet ordering and duplicate suppression, packet loss and retries, link recovery, total outage, integrity checks, the API, and custom topology loading.

## Simulation limits

Packets are processed in a simulated sequence. Delays, loss, and link state are modeled inputs; throughput is calculated from delivered payload and simulated elapsed time, not from parallel hardware traffic or live link capacity. The application is intended to demonstrate routing and recovery behavior, not predict physical-network performance.
