export interface AgentTip {
  catchphrase: string;
  title: string;
  body: string;
}

export const agentTips: AgentTip[] = [
  {
    catchphrase: "Share agents with your team",
    title: "Agent Sharing",
    body: `
Share agents with other people to collaborate on your work.

When you share an agent, others will be able to:
- Read the entire conversation history
- View the diff of all changes
- Fork the agent to create their own variant

To share an agent, go to the list of agents on the left, click on **"..."** and select **"Share"**.
    `.trim()
  },
  {
    catchphrase: "Try multiple approaches by forking",
    title: "Agent Forking",
    body: `
Fork agents to experiment with different approaches to the same problem.

Forking creates a new agent with:
- The exact same chat history
- All the code and commits
- A new branch for the forked agent
- A fresh computer instance

This is perfect for trying multiple variants on a feature without affecting your original work.

To fork an agent, go to the list of agents on the left, click on **"..."** and select **"Fork"**.
    `.trim()
  },
  {
    catchphrase: "Delay auto-shutdown for long-running servers",
    title: "Auto-Shutdown Control",
    body: `
Agent computers automatically shut down after a period of inactivity to save resources.

**What happens on shutdown:**
- You can **Resume** the agent, which continues it on a new machine
- All code and git history is preserved

**Keep the same machine running:**

If you're hosting something on the agent (like a dev server) and need it to stay on the same machine, click the **clock icon** in the top-left of the chat to delay when it will shutdown.
    `.trim()
  },
  {
    catchphrase: "Be specific for better results",
    title: "Writing Effective Prompts",
    body: `
The more precise and specific you are with your instructions, the better the agent will perform.

**Tips for great prompts:**
- Write multiple lines or paragraphs if needed
- Reference specific code, files, or line numbers
- Include examples of what you want
- Explain the context and reasoning

**Pro tip:** You can put the prompt input in full screen mode using the button at the bottom-left of the input area for easier editing of longer prompts.
    `.trim()
  },
  {
    catchphrase: "Ultrathink mode for complex tasks",
    title: "Ultrathink Mode",
    body: `
Ultrathink mode makes the agent spend more time thinking through complex problems.

**When to use it:**
- Complex architectural decisions
- Debugging tricky issues
- Refactoring large codebases
- Planning multi-step implementations

**Trade-off:** Consumes more time and computation, but can significantly improve results for challenging tasks that benefit from deeper reasoning.
    `.trim()
  },
  {
    catchphrase: "Plan mode for questions and strategy",
    title: "Plan Mode",
    body: `
Plan mode tells the agent to analyze and strategize without modifying any files.

**Perfect for:**
- Getting answers to questions about your code
- Exploring different approaches before committing
- Understanding complex systems
- Planning implementation strategies

The agent will provide detailed explanations and plans without making any changes to your codebase.
    `.trim()
  },
  {
    catchphrase: "Web search for latest information",
    title: "Web Search Mode",
    body: `
Web search mode allows the agent to search the web for up-to-date information.

**Use cases:**
- Finding latest API documentation
- Looking up current best practices
- Searching for solutions to specific errors
- Getting information about new libraries or tools

**Security note:** Be careful with what the agent does after searching, as like any AI, it might inadvertently fall for prompt-injection attacks on third-party websites beyond our control.
    `.trim()
  },
  {
    catchphrase: "Use GitHub commands directly",
    title: "Git & GitHub Integration",
    body: `
You can ask the agent to perform any git or GitHub operations directly.

**Available commands:**
- \`git\` - Standard git commands for version control
- \`gh\` - GitHub CLI for creating PRs, issues, etc.

The agent has the same GitHub access you granted during setup, so it can:
- Commit changes
- Create and manage branches
- Open pull requests
- Manage issues and reviews

Just ask naturally, like "create a PR for this work" or "commit these changes".
    `.trim()
  },
  {
    catchphrase: "Run code with built-in tools",
    title: "Code Execution",
    body: `
The agent's computer comes ready to run your code.

**Pre-installed:**
- Most popular programming languages
- Docker for containerized applications
- Common development tools

**For secrets and configuration:**

Use the **secrets & scripts menu** on the bottom-left to add environment variables, API keys, and startup scripts.

**Network access:**

If your code hosts something on localhost:
- **Desktop:** Enable port forwarding in the network tab (top right)
- **Web/Mobile:** Open the network to the public to access it from anywhere or share with others
    `.trim()
  },
  {
    catchphrase: "Continue on web and mobile",
    title: "Cross-Platform Access",
    body: `
Your agents are accessible from anywhere.

You can seamlessly continue your work:
- In the web browser
- On mobile devices
- On different computers

Just login with the same account and all your agents, conversations, and code will be available.
    `.trim()
  }
];
