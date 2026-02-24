# Ralph Mode Data Flow

## Activation Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  User clicks "Ralph Mode" in modes dropdown                                  │
│                    │                                                         │
│                    ▼                                                         │
│  ┌────────────────────────────────┐                                         │
│  │     RalphModeDialog.tsx        │                                         │
│  │  - User enters task description│                                         │
│  │  - Clicks "Start Ralph Mode"   │                                         │
│  └────────────────┬───────────────┘                                         │
│                   │                                                          │
│                   ▼                                                          │
│  ┌────────────────────────────────┐                                         │
│  │  agent.service.ts              │                                         │
│  │  startRalphMode(agentId, task) │                                         │
│  └────────────────┬───────────────┘                                         │
│                   │                                                          │
│                   │ POST /api/agents/{id}/ralph-mode/start                   │
│                   │ body: { taskDescription }                                │
│                   ▼                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────┐                                         │
│  │  routes.ts                     │                                         │
│  │  handleStartRalphMode()        │                                         │
│  └────────────────┬───────────────┘                                         │
│                   │                                                          │
│                   ▼                                                          │
│  ┌────────────────────────────────────────────────────────────────┐         │
│  │  ralph-mode-handlers.ts :: handleStartRalphMode()              │         │
│  │                                                                 │         │
│  │  1. Check write access                                          │         │
│  │  2. Verify agent exists                                         │         │
│  │  3. Call executeRalphModeSetup() ─────────────────────────────────────┐  │
│  │  4. If agent not idle → interruptAgent()                        │     │  │
│  │  5. Update DB: inRalphMode=true, ralphModeTaskDescription=task  │     │  │
│  │  6. Call queueRalphModeInitialPrompt() ───────────────────────────┐   │  │
│  │  7. Return success                                              │ │   │  │
│  └─────────────────────────────────────────────────────────────────┘ │   │  │
│                                                                       │   │  │
│  ┌────────────────────────────────────────────────────────────────┐  │   │  │
│  │  agent.service.ts :: queueRalphModeInitialPrompt()             │◄─┘   │  │
│  │                                                                 │      │  │
│  │  1. Get last prompt model (opus/sonnet/haiku)                   │      │  │
│  │  2. Build ralph mode prompt message                             │      │  │
│  │  3. queuePrompt() → inserts into AgentPrompt table              │      │  │
│  └─────────────────────────────────────────────────────────────────┘      │  │
│                                                                            │  │
│  ┌────────────────────────────────────────────────────────────────┐       │  │
│  │  agent.service.ts :: executeRalphModeSetup()                   │◄──────┘  │
│  │                                                                 │         │
│  │  sendToAgentServer(machineId, '/ralph-mode-setup', {task}) ───────────────┤
│  └─────────────────────────────────────────────────────────────────┘         │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                    │
                    │ POST /ralph-mode-setup (encrypted)
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AGENTS-SERVER                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────┐         │
│  │  ralphModeSetup.ts                                              │         │
│  │                                                                 │         │
│  │  1. Decrypt request                                             │         │
│  │  2. mkdir ~/.ariana-ralph-notes/                                │         │
│  │  3. Create .task-lock (empty file)                              │         │
│  │  4. Create README.md with task description template             │         │
│  │  5. Return { success: true }                                    │         │
│  └─────────────────────────────────────────────────────────────────┘         │
│                                                                              │
│  Files created on agent machine:                                             │
│  ~/.ariana-ralph-notes/                                                      │
│  ├── .task-lock          (empty - signals ralph mode active)                 │
│  └── README.md           (task description + template)                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Execution Loop Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  claude-agent.service.ts :: pollAgentState() [every 3 seconds]      │    │
│  │                                                                      │    │
│  │  Checks agent state, processes prompts from queue                    │    │
│  └──────────────────────────────┬──────────────────────────────────────┘    │
│                                 │                                            │
│                                 │ When IDLE + queued prompt exists           │
│                                 ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  IDLE → RUNNING transition                                           │    │
│  │                                                                      │    │
│  │  1. Mark prompt as 'running'                                         │    │
│  │  2. updateState(RUNNING)                                             │    │
│  │  3. sendToAgentServer('/prompt', { prompt, model }) ─────────────────────┤
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                    │
                    │ POST /prompt (encrypted)
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AGENTS-SERVER                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  prompt.ts                                                           │    │
│  │                                                                      │    │
│  │  1. Send prompt to Claude SDK                                        │    │
│  │  2. Claude works on task (reads ~/.ariana-ralph-notes/README.md)     │    │
│  │  3. Claude uses tools (Read, Edit, Bash, etc.)                       │    │
│  │  4. Claude updates documentation in ~/.ariana-ralph-notes/           │    │
│  │  5. If done/stuck: Claude deletes .task-lock                         │    │
│  │  6. claudeReadyForPrompt = true                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                    │
                    │ /claude-state returns { isReady: true }
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  claude-agent.service.ts :: pollAgentState()                        │    │
│  │                                                                      │    │
│  │  Agent is RUNNING, claude is ready:                                  │    │
│  │  1. createCheckpointForTask() (auto-commit)                          │    │
│  │  2. finishRunningPromptsForAgent()                                   │    │
│  │  3. updateState(IDLE)                                                │    │
│  │  4. ──► onAgentBecameIdle(agentId) ◄── CALLBACK                      │    │
│  └──────────────────────────────┬──────────────────────────────────────┘    │
│                                 │                                            │
│                                 ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  agent.service.ts :: handleAgentBecameIdle()                        │    │
│  │                                                                      │    │
│  │  if (agent.inRalphMode):                                             │    │
│  │    1. sendToAgentServer('/reset') → clear memory ─────────────────────────┤
│  │    2. Build ralph mode prompt                                        │    │
│  │    3. queuePrompt() → inserts into AgentPrompt table                 │    │
│  │                                                                      │    │
│  │  ──► Loop continues: prompt picked up, sent, executed...            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                    │
                    │ POST /reset (encrypted)
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AGENTS-SERVER                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  reset.ts                                                            │    │
│  │                                                                      │    │
│  │  claudeService.resetConversation()                                   │    │
│  │  - Moves current messages to pastConversations                       │    │
│  │  - Clears session ID                                                 │    │
│  │  - Next prompt starts fresh context                                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Termination Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  agent.service.ts :: expiration check [every 30 seconds]            │    │
│  │                                                                      │    │
│  │  for each agent with inRalphMode=true:                               │    │
│  │    sendToAgentServer('/ralph-mode-check-lock') ───────────────────────────┤
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                    │
                    │ POST /ralph-mode-check-lock (encrypted)
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AGENTS-SERVER                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  ralphModeCheckLock.ts                                               │    │
│  │                                                                      │    │
│  │  try { fs.access('~/.ariana-ralph-notes/.task-lock') }               │    │
│  │  return { exists: true/false }                                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────┬───────────────────────────────────────────────────────────┘
                  │
                  │ If exists=false (agent deleted the lock file)
                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  agent.service.ts :: expiration check                               │    │
│  │                                                                      │    │
│  │  updateAgentFields(agentId, {                                        │    │
│  │    inRalphMode: false,                                               │    │
│  │    ralphModeTaskDescription: null,                                   │    │
│  │    ralphModeLastPromptAt: null                                       │    │
│  │  })                                                                  │    │
│  │                                                                      │    │
│  │  ──► Ralph mode ended, agent stays idle                              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘


                         ┌─────────────────────┐
                         │  OR: User clicks    │
                         │  Stop in UI         │
                         └──────────┬──────────┘
                                    │
                                    ▼
                    POST /api/agents/{id}/ralph-mode/stop
                                    │
                                    ▼
                    handleStopRalphMode() clears DB fields
                    Agent stays idle, no more prompts queued
```

## Database Tables Involved

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Agent Table                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  id                          │ agent UUID                                    │
│  state                       │ 'idle' | 'running' | ...                      │
│  inRalphMode                 │ Boolean - true when ralph mode active         │
│  ralphModeTaskDescription    │ String - user's task description              │
│  ralphModeLastPromptAt       │ DateTime - (unused, for future throttling)    │
│  machineId                   │ String - for sendToAgentServer calls          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           AgentPrompt Table                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  id                          │ prompt UUID                                   │
│  agentId                     │ FK to Agent                                   │
│  prompt                      │ The ralph mode prompt text                    │
│  status                      │ 'queued' → 'running' → 'finished'             │
│  model                       │ 'opus' | 'sonnet' | 'haiku'                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files on Agent Machine

```
~/.ariana-ralph-notes/
├── .task-lock              # Empty file, presence = ralph mode active
│                           # Agent deletes this when done or stuck
│
└── README.md               # Task documentation maintained by agent
                            # Contains:
                            # - Task description
                            # - Validation criteria
                            # - Work log
                            # - Links to other .md files for details
```

## The Ralph Mode Prompt

Sent on activation and after each RUNNING→IDLE transition:

```
you are in autonomous mode, the human in the loop is away and it's for you to figure things out
regarding your current task:
- ensure it's documented in README.md and other interconnected .md files under ~/.ariana-ralph-notes/,
  with the README acting mostly as a good starting point, and other files diving into specifics
1. ensure the README.md clearly explains or links to files explaining:
 - what is the task about
 - how to iterate on the task
 - what are the validation criterias (and which one got validated already)
 - what's the last few units of work done
 - (all the above in a concise and noise/bs-free way)
2. we might be starting or continuing that task so figure out where we are in that process
3. go towards finishing the task by solving one problem and solving it well
4. document as you do things for the next agent to be able to dive gradually into what you did,
   what you learned, not repeat the same mistakes
5. if the task is finished and would like to notify the human or you're dead stuck and need a
   human to intervene, delete the .task-lock file
```
