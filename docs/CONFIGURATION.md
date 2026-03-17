# Configuration Guide

This document describes the environment variables and configuration options for NanoClaw with Status integration.

## Environment Variables

### Status Integration

All Status-related configuration should be set in your `.env` file in the project root.

#### Required Variables

- `STATUS_KEY_UID` - Your Status account key UID (public key identifier)
  - Obtained from Status Desktop after creating an account
  - Example: `0x04a1b2c3...`

- `STATUS_PASSWORD` - Password for your Status account
  - Set when creating your Status account
  - Used for authentication with the Status backend

#### Optional Variables

- `STATUS_PORT` - Port for Status backend WebSocket API (default: `21405`)
- `STATUS_DATA_DIR` - Directory where Status stores account data
  - Default: `~/.status-backend/data` (user's home directory)
- `STATUS_ENV_FILE` - Path to .env file with Status credentials
  - Default: `.env` in project root

### Script Configuration

The restart and login scripts support these environment variables for flexibility:

- `NANOCLAW_PROJECT_DIR` - Path to the NanoClaw project directory
  - Default: Auto-detected from script location
  - Override if running scripts from a non-standard location

## Script Paths

The following scripts are available in the `scripts/` directory:

- `status-login.sh` - Authenticates with Status backend after it starts
- `restart-status-nanoclaw.sh` - Restarts Status services and NanoClaw

These scripts automatically detect the project directory based on their location. You can override this by setting `NANOCLAW_PROJECT_DIR`.

### Example Usage

```bash
# Use default paths (auto-detected)
./scripts/status-login.sh

# Override project directory
NANOCLAW_PROJECT_DIR=/custom/path/to/nanoclaw ./scripts/status-login.sh
```

## Setup Checklist

1. Install Status ([Desktop](https://status.app/get) or [Mobile](https://status.app/get)) and create an account
2. Save your recovery phrase securely offline
3. Copy `.env.example` to `.env` in the project root
4. Set `STATUS_KEY_UID` and `STATUS_PASSWORD` in `.env`
5. Run `/setup` via Claude Code to complete installation
6. Run `./scripts/status-login.sh` to authenticate

## Security Notes

- Never commit your `.env` file to version control (it's in `.gitignore`)
- Store your Status recovery phrase securely offline
- The `STATUS_PASSWORD` is stored locally and never transmitted to any third party
- All credentials are used only to authenticate with your local Status backend instance
