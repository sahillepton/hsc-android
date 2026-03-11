# Network Topology Binary Structure

> UDP receive-only on **port 40074** (intranet). No registration message needed — data arrives automatically.

## Full Packet Layout

```
{
  ExtMsgType ext_msg_type          // 1 byte
  uint16_t   payload_length        // 2 bytes, big-endian

  topoForMcsa: {
    UINT8 node_id                  // 1 byte  — current node's ID
    UINT8 numFusedNodes            // 1 byte  — number of entries in topoWithNodeIP[]

    topoWithNodeIP: [              // array length = numFusedNodes
      {
        UINT8 IP[4]                // 4 bytes, big-endian (network byte order)

        topology: {
          UINT8 id                 // 1 byte  — this node's topology ID
          UINT8 numNeighbors       // 1 byte  — number of entries in entries[]

          entries: [               // array length = numNeighbors
            {
              UINT8 id             // 1 byte  — neighbor node ID
              UINT8 snr            // 1 byte  — signal-to-noise ratio
            },
            ... (more neighbors)
          ]p
        }

        positional: {
          INT32  latitude          // 4 bytes, big-endian, microdegrees (÷ 1,000,000 = degrees)
          INT32  longitude         // 4 bytes, big-endian, microdegrees (÷ 1,000,000 = degrees)
          UINT16 altitude          // 2 bytes, big-endian
        }

        int8_t RSSI                // 1 byte, signed (-128 to 127)
      },
      ... (more nodes)
    ]
  }
}
```

## Field Details

| Field | Type | Size | Byte Order | Notes |
|---|---|---|---|---|
| `ext_msg_type` | `ExtMsgType` | 1 byte | — | Message type identifier (values TBD) |
| `payload_length` | `uint16_t` | 2 bytes | Big-endian | Total payload length |
| `node_id` | `UINT8` | 1 byte | — | Current node's own ID |
| `numFusedNodes` | `UINT8` | 1 byte | — | Count of `topoWithNodeIP` entries |
| `IP[4]` | `UINT8[4]` | 4 bytes | Big-endian (network order) | IPv4 address, e.g. `192.168.1.10` |
| `topology.id` | `UINT8` | 1 byte | — | Node's topology ID |
| `topology.numNeighbors` | `UINT8` | 1 byte | — | Count of neighbor `entries` |
| `entries[].id` | `UINT8` | 1 byte | — | Neighbor node ID |
| `entries[].snr` | `UINT8` | 1 byte | — | Signal-to-noise ratio (0–255) |
| `latitude` | `INT32` | 4 bytes | Big-endian | Microdegrees (divide by 1,000,000) |
| `longitude` | `INT32` | 4 bytes | Big-endian | Microdegrees (divide by 1,000,000) |
| `altitude` | `UINT16` | 2 bytes | Big-endian | Altitude value |
| `RSSI` | `int8_t` | 1 byte | — | Signed, range: -128 to 127 |

## Key Notes

- **Byte order**: All multi-byte fields are **big-endian**.
- **IP byte order**: Network byte order (big-endian), read as `IP[0].IP[1].IP[2].IP[3]`.
- **Array sizes are protocol-guaranteed**: `topoWithNodeIP.length == numFusedNodes` and `entries.length == numNeighbors`.
- **RSSI** is a **signed** 8-bit integer (`int8_t`), expected range -128 to 127.
- **Latitude/Longitude** are in microdegrees — divide by `1,000,000` to get decimal degrees.
- **ExtMsgType** values for topology vs other message types: **TBD** (to be confirmed).

## Per-Node Byte Size (variable)

Each `topoWithNodeIP` entry size:
```
4 (IP) + 1 (id) + 1 (numNeighbors) + numNeighbors × 2 (entries) + 4 (lat) + 4 (lon) + 2 (alt) + 1 (RSSI)
= 17 + numNeighbors × 2 bytes
```

## Minimum Packet Size

```
1 (ext_msg_type) + 2 (payload_length) + 1 (node_id) + 1 (numFusedNodes) = 5 bytes header
+ numFusedNodes × (17 + numNeighbors × 2) bytes payload
```

