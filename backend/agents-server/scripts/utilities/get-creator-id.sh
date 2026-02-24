#!/bin/bash

# Generate a unique, stable creator ID based on system characteristics
# This ID will be the same across reboots but different per machine/user

# Load .env file if it exists
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

get_creator_id() {
    echo $MACHINE_CREATOR_ID
}

# If called directly, output the creator ID
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    get_creator_id
fi