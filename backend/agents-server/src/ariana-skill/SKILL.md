---
name: ariana
description: Manage other Ariana agents and configure your own environment/automations. Use for spawning agents, sending tasks, checking status, and setting up automations.
---

# Ariana CLI

The `ariana` CLI runs on agent machines with a token scoped to your agent's context. It has two categories of commands:

- **Self commands**: Manage your own environment and automations
- **Orchestration commands**: Spawn and control other agents

## CRITICAL: Parallel Execution

**When spawning multiple agents, ALWAYS run spawn commands in parallel using `&`:**

```bash
# CORRECT - spawn 3 agents in parallel (fast)
ariana agent spawn --project $PROJECT --branch main --name "worker-1" &
ariana agent spawn --project $PROJECT --branch main --name "worker-2" &
ariana agent spawn --project $PROJECT --branch main --name "worker-3" &
wait  # wait for all background jobs to complete
```

```bash
# WRONG - spawning sequentially (slow, wasteful)
ariana agent spawn --project $PROJECT --branch main --name "worker-1"
ariana agent spawn --project $PROJECT --branch main --name "worker-2"
ariana agent spawn --project $PROJECT --branch main --name "worker-3"
```

**`spawn` returns immediately** - it does NOT wait for the agent to be ready. You can send prompts immediately - they queue and execute when the agent is ready. **There is almost never a reason to use `wait`.**

---

## Self Commands

These operate on your agent's project and user context.

### Environment

```bash
# Get your environment configuration
ariana env get

# Set your environment (reads JSON from stdin)
ariana env set < config.json
```

### Automations

```bash
# List your automations
ariana automations list

# Get automation details
ariana automations get <automation-id>

# Create an automation (reads JSON from stdin)
ariana automations create < automation.json

# Update an automation
ariana automations update <automation-id> < automation.json

# Delete an automation
ariana automations delete <automation-id>
```

---

## Orchestration Commands

These manage other agents. Agent ID is optional - if omitted, uses the last agent you interacted with or your most recently created agent.

### Listing & Querying

```bash
# List agents
ariana agents list
ariana agents list --project <project-id>

# Get agent details
ariana agents get [<agent-id>]

# List projects
ariana projects list

# Get conversation history
ariana agent conversation [<agent-id>]
ariana agent conversation [<agent-id>] --limit 10
```

### Creating Agents

**Each agent runs on its own isolated machine (VPS).** Choose the right command:

- **`spawn`** - Create a fresh agent from a git branch. Use this for new work.
- **`fork`** - Clone an existing agent's entire disk state (snapshot). Use this to duplicate an agent's progress. You can fork yourself (`ariana agent fork $AGENT_ID`) to create agents that inherit your full context, conversation history, and disk state — this is the right way to "multiply yourself" for parallel work.

```bash
# Spawn: fresh agent from git branch (most common)
ariana agent spawn --project <project-id> --branch main --name "feature-worker"
ariana agent spawn --project <project-id> --branch feature/foo --name "foo-worker"

# Fork: copy another agent's disk state (NOT git fork!)
# Use when you want to duplicate an agent's work-in-progress
ariana agent fork <source-agent-id> --name "forked-worker"
```

**Note:** Both return immediately. Prompts queue automatically - no need to wait.

### Controlling Agents

```bash
# Send a task (prompts queue automatically)
ariana agent prompt [<agent-id>] "implement the login feature"
ariana agent prompt [<agent-id>] "fix the bug" --model opus

# Interrupt current work and send new task
ariana agent prompt [<agent-id>] "new urgent task" --interrupt

# Stop a running agent
ariana agent interrupt [<agent-id>]

# Rename an agent
ariana agent rename [<agent-id>] "new-name"
```

---

## Key Behaviors

### Prompt Queuing
Prompts are automatically queued. Send a prompt even if the agent is busy - it will be processed when the current task finishes. Use `--interrupt` to stop current work immediately.

### Agent ID Auto-Selection
When you omit the agent ID, the CLI:
1. Uses the last agent you interacted with on this machine
2. Falls back to your most recently created agent

The CLI prints which agent was selected before executing.

### Model Selection
Use `--model opus` for complex tasks, `--model haiku` for simple ones. Default is `sonnet`.

---

## Agent States

- `provisioning` - Machine being allocated
- `cloning` - Repository being cloned
- `ready` - Ready to receive prompts
- `running` - Currently executing a task
- `idle` - Finished task, waiting for next prompt
- `archived` - Agent archived
- `error` - Something went wrong

---

## Environment Configuration

Environments provide variables and files to your agent.

### JSON Schema

```json
{
  "name": "my-environment",
  "envContents": "API_KEY=xxx\nDATABASE_URL=postgres://...",
  "secretFiles": [
    {
      "path": ".config/credentials.json",
      "contents": "{\"token\": \"...\"}"
    }
  ],
  "sshKeyPair": {
    "publicKey": "ssh-ed25519 AAAA...",
    "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
    "keyName": "id_ed25519"
  }
}
```

**Fields:**
- `name` - Environment name (unique per user+project)
- `envContents` - Variables in `.env` format (KEY=value per line)
- `secretFiles` - Files written to project directory (paths relative to project root)
- `sshKeyPair` - SSH keypair deployed to `~/.ssh/{keyName}` (for git auth)

---

## Automation Configuration

Automations run scripts when events occur on your agent.

### JSON Schema

```json
{
  "name": "run-tests-before-commit",
  "trigger": {
    "type": "on_before_commit"
  },
  "scriptLanguage": "bash",
  "scriptContent": "npm test",
  "blocking": true,
  "feedOutput": true
}
```

**Fields:**
- `name` - Automation name (unique per user+project)
- `trigger` - When to run (see trigger types below)
- `scriptLanguage` - `"bash"`, `"javascript"`, or `"python"`
- `scriptContent` - Your script code
- `blocking` - If true, agent waits for completion
- `feedOutput` - If true, output becomes agent context

### Trigger Types

| Type | Description | Filter |
|------|-------------|--------|
| `manual` | Manual trigger only | - |
| `on_agent_ready` | Agent becomes idle | - |
| `on_before_commit` | Before commit (always blocking) | - |
| `on_after_commit` | After commit | - |
| `on_after_edit_files` | After editing files | `fileGlob` |
| `on_after_read_files` | After reading files | `fileGlob` |
| `on_after_run_command` | After bash command | `commandRegex` |
| `on_before_push_pr` | Before PR push (always blocking) | - |
| `on_after_push_pr` | After PR pushed | - |
| `on_after_reset` | After agent reset | - |
| `on_automation_finishes` | After another automation | `automationId` |

### Trigger Examples

```json
{ "type": "on_after_edit_files", "fileGlob": "*.ts" }
{ "type": "on_after_run_command", "commandRegex": "^npm " }
{ "type": "on_automation_finishes", "automationId": "automation_abc123" }
```

### Available Variables

Scripts have access to these environment variables:

| Variable | Description |
|----------|-------------|
| `INPUT_FILE_PATH` | File being edited/read |
| `INPUT_COMMAND` | Bash command executed |
| `CURRENT_COMMIT_SHA` | Git commit hash |
| `CURRENT_COMMIT_CHANGES` | Diff of current commit |
| `CURRENT_PENDING_CHANGES` | Uncommitted changes |
| `ENTIRE_AGENT_DIFF` | All changes since agent started |
| `LAST_PROMPT` | Most recent user prompt |
| `GITHUB_TOKEN` | GitHub auth token |
| `LAST_SCRIPT_OUTPUT` | Previous automation output |

### Control Functions

Scripts can control the agent:

**Bash:**
```bash
echo "ARIANA_CONTROL:STOP_AGENT"
echo "ARIANA_CONTROL:QUEUE_PROMPT:Review the failing tests"
```

**JavaScript/Python:**
```javascript
stopAgent();
queuePrompt("Review the failing tests");
```

### Example Automations

**Pre-commit tests:**
```json
{
  "name": "pre-commit-tests",
  "trigger": { "type": "on_before_commit" },
  "scriptLanguage": "bash",
  "scriptContent": "npm test",
  "blocking": true,
  "feedOutput": true
}
```

**Lint on edit:**
```json
{
  "name": "lint-typescript",
  "trigger": { "type": "on_after_edit_files", "fileGlob": "*.ts" },
  "scriptLanguage": "bash",
  "scriptContent": "npx eslint $INPUT_FILE_PATH --fix",
  "blocking": false,
  "feedOutput": false
}
```

### Important Notes

- `on_before_commit` and `on_before_push_pr` must have `blocking: true`
- Exit code 0 = success; non-zero = failure (blocks commit/PR for "before" triggers)
- Script output limited to 1000 lines
