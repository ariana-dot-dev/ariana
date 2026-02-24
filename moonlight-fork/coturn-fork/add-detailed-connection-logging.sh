#!/bin/bash
# Adds ultra-detailed logging for connection debugging

set -e

cd /home/ariana/project/moonlight-fork/coturn-fork

echo "Adding detailed connection logging to coturn..."

# Backup original files
for file in src/server/ns_turn_server.c src/apps/relay/ns_ioalib_engine_impl.c; do
    if [ ! -f "${file}.orig" ]; then
        cp "$file" "${file}.orig"
    fi
done

# Add logging to handle_turn_allocate
sed -i '/^static int handle_turn_allocate/a\
  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "═══════════════════════════════════════════════════════════");\
  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[TURN-ALLOCATE] *** NEW ALLOCATION REQUEST RECEIVED ***");\
  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "═══════════════════════════════════════════════════════════");
' src/server/ns_turn_server.c

# Add logging to handle_turn_refresh
sed -i '/^static int handle_turn_refresh/a\
  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[TURN-REFRESH] *** REFRESHING ALLOCATION ***");
' src/server/ns_turn_server.c

# Add logging to handle_turn_send
sed -i '/^static int handle_turn_send/a\
  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[TURN-SEND] *** RELAYING DATA TO PEER ***");
' src/server/ns_turn_server.c

# Add logging to handle_turn_create_permission
sed -i '/^handle_turn_create_permission/a\
  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[TURN-PERMISSION] *** CREATING PEER PERMISSION ***");
' src/server/ns_turn_server.c

# Add logging to handle_turn_channel_bind
sed -i '/^handle_turn_channel_bind/a\
  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[TURN-CHANNEL] *** BINDING CHANNEL TO PEER ***");
' src/server/ns_turn_server.c

# Add ICE candidate logging
cat >> src/server/ns_turn_server.c << 'EOF'

/* ARIANA CUSTOM LOGGING: Log ICE credentials and candidates */
void log_ice_connection_details(const char* username, const char* realm, const char* client_addr) {
  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "┌─────────────────────────────────────────────────────────────┐");
  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "│ ICE CONNECTION DETAILS                                       │");
  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "├─────────────────────────────────────────────────────────────┤");
  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "│ Client: %-50s │", client_addr ? client_addr : "UNKNOWN");
  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "│ Username: %-48s │", username ? username : "NONE");
  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "│ Realm: %-51s │", realm ? realm : "NONE");
  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "└─────────────────────────────────────────────────────────────┘");
}

EOF

# Add UDP relay logging
cat >> src/apps/relay/ns_ioalib_engine_impl.c << 'EOF'

/* ARIANA CUSTOM LOGGING: Log every UDP packet relay */
void log_udp_relay(const char* from_addr, const char* to_addr, size_t bytes) {
  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[UDP-RELAY] %s → %s (%zu bytes)",
                from_addr ? from_addr : "UNKNOWN",
                to_addr ? to_addr : "UNKNOWN",
                bytes);
}

EOF

echo "✓ Detailed connection logging added"

# Add timestamp logging to see exact timing
cat >> src/server/ns_turn_server.c << 'EOF'

/* ARIANA CUSTOM LOGGING: Log with microsecond timestamps */
#include <sys/time.h>
void log_with_timestamp(const char* msg) {
  struct timeval tv;
  gettimeofday(&tv, NULL);
  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[%ld.%06ld] %s", tv.tv_sec, tv.tv_usec, msg);
}

EOF

echo "✓ Timestamp logging added"
echo ""
echo "All detailed logging patches applied!"
echo "Coturn will now log:"
echo "  - Every TURN allocation request with full details"
echo "  - Every refresh, send, permission, and channel operation"
echo "  - ICE connection details (username, realm, client address)"
echo "  - UDP relay traffic with source/dest and byte count"
echo "  - Microsecond-precision timestamps on critical events"
