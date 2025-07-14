# Requirements and Question/Answer Reference

This document lists all the requirements (R1-R16) and question/answer pairs (Q1-Q20) from the original conversation that guided the multi-task terminal system implementation. These numbers are referenced in the logging throughout the codebase for traceability.

## Requirements (R1-R16)

**R1**: At first empty canvas - auto-create empty tasks when needed
**R2**: I type my prompt, canvas is still marked as prompting - allow prompt editing in prompting state
**R3**: As my prompt becomes too large for the container it wraps. The size of the text area always adapts to new lines or wraps to become larger so it never has its own scrollbar
**R4**: As I type the prompt a "start" button at the right of the task appears - button visibility based on task state
**R5**: I press it, a terminal with a running claude code agent launches on the right and opens claude - launch new terminal or queue in existing
**R6**: Bypasses any screen that asks for "1. Yes" and as soon as the prompt appears types my prompt and presses enter to launch it
**R7**: At any point I can hide the terminal with a button at the intersection of the terminal and the canvas, maximize it with a floating button at the top right
**R8**: With floating buttons on the bottom right of the terminal I can either pause (sends escape), if paused resume (sends a "continue" prompt and then enter)
**R9**: The terminal and claude is never shut down even if the task is paused or the terminal is not responding - persistent terminal
**R10**: To complete the task I have to press a "commit" positive floating button right to the pause/resume stuff - manual commit only
**R11**: While the task was running I was not able to modify the prompt of the task but I was able to write one or more other tasks below it on the canvas
**R12**: On any task I can click a button right to it "start" when no task is running, and an additional one "stop, commit and start" right to it when a task is running
**R13**: The "stop, commit and start" button interrupts claude with the same sequence as pause, marks the previous task as complete, commits, and sends the prompt then enter to the terminal and that new tasks marks as running
**R14**: In the event no agent is running and also no terminal with claude from a previous task is still there, we have to launch the terminal and claude code like we did for the first task
**R15**: When opening a canvas it should be like now, marking as failed all the tasks that were running but their terminal got killed, but more importantly it should also git stash
**R16**: The revert and restore features still work as expected

## Question/Answer Pairs (Q1-Q20)

**Q1**: Task Fusion Scope - When you say "fusions the prompts" for commit - should this include all tasks started since the last commit, or just the currently queued/running tasks?
**Answer**: All the currently running tasks yes, which means all the ones we typed the prompt in claude code, the other remain as individual "prompting" state tasks that you can still launch later, and already completed/failed tasks well remain like they are too

**Q2**: Terminal Persistence Boundary - Should the terminal persist across canvas switches, or only within the same canvas session?
**Answer**: It should totally persist across canvas switch/reload and project switch. it only does not persist if in rust on the custom terminal manager the connections are cleared which implies a full restart of the app I think

**Q3**: Pause State Visualization - How should paused tasks be visually distinguished from running tasks in the UI?
**Answer**: Up to you, do something simple because I'll edit styles later. to minimize changes I have to make take inspiration from existing styles

**Q4**: Multiple Running Tasks - Can multiple tasks be "running" simultaneously (queued in Claude Code), or should starting a new task always require stopping the previous one first?
**Answer**: No as I said you have either "start" or "stop, commit and start" buttons, the first one is always available, the second one only when a task is running. start sends the prompt without interrupting claude code, which effectively queues it in claude code

**Q5**: Default Task Creation - When should new empty tasks be auto-created?
**Answer**: Yes good point, always have 1 new task with no prompt ready whenever all the other tasks at least have a prompt, this removes the need for a new task button

**Q6**: Terminal Control Permissions - Should terminal controls (pause/resume) be available when tasks are queued but not actively being processed by Claude?
**Answer**: If the terminal is idle (means it was launched for a task, that task was marked as complete, and now nothing is running) remove the pause/resume buttons (and of course the "commit/complete" button)

**Q7**: Commit Button Behavior - Should the commit button be available when tasks are paused, or only when actively running?
**Answer**: Answered in Q6

**Q8**: Escape Sequence Timeout - What should happen if the escape sequence fails to interrupt after maximum attempts?
**Answer**: No timeout or max retries, we'll assume the user will eventually quit in a rare infinite retries case which will kill the terminal

**Q9**: Git Stash Naming - What naming convention should we use for automatic git stashes when tasks fail?
**Answer**: We will never want to restore that stash so go with defaults, like actually just run "git stash"

**Q10**: Canvas Lock Granularity - Should individual tasks be lockable independently, or is canvas-level locking sufficient for the new multi-task system?
**Answer**: So we had previously this mechanic of canvas locking: locking when a task is running (this obviously is not wanted anymore), locking when the canvas is merging (still important, we can't add tasks/launch tasks while merging), locking when the canvas is merged (same as merging)

**Q11**: Task Fusion and Cleanup - When we fusion multiple running tasks into one commit and complete them, do the individual running tasks get deleted/removed from the UI entirely?
**Answer**: The fusioned tasks disappear from the data model (and therefore the UI) as if they never existed, in place (at the same position as the first fusioned task) in the list of tasks a new task with all their prompts concatenated as a single prompt is created

**Q12**: Cross-Canvas Terminal Persistence - Since the terminal persists across canvas/project switches, what happens when we switch to a canvas in a different working directory?
**Answer**: What happens currently is that each canvas has its own task manager and processes and switching that already works well and the UI understands to show one terminal or the other, no special action needs to be done

**Q13**: Task State Transitions - Does a task become "running" immediately when we click Start (prompt gets sent), or only when Claude actually begins processing it?
**Answer**: Task running = we sent the entire prompt to the terminal and sent enter

**Q14**: Stop, Commit & Start Sequence - For the "stop, commit and start" button, what's the exact sequence?
**Answer**: Yes your assumption about the order is good in 1). don't forget my note on interrupting (sending escape for interrupting often does not work, you have to send escape until what you see is one like contains "⎿ Interrupted by user" and another line contains the classic prompt "| > ", only then you can confirm it is interrupted and go do something else that depends on that interruption.)

**Q15**: Auto-Task Creation Timing - Should the empty task be created immediately when opening a canvas with no tasks?
**Answer**: We create a new task whenever there is no more task that is not paused, running or finished or failed and which has an empty prompt

**Q16**: Terminal State UI Persistence - Should these settings persist across canvas switches?
**Answer**: See my comment above on terminal persistence

**Q17**: Commit Message Strategy - When fusing multiple task prompts into one commit, should the commit message be all prompts concatenated with separators?
**Answer**: Yes since it will create a new task you just commit this new fusioned task the same way you would any other completed task (should be the same code) don't truncate

**Q18**: Error Handling Edge Cases - What if Claude Code crashes while tasks are running?
**Answer**: Yes for each running task assign the same terminal or process if (idk see how its done currently) so if the terminal is killed in any way it marks them all as failed

**Q19**: Canvas Locking Granularity - Should we prevent starting new tasks during merge operations?
**Answer**: Locking means we can't prompt and launch tasks. if a new empty task has to be created automatically, let it be because this lock is fully UX. also lock the terminal since it doesn't close now when all tasks are finished

**Q20**: Terminal Working Directory Sync - Since terminal persists across contexts, should we automatically sync the terminal's working directory when switching canvases?
**Answer**: See my previous notes on terminal persistence

## Additional Notes

- **Escape Sequence Detection**: Must wait for both "⎿ Interrupted by user" AND "| >" prompt before considering interruption successful
- **Terminal Persistence**: Survives canvas switches, project switches, and app restarts (unless full app restart clears terminal connections)
- **Task Fusion**: Uses separator `\n\n---\n\n` when concatenating prompts
- **Git Stash**: Uses default `git stash` command without custom naming
- **Auto-resize**: Text areas expand based on content, never show scrollbars
- **Manual Control**: No automatic timeouts, all task completion is manual via commit button