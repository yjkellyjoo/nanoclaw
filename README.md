<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoClaw" width="400">
</p>

<p align="center">
  An AI assistant that runs agents securely in their own containers, communicating over Status — the decentralized, end-to-end encrypted messenger built on Ethereum.
</p>

<p align="center">
  <a href="https://nanoclaw.dev">nanoclaw.dev</a>&nbsp; • &nbsp;
  <a href="README_zh.md">中文</a>&nbsp; • &nbsp;
  <a href="repo-tokens"><img src="repo-tokens/badge.svg" alt="34.9k tokens, 17% of context window" valign="middle"></a>
</p>

> **This is a fork of [NanoClaw](https://github.com/qwibitai/nanoclaw) that replaces WhatsApp with [Status](https://status.app) as the default messaging channel.** Everything else — containers, agent isolation, skills, scheduling — works the same.

## Why Status + NanoClaw

NanoClaw was built on a simple principle: you should be able to understand and trust every piece of software that has access to your life. Your AI assistant sees your messages, your files, your schedule. That's a lot of trust to place in a system — and the messaging layer is the weakest link.

**Status is the only messenger that matches NanoClaw's security philosophy:**

| | WhatsApp | Status |
|---|---|---|
| **Encryption** | E2E encrypted, but Meta holds metadata | E2E encrypted with no central server — messages relay through Waku, a decentralized p2p network |
| **Identity** | Tied to your phone number | A cryptographic keypair. No phone number, no email, no identity verification |
| **Metadata** | Meta knows who you talk to, when, how often, your IP, device info | No central party collects metadata. Nodes relay messages without knowing sender or recipient |
| **Infrastructure** | Centralized servers owned by Meta | Decentralized Waku network — no single point of failure or surveillance |
| **Open source** | Client is closed source | Fully open source, including the protocol |
| **Account recovery** | Tied to phone number (SIM swap risk) | You control your keys. No custodian, no recovery via social engineering |

When your AI assistant communicates over WhatsApp, Meta sees every message timestamp, every contact, every interaction pattern — even if they can't read the content. With Status, **no one sees anything**. Not even metadata.

NanoClaw already isolates your agents in containers so they can't touch your host system. Status extends that isolation to the network layer. Your AI conversations don't touch any corporate infrastructure. They flow through a censorship-resistant, decentralized protocol where the only people who can read your messages are you and your agent.

**This is what private AI should look like:** open source agent code you can audit, running in isolated containers you control, communicating over a decentralized protocol where no one — not a corporation, not a government, not even the network operators — can see who you're talking to or what you're saying.

## Quick Start

```bash
git clone https://github.com/yjkellyjoo/nanoclaw.git
cd nanoclaw
claude
```

Then run `/setup`. Claude Code handles everything: dependencies, Status authentication, container setup and service configuration.

### Status Setup

1. Install [Status Desktop](https://status.app/get) and create an account
2. Run `./scripts/status-login.sh` to authenticate NanoClaw with your Status account
3. Set your `STATUS_KEY_UID` in the environment (your Status public key)

That's it. No QR codes, no phone number verification, no Meta account required.

## Philosophy

**Small enough to understand.** One process, a few source files and no microservices. If you want to understand the full NanoClaw codebase, just ask Claude Code to walk you through it.

**Secure by isolation.** Agents run in Linux containers (Apple Container on macOS, or Docker) and they can only see what's explicitly mounted. Bash access is safe because commands run inside the container, not on your host.

**Private by default.** Status provides end-to-end encryption over a decentralized network. No phone number. No metadata collection. No corporate intermediary between you and your AI.

**Built for the individual user.** NanoClaw isn't a monolithic framework; it's software that fits each user's exact needs. Instead of becoming bloatware, NanoClaw is designed to be bespoke. You make your own fork and have Claude Code modify it to match your needs.

**Customization = code changes.** No configuration sprawl. Want different behavior? Modify the code. The codebase is small enough that it's safe to make changes.

**AI-native.**
- No installation wizard; Claude Code guides setup.
- No monitoring dashboard; ask Claude what's happening.
- No debugging tools; describe the problem and Claude fixes it.

**Skills over features.** Instead of adding features to the codebase, contributors submit [claude code skills](https://code.claude.com/docs/en/skills) that transform your fork. You end up with clean code that does exactly what you need, not a bloated system trying to support every use case.

**Best harness, best model.** NanoClaw runs on the Claude Agent SDK, which means you're running Claude Code directly. Claude Code is highly capable and its coding and problem-solving capabilities allow it to modify and expand NanoClaw and tailor it to each user.

## What It Supports

- **Status Messenger I/O** - Message NanoClaw from your phone or desktop over Status's decentralized, end-to-end encrypted network. No phone number required.
- **Isolated group context** - Each group has its own `CLAUDE.md` memory, isolated filesystem, and runs in its own container sandbox with only that filesystem mounted to it.
- **Main channel** - Your private channel for admin control; every group is completely isolated
- **Scheduled tasks** - Recurring jobs that run Claude and can message you back
- **Web access** - Search and fetch content from the Web
- **Container isolation** - Agents are sandboxed in Apple Container (macOS) or Docker (macOS/Linux)
- **Agent Swarms** - Spin up teams of specialized agents that collaborate on complex tasks. NanoClaw is the first personal AI assistant to support agent swarms.
- **Optional integrations** - Add Gmail (`/add-gmail`) and more via skills

## Usage

Talk to your assistant with the trigger word (default: `@Andy`):

```
@Andy send an overview of the sales pipeline every weekday morning at 9am (has access to my Obsidian vault folder)
@Andy review the git history for the past week each Friday and update the README if there's drift
@Andy every Monday at 8am, compile news on AI developments from Hacker News and TechCrunch and message me a briefing
```

From the main channel (your self-chat), you can manage groups and tasks:
```
@Andy list all scheduled tasks across groups
@Andy pause the Monday briefing task
@Andy join the Family Chat group
```

## Customizing

NanoClaw doesn't use configuration files. To make changes, just tell Claude Code what you want:

- "Change the trigger word to @Bob"
- "Remember in the future to make responses shorter and more direct"
- "Add a custom greeting when I say good morning"
- "Store conversation summaries weekly"

Or run `/customize` for guided changes.

The codebase is small enough that Claude can safely modify it.

## Contributing

**Don't add features. Add skills.**

Instead of creating PRs that modify core code, contribute a skill file (`.claude/skills/your-skill/SKILL.md`) that teaches Claude Code how to transform a NanoClaw installation.

Users then run your skill on their fork and get clean code that does exactly what they need, not a bloated system trying to support every use case.

### RFS (Request for Skills)

Skills we'd like to see:

**Status Workflow**
- `/status-message-cleanup` - Add message normalization and cleanup rules for Status chats

**Session Management**
- `/clear` - Add a `/clear` command that compacts the conversation (summarizes context while preserving critical information in the same session). Requires figuring out how to trigger compaction programmatically via the Claude Agent SDK.

## Requirements

- macOS or Linux
- Node.js 20+
- [Claude Code](https://claude.ai/download)
- [Status Desktop](https://status.app/get) (for authentication)
- [Apple Container](https://github.com/apple/container) (macOS) or [Docker](https://docker.com/products/docker-desktop) (macOS/Linux)

## Architecture

```
Status (WebSocket) --> SQLite --> Polling loop --> Container (Claude Agent SDK) --> Response
```

Single Node.js process. NanoClaw connects to Status via its local WebSocket API, stores messages in SQLite, and dispatches agents in isolated Linux containers. Only mounted directories are accessible. Per-group message queue with concurrency control. IPC via filesystem.

Key files:
- `src/index.ts` - Orchestrator: state, message loop, agent invocation
- `src/channels/status.ts` - Status connection, auth, send/receive
- `src/status-api.ts` - Status Desktop WebSocket API client
- `src/trigger.ts` - Message trigger detection
- `src/ipc.ts` - IPC watcher and task processing
- `src/router.ts` - Message formatting and outbound routing
- `src/group-queue.ts` - Per-group queue with global concurrency limit
- `src/container-runner.ts` - Spawns streaming agent containers
- `src/task-scheduler.ts` - Runs scheduled tasks
- `src/db.ts` - SQLite operations (messages, groups, sessions, state)
- `groups/*/CLAUDE.md` - Per-group memory

## FAQ

**Why Status instead of WhatsApp?**

Because privacy isn't just about encrypting message content — it's about who can see that you're communicating at all. WhatsApp encrypts your messages but hands Meta your contact graph, message timestamps, IP address, and device fingerprint. Status uses a decentralized peer-to-peer network where no single entity can observe your communication patterns. For an AI assistant that sees your most personal data, that matters.

**Why Docker?**

Docker provides cross-platform support (macOS, Linux and even Windows via WSL2) and a mature ecosystem. On macOS, you can optionally switch to Apple Container via `/convert-to-apple-container` for a lighter-weight native runtime.

**Can I run this on Linux?**

Yes. Docker is the default runtime and works on both macOS and Linux. Just run `/setup`.

**Is this secure?**

Agents run in containers, not behind application-level permission checks. They can only access explicitly mounted directories. Messages flow over Status's decentralized, end-to-end encrypted network. You should still review what you're running, but the codebase is small enough that you actually can. See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

**Can I switch back to WhatsApp?**

This fork is Status-only by design. If you want WhatsApp, use the [upstream NanoClaw](https://github.com/qwibitai/nanoclaw). If you want both, fork upstream and run `/add-telegram` or build a multi-channel skill.

**Why no configuration files?**

We don't want configuration sprawl. Every user should customize NanoClaw so that the code does exactly what they want, rather than configuring a generic system. If you prefer having config files, you can tell Claude to add them.

**How do I debug issues?**

Ask Claude Code. "Why isn't the scheduler running?" "What's in the recent logs?" "Why did this message not get a response?" That's the AI-native approach that underlies NanoClaw.

**Why isn't the setup working for me?**

If you have issues, during setup, Claude will try to dynamically fix them. If that doesn't work, run `claude`, then run `/debug`. If Claude finds an issue that is likely affecting other users, open a PR to modify the setup SKILL.md.

**What changes will be accepted into the codebase?**

Only security fixes, bug fixes, and clear improvements will be accepted to the base configuration. That's all.

Everything else (new capabilities, OS compatibility, hardware support, enhancements) should be contributed as skills.

This keeps the base system minimal and lets every user customize their installation without inheriting features they don't want.

## Community

Questions? Ideas? [Join the Discord](https://discord.gg/VDdww8qS42).

## License

MIT
