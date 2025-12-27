# Building My Personal AI Work Assistant with Claude Code

As a DevOps Engineer, I juggle multiple tools daily - JIRA for work tracking, Taskwarrior for personal todos, and Obsidian for detailed notes. Context switching between these systems was eating into my productivity. So I built [nikk-assistant](https://github.com/ndp190/nikk-assistant), a Claude Code assistant with prebuilt commands to assist me in managing my workday.

## The Problem

My task inspecting workflow involved:
- Opening JIRA to check ticket status
- Create Taskwarrior task for quick work entry
- Create Obsidian notes if the task is complex and need a detailed write-up
- Manually inspect my work status across all systems

Each context switch costs mental energy. I needed a single entry point.

## The Solution

nikk-assistant is a set of custom Claude Code commands that act as a bridge between my work management systems. Instead of visiting multiple tools, I interact with Claude, which orchestrates everything behind the scenes.

### Key Commands

**`/standup`** - My morning routine in one command. It:
- Queries Taskwarrior for completed and pending tasks
- Fetches my recent JIRA activity
- Pulls relevant Obsidian notes
- Generates a formatted standup summary

**`/todo`** - A unified view of all my pending work across systems. In-progress items appear first, followed by to-do items, with duplicates automatically filtered out.

**`/jira <ticket>`** - Fetches ticket details including status, description, and recent comments. If I have Obsidian notes linked to the ticket, those appear too.

**`/add-task`** and **`/add-jira-task`** - Create tasks that sync across systems with proper tagging.

## Tech Stack

- **Claude Code** - The AI assistant framework
- **MCP (Model Context Protocol)** - For Atlassian/JIRA integration
- **Taskwarrior** - Local CLI task management
- **Obsidian** - Note-taking (synced via iCloud)
- **Bash** - Gluing everything together

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

1. **Start small** - I built one command at a time, starting with `/standup`
2. **MCP is powerful** - The Atlassian MCP integration made JIRA access trivial
3. **Claude Code is flexible** - Custom commands let you extend Claude in ways I hadn't imagined

## What can be improved

- Assist in more areas in my workflow
- Making it AI platform agnostic

If you're drowning in tools, consider building your own assistant configuration. Claude Code makes it surprisingly straightforward.
