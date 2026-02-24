---
name: lux
description: Control the desktop using AI vision (computer-use). Use for GUI automation, clicking buttons, typing in applications, and interacting with desktop software.
---

# LUX Computer-Use CLI

The `lux` CLI enables AI-powered desktop control. It takes screenshots, sends them to a vision AI, and executes the returned actions (clicks, typing, etc.) on your desktop.

**This is for GUI automation** - use it when you need to interact with graphical applications that can't be controlled via command line.

## Quick Start

```bash
# Start a session with a goal
lux start "Open Firefox and navigate to github.com"

# Run until the task is complete (or limit reached)
lux run --max-steps 10

# Or run step-by-step for more control
lux step   # Take screenshot, get actions, execute
lux step   # Repeat until done
lux end    # End session when finished
```

## Commands

### lux start \<task\>

Start a new computer-use session with a goal description.

```bash
lux start "Click the Settings icon and enable dark mode"
lux start "Open the terminal and run htop"
lux start "Fill out the login form with username 'test'"
```

Options:
- `--model <model>` - AI model: `auto` (default), `lux-actor-1` (fast), or `lux-thinker-1` (complex tasks)
- `--max-steps <n>` - Maximum steps (default: 20 for actor, 100 for thinker)

Model selection in `auto` mode (the default):
- **Actor** is picked for short, direct tasks like "click X", "open Y", "type Z"
- **Thinker** is picked for complex/vague/multi-step goals like "research X and compare Y"
- You can always override with `--model lux-actor-1` or `--model lux-thinker-1`

### lux step

Execute one step: takes a screenshot, sends it to the AI, and executes the returned actions.

```bash
lux step
```

This is useful when you want to observe each step or intervene between actions.

### lux run

Run steps continuously until the task is complete or the limit is reached.

```bash
lux run                    # Run up to 20 steps
lux run --max-steps 10     # Run up to 10 steps
```

### lux end

End the current session early.

```bash
lux end
```

### lux status

Show your usage and limits.

```bash
lux status
```

## Action Types

The AI returns actions that are executed on your desktop:

| Action | Description | Example Argument |
|--------|-------------|------------------|
| `click` | Single left click | `"512, 384"` (normalized 0-1000) |
| `left_double` | Double click | `"512, 384"` |
| `right_single` | Right click | `"512, 384"` |
| `drag` | Click and drag | `"100, 100, 500, 500"` (start to end) |
| `type` | Type text | `"Hello World"` |
| `hotkey` | Press key combination | `"ctrl+c"`, `"alt+tab"` |
| `scroll` | Scroll in direction | `"up"`, `"down"`, `"left"`, `"right"` |
| `wait` | Pause execution | `"1000"` (milliseconds) |
| `finish` | Task completed | - |
| `call_user` | Need human help | `"Please enter password"` |

## Best Practices

### 1. Write Clear Task Descriptions

Be specific about what you want to accomplish:

```bash
# Good - specific and actionable
lux start "Click the blue 'Submit' button in the form"

# Bad - vague
lux start "Submit the form"
```

### 2. Use Step-by-Step for Debugging

When things don't work as expected, use `lux step` to see what the AI is doing:

```bash
lux start "Navigate to settings"
lux step   # See what it clicks
lux step   # Continue manually
```

### 3. End Sessions When Done

Always end sessions to free up resources:

```bash
lux end
```

### 4. Check Status for Limits

Monitor your usage:

```bash
lux status
```

## Examples

### Open a Browser and Navigate

```bash
lux start "Open Firefox and go to https://github.com"
lux run --max-steps 5
```

### Fill Out a Form

```bash
lux start "Fill in the username field with 'testuser' and click Login"
lux run
```

### Use Desktop Applications

```bash
lux start "Open the file manager and navigate to Documents folder"
lux run --max-steps 10
```

### Complex Multi-Step Tasks

For complex tasks, use `lux-thinker-1` model:

```bash
lux start "Open VS Code, create a new file called test.py, and write a hello world program" --model lux-thinker-1
lux run --max-steps 20
```

## Limitations

- **Rate Limited**: 20 sessions/day, 50 steps/session (configurable by platform)
- **Screenshot-Based**: AI only sees what's on screen
- **Timing**: UI may need time to respond between actions
- **No Authentication**: Can't access protected content without credentials already entered

## Troubleshooting

### "No active session"

Start a session first:
```bash
lux start "your task here"
```

### "Session not found or expired"

Sessions expire after 30 minutes of inactivity. Start a new one:
```bash
lux start "your task here"
```

### "Step limit reached"

You've hit the per-session limit. End and start a new session:
```bash
lux end
lux start "continue from where I left off"
```

### Actions not working

The AI might misidentify UI elements. Try being more specific:
```bash
lux start "Click the green button labeled 'Save' in the bottom right corner"
```

## Security Notes

- Screenshots are sent to backend over encrypted connection
- LUX API key is stored on backend, never on your machine
- Sessions are tied to your agent identity via JWT
- All usage is logged for rate limiting and auditing
