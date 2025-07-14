#!/bin/bash

# Database Server SSH Connection Script
# This script connects to the OVH Debian machine using environment variables

# Load environment variables from .env file
if [ -f "../backend/.env" ]; then
    export $(cat ../backend/.env | grep -v '#' | xargs)
elif [ -f ".env" ]; then
    export $(cat .env | grep -v '#' | xargs)
else
    echo "Error: .env file not found"
    exit 1
fi

# Check if required environment variables are set
if [ -z "$SSH_HOST" ] || [ -z "$SSH_PORT" ] || [ -z "$SSH_USER" ]; then
    echo "Error: Required SSH environment variables not set"
    echo "Please ensure SSH_HOST, SSH_PORT, and SSH_USER are defined in .env"
    exit 1
fi

# Connect to the server
echo "Connecting to ${SSH_USER}@${SSH_HOST}:${SSH_PORT}"
ssh -p ${SSH_PORT} ${SSH_USER}@${SSH_HOST}