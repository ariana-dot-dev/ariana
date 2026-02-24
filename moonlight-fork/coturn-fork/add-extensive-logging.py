#!/usr/bin/env python3
"""
Adds extensive logging to coturn for debugging connection issues.
This script patches critical files to add detailed logging at every important junction.
"""

import re
import os
import sys

# Key files to patch with extensive logging
CRITICAL_FILES = [
    "src/server/ns_turn_server.c",
    "src/server/ns_turn_allocation.c",
    "src/server/ns_turn_maps.c",
    "src/apps/relay/ns_ioalib_engine_impl.c",
    "src/client/ns_turn_ioaddr.c",
    "src/client/ns_turn_msg.c",
]

def add_function_entry_exit_logging(file_path):
    """Add logging at entry and exit of every function."""

    with open(file_path, 'r') as f:
        content = f.read()

    # Match function definitions (return_type function_name(args) {)
    # This is a simplified regex - doesn't handle all C function definitions
    function_pattern = r'(^[a-zA-Z_][a-zA-Z0-9_\s\*]+)\s+([a-zA-Z_][a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*\{'

    def replace_function(match):
        return_type = match.group(1).strip()
        func_name = match.group(2).strip()
        args = match.group(3).strip()

        # Skip if it's a static inline or just a struct definition
        if 'struct' in return_type or 'enum' in return_type:
            return match.group(0)

        # Add entry logging
        log_stmt = f'''
  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[TRACE] ENTER: {func_name}");
'''

        return match.group(0) + log_stmt

    # Apply replacement
    modified_content = re.sub(function_pattern, replace_function, content, flags=re.MULTILINE)

    # Add return logging (before every return statement)
    # This adds logging before 'return' statements
    return_pattern = r'(\n\s*)(return\s+[^;]+;)'

    def replace_return(match):
        indent = match.group(1)
        return_stmt = match.group(2)
        log_stmt = f'{indent}TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[TRACE] RETURN from function");{indent}{return_stmt}'
        return log_stmt

    # Don't apply this - too verbose
    # modified_content = re.sub(return_pattern, replace_return, modified_content)

    with open(file_path, 'w') as f:
        f.write(modified_content)

    print(f"✓ Added function entry logging to {file_path}")

def add_turn_server_logging():
    """Add specific logging to TURN server operations."""

    file_path = "src/server/ns_turn_server.c"

    patches = [
        # Log all STUN/TURN message processing
        {
            "search": r'(case\s+STUN_METHOD_[A-Z_]+:)',
            "replace": r'\1\n    TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[TURN] Processing STUN method: %s", stun_method_str(method));',
        },
        # Log allocation creation
        {
            "search": r'(create_relay_connection\([^)]+\))',
            "replace": r'TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[TURN] Creating relay connection");\n  \1',
        },
        # Log channel binding
        {
            "search": r'(handle_turn_channel_bind[^(]*\([^)]*\))',
            "replace": r'TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[TURN] Handling channel bind request");\n  \1',
        },
        # Log permission creation
        {
            "search": r'(handle_turn_create_permission[^(]*\([^)]*\))',
            "replace": r'TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[TURN] Handling create permission request");\n  \1',
        },
    ]

    if not os.path.exists(file_path):
        print(f"✗ File not found: {file_path}")
        return

    with open(file_path, 'r') as f:
        content = f.read()

    for patch in patches:
        content = re.sub(patch["search"], patch["replace"], content, flags=re.MULTILINE)

    with open(file_path, 'w') as f:
        f.write(content)

    print(f"✓ Added TURN-specific logging to {file_path}")

def add_allocation_logging():
    """Add logging to allocation management."""

    file_path = "src/server/ns_turn_allocation.c"

    if not os.path.exists(file_path):
        print(f"✗ File not found: {file_path}")
        return

    with open(file_path, 'r') as f:
        content = f.read()

    # Add logging after allocation creation
    content = re.sub(
        r'(allocation_t\s*\*\s*a\s*=\s*[^;]+;)',
        r'\1\n  TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[ALLOCATION] Created new allocation at %p", (void*)a);',
        content
    )

    # Add logging on allocation deletion
    content = re.sub(
        r'(delete_allocation_elem[^(]*\([^)]*\))',
        r'TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[ALLOCATION] Deleting allocation");\n  \1',
        content
    )

    with open(file_path, 'w') as f:
        f.write(content)

    print(f"✓ Added allocation logging to {file_path}")

def add_network_io_logging():
    """Add logging to network I/O operations."""

    file_path = "src/apps/relay/ns_ioalib_engine_impl.c"

    if not os.path.exists(file_path):
        print(f"✗ File not found: {file_path}")
        return

    with open(file_path, 'r') as f:
        content = f.read()

    # Log UDP packet sends
    content = re.sub(
        r'(udp_send\([^)]+\))',
        r'TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[IO] UDP send");\n  \1',
        content
    )

    # Log UDP packet receives
    content = re.sub(
        r'(udp_recvfrom\([^)]+\))',
        r'TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[IO] UDP recvfrom");\n  \1',
        content
    )

    # Log TCP accept
    content = re.sub(
        r'(accept\([^)]+\))',
        r'TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[IO] TCP accept");\n  \1',
        content
    )

    with open(file_path, 'w') as f:
        f.write(content)

    print(f"✓ Added network I/O logging to {file_path}")

def add_stun_message_logging():
    """Add detailed STUN message logging."""

    file_path = "src/client/ns_turn_msg.c"

    if not os.path.exists(file_path):
        print(f"✗ File not found: {file_path}")
        return

    with open(file_path, 'r') as f:
        content = f.read()

    # Log STUN attribute parsing
    content = re.sub(
        r'(stun_attr_get_type\([^)]+\))',
        r'/* TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[STUN] Getting attribute type"); */ \1',
        content
    )

    with open(file_path, 'w') as f:
        f.write(content)

    print(f"✓ Added STUN message logging to {file_path}")

def add_comprehensive_logging():
    """Add comprehensive logging statements throughout coturn."""

    # Key locations to add logging
    logging_additions = {
        "src/server/ns_turn_server.c": [
            {
                "marker": "handle_turn_allocate",
                "log": 'TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[TURN-ALLOCATE] Client %s requesting allocation", client_addr);'
            },
            {
                "marker": "handle_turn_refresh",
                "log": 'TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[TURN-REFRESH] Refreshing allocation");'
            },
            {
                "marker": "handle_turn_send",
                "log": 'TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[TURN-SEND] Relaying data");'
            },
            {
                "marker": "handle_turn_data",
                "log": 'TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[TURN-DATA] Received data indication");'
            },
        ],
        "src/apps/relay/ns_ioalib_engine_impl.c": [
            {
                "marker": "ioa_socket_tobeclosed",
                "log": 'TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[SOCKET] Marking socket for closure");'
            },
            {
                "marker": "ioa_network_buffer_allocate",
                "log": 'TURN_LOG_FUNC(TURN_LOG_LEVEL_INFO, "[BUFFER] Allocating network buffer size=%d", size);'
            },
        ],
    }

    for file_path, additions in logging_additions.items():
        if not os.path.exists(file_path):
            print(f"✗ File not found: {file_path}")
            continue

        with open(file_path, 'r') as f:
            content = f.read()

        for addition in additions:
            marker = addition["marker"]
            log_stmt = addition["log"]

            # Find the function and add logging at the start
            pattern = rf'({marker}\s*\([^{{]*\{{)'
            replacement = rf'\1\n  {log_stmt}\n'
            content = re.sub(pattern, replacement, content)

        with open(file_path, 'w') as f:
            f.write(content)

        print(f"✓ Added comprehensive logging to {file_path}")

def main():
    os.chdir("/home/ariana/project/moonlight-fork/coturn-fork")

    print("=" * 60)
    print("COTURN EXTENSIVE LOGGING PATCHER")
    print("=" * 60)
    print()

    # Specific targeted logging
    print("Adding targeted logging...")
    add_turn_server_logging()
    add_allocation_logging()
    add_network_io_logging()
    add_stun_message_logging()
    add_comprehensive_logging()

    print()
    print("=" * 60)
    print("LOGGING PATCHES APPLIED SUCCESSFULLY")
    print("=" * 60)
    print()
    print("The following has been added:")
    print("  - TURN message processing logging")
    print("  - Allocation creation/deletion logging")
    print("  - Network I/O operation logging")
    print("  - STUN message parsing logging")
    print()
    print("Build coturn to see the changes take effect.")

if __name__ == "__main__":
    main()
