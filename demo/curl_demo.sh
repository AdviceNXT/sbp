#!/bin/bash
# SBP Protocol Demo using curl
# Shows the raw HTTP/SSE protocol in action

BASE_URL="http://localhost:3000"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║              SBP Protocol Demo (curl)                      ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# 1. Health check
echo "1. Health Check"
echo "   GET /health"
curl -s "$BASE_URL/health" | jq .
echo ""

# 2. Emit a pheromone
echo "2. Emit a pheromone"
echo "   POST /sbp"
RESPONSE=$(curl -s -X POST "$BASE_URL/sbp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Sbp-Protocol-Version: 0.1" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "sbp/emit",
    "params": {
      "trail": "demo.signals",
      "type": "test_event",
      "intensity": 0.8,
      "payload": {"message": "Hello from curl!"},
      "tags": ["demo"]
    }
  }')
echo "$RESPONSE" | jq .
echo ""

# 3. Emit more signals
echo "3. Emit more signals..."
for i in 1 2 3; do
  curl -s -X POST "$BASE_URL/sbp" \
    -H "Content-Type: application/json" \
    -d "{
      \"jsonrpc\": \"2.0\",
      \"id\": \"emit-$i\",
      \"method\": \"sbp/emit\",
      \"params\": {
        \"trail\": \"demo.signals\",
        \"type\": \"test_event\",
        \"intensity\": 0.$((5 + i)),
        \"payload\": {\"index\": $i}
      }
    }" > /dev/null
  echo "   Emitted signal $i"
done
echo ""

# 4. Sniff the environment
echo "4. Sniff the environment"
echo "   POST /sbp (method: sbp/sniff)"
curl -s -X POST "$BASE_URL/sbp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "2",
    "method": "sbp/sniff",
    "params": {
      "trails": ["demo.signals"],
      "min_intensity": 0.1
    }
  }' | jq .
echo ""

# 5. Register a scent
echo "5. Register a scent (trigger condition)"
curl -s -X POST "$BASE_URL/sbp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "3",
    "method": "sbp/register_scent",
    "params": {
      "scent_id": "high-activity",
      "agent_endpoint": "http://localhost:8080/webhook",
      "condition": {
        "type": "threshold",
        "trail": "demo.signals",
        "signal_type": "test_event",
        "aggregation": "count",
        "operator": ">=",
        "value": 3
      }
    }
  }' | jq .
echo ""

# 6. Inspect the blackboard
echo "6. Inspect blackboard state"
curl -s -X POST "$BASE_URL/sbp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "4",
    "method": "sbp/inspect",
    "params": {
      "include": ["trails", "scents", "stats"]
    }
  }' | jq .
echo ""

# 7. SSE Stream demo
echo "7. SSE Stream (triggers) - Press Ctrl+C to stop"
echo "   GET /sbp with Accept: text/event-stream"
echo "   (Open another terminal and emit signals to see triggers)"
echo ""
echo "   Listening for events..."
curl -N -s "$BASE_URL/sbp" \
  -H "Accept: text/event-stream" \
  -H "Sbp-Protocol-Version: 0.1"
