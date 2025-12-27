# Building My Personal AI Work Assistant with Claude Code

As a Developer, I juggle multiple tools daily to manage my task: JIRA for work tracking, Taskwarrior for personal todos, and Obsidian for detailed notes. Context switching between these systems was eating into my productivity. So I built [nikk-assistant](https://github.com/ndp190/nikk-assistant), a Claude Code assistant with prebuilt commands to assist me in managing my workday.

## The Problem

My task inspecting workflow involved:
- Opening JIRA to check ticket status
- Create Taskwarrior task for quick work entry
- Create Obsidian notes if the task is complex and need a detailed write-up
- Manually inspect my work status across all systems

Each context switch costs mental energy. I needed a single entry point.

## The Solution

[nikk-assistant](https://github.com/ndp190/nikk-assistant) is a set of custom Claude Code commands that act as a bridge between my work management systems. Instead of visiting multiple tools, I interact with Claude, which orchestrates everything behind the scenes.

I just essentially one shot Claude Code with this prompt:

```markdown
Create a CLAUDE.md file at ~/.claude/CLAUDE.md for my work assistant setup.

## My Workflow

I work at Go1 as a technical/infrastructure role. My work tracking workflow:

1. **JIRA** (Atlassian) - Source of truth for all tickets. I have the Atlassian MCP connected. My team ticket is prefix with IT-[ticket-num], for example https://foo.atlassian.net/browse/IT-1234

2. **Taskwarrior** - Local CLI task manager. I use it to:
   - Track JIRA tickets locally for quick access
   - Log ad-hoc tasks that don't warrant a JIRA ticket
   - Tasks linked to JIRA should have tag format: +jira:PROJ-123
   - example task (with logs manually added by me)
    Name          Value
    ID            10
    Description   IT-1234 Clean up current AWS IAM users groups access
                    2025-11-11 08:46:34 A to review excel file
                    2025-11-20 16:08:20 Sent message for J on list of account that need to be audit
                    2025-11-21 11:42:04 TODO investigate on C client usage
    Status        Pending
    Project       Work
    Entered       2025-11-10 21:08:55 (6w)
    Last modified 2025-12-08 16:15:44 (2w)
    Virtual tags  ANNOTATED PENDING PROJECT READY UNBLOCKED
    UUID          12345678-90ab-cdef-1234-567890abcdef
    Urgency       2.252

3. **Obsidian** - Task notes at "Obsidian/Works"
   - Used as scratchpad and detailed journal for complex tasks
   - Not all tasks need an Obsidian note

## What I need from the assistant

- Generate standup reports (yesterday's work, today's plan, blockers)
- Show my todo list for the day
- Create Taskwarrior tasks from JIRA tickets
- Create ad-hoc tasks
- Generate end-of-day journals
- Weekly/sprint reports

## Include in CLAUDE.md

1. Context about my workflow and tools
2. File naming conventions for Obsidian notes
3. Taskwarrior tag conventions (especially jira linking)
4. Common Taskwarrior commands I'll need
5. Standup format template
6. My typical JIRA projects (you can search my accessible Atlassian resources to find which projects I have access to)
7. Instructions for the assistant on how to handle each type of request

First, search my Atlassian/JIRA to find:
- My JIRA projects I have access to
- My current open tickets to understand my work context

Then create a comprehensive CLAUDE.md that will help Claude Code assist me effectively with this workflow.
```

### Key Commands

**`/standup`** - My morning routine in one command. It:
- Queries Taskwarrior for completed and pending tasks
- Fetches my recent JIRA activity
- Pulls relevant Obsidian notes
- Generates a formatted standup summary

**`/todo`** - A unified view of all my pending work across systems. In-progress items appear first, followed by to-do items, with duplicates automatically filtered out.

**`/jira <ticket>`** - Fetches ticket details including status, description, and recent comments. If I have Obsidian & Taskwarrior notes linked to the ticket, those appear too.

**`/add-task`** and **`/add-jira-task`** - Create tasks that sync across systems with proper tagging.

## Tech Stack

- **Claude Code** - The AI assistant framework, gluing everything together
- **MCP (Model Context Protocol)** - For Atlassian/JIRA integration
- **Taskwarrior** - Local CLI task management
- **Obsidian** - Note-taking

## Architecture

The project is simple:

```
nikk-assistant/
├── CLAUDE.md           # Configuration and guidelines
├── .claude/
│   ├── settings.local.json  # Permissions for MCP tools
│   └── commands/            # Custom command definitions
│       ├── standup.md
│       ├── todo.md
│       ├── jira.md
│       └── ...
```

Each command is a markdown file that defines what Claude should do when invoked. The magic happens through MCP integrations and shell commands that Claude executes.

## Results

What used to take 15-20 minutes of each day context-gathering now takes seconds. I ask Claude for my standup, it compiles everything, and I'm ready to share with my team.

The real win is cognitive load reduction. I no longer need to remember which system holds what information. Claude acts as my unified interface to all work data.

A screenshot of the `/standup` command in action:
![Standup Command Screenshot](https://r2.nikkdev.com/blog/nikk-assistant-0.jpeg)

## Lessons Learned

1. **Start small** - After prompt to create CLAUDE.md, I built one command at a time, starting with `/standup`
2. **MCP is powerful** - The Atlassian MCP integration made JIRA access trivial
3. **Claude Code is flexible** - Custom commands let you extend Claude in ways I hadn't imagined

## What can be improved

- Assist in more areas in my workflow
- Making it AI platform agnostic

If you're drowning in tools, consider building your own assistant configuration. Claude Code makes it surprisingly straightforward.
