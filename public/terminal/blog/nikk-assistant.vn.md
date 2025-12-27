# Xây Dựng Trợ Lý AI Cá Nhân Với Claude Code

Là một Developer, việc liên tục thao tác và thuyển đổi ngữ cảnh giữa các hệ thống quản lý task (JIRA, Obsidian, Taskwarrior) làm giảm kha khá năng suất của mình. Vì vậy mình đã xây dựng [nikk-assistant](https://github.com/ndp190/nikk-assistant), một trợ lý Claude Code với các lệnh được xây dựng sẵn để hỗ trợ quản lý công việc hàng ngày.

## Vấn Đề

Quy trình kiểm tra công việc bao gồm:
- Mở JIRA để kiểm tra trạng thái ticket
- Tạo task Taskwarrior cho việc nhập nhanh trạng thái công việc
- Tạo ghi chú Obsidian nếu task phức tạp và cần note nhiều chi tiết
- Kiểm tra thủ công trạng thái công việc trên tất cả hệ thống

Mỗi lần chuyển đổi và thao tác trên các tools tốn khoảng 15-20 phút (tổng cho cả ngày). Mình cần một điểm thao tác duy nhất.

## Giải Pháp

[nikk-assistant](https://github.com/ndp190/nikk-assistant) là một tập hợp các lệnh Claude Code hoạt động như cầu nối giữa các hệ thống quản lý công việc của mình. Thay vì truy cập nhiều công cụ, chỉ cần tương tác với Claude, nó sẽ điều phối mọi thứ phía sau.

Mình chỉ cần one shot Claude Code với prompt sau:

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

### Các Lệnh Chính

**`/standup`** - Routine buổi sáng trong một lệnh:
- Truy vấn Taskwarrior để lấy task đã hoàn thành và đang chờ
- Lấy hoạt động JIRA gần đây của tôi
- Lấy ghi chú Obsidian liên quan
- Tạo tóm tắt standup

**`/todo`** - Xem tất cả công việc đang chờ trên các hệ thống. Các work item in-progress xuất hiện trước, theo sau là các item to-do.

**`/jira <ticket>`** - Lấy chi tiết JIRA ticket bao gồm trạng thái, mô tả và comment gần đây. Nếu có ghi chú Obsidian & Taskwarrior liên kết với ticket, chúng cũng xuất hiện.

**`/add-task`** và **`/add-jira-task`** - Tạo task đồng bộ giữa các hệ thống với các tags phù hợp.

## Tech Stack

- **Claude Code** - Trợ lý AI, kết nối mọi thứ với nhau
- **MCP (Model Context Protocol)** - Để tích hợp Atlassian/JIRA
- **Taskwarrior** - Quản lý task CLI cục bộ
- **Obsidian** - App ghi chú

## Kiến Trúc

Thư mục dự án rất đơn giản:

```
nikk-assistant/
├── CLAUDE.md           # Cấu hình và hướng dẫn
├── .claude/
│   ├── settings.local.json  # Quyền cho MCP tools
│   └── commands/            # Định nghĩa lệnh tùy chỉnh
│       ├── standup.md
│       ├── todo.md
│       ├── jira.md
│       └── ...
```

Mỗi lệnh là một file markdown định nghĩa những gì Claude nên làm khi được gọi. Điều kỳ diệu xảy ra nhờ sự kết hợp giữa MCP và các lệnh shell mà Claude thực thi.

## Kết Quả

Những gì trước đây mất 15-20 phút mỗi ngày để thu thập ngữ cảnh giờ chỉ mất vài giây. Mình hỏi Claude về standup, nó tổng hợp mọi thứ, và sẵn sàng để chia sẻ với team.

Điều tuyệt nhất là mình không còn phải căng não nhập liệu tay và lấy thông tin trên từng hệ thống. Claude trở thành một giao diện chung cho mọi dữ liệu công việc.

Screenshot của lệnh `/standup`:
![Standup Command Screenshot](https://r2.nikkdev.com/blog/nikk-assistant-0.jpeg)

## Bài Học

1. **Bắt đầu nhỏ** - Sau prompt đầu tiên để tạo CLAUDE.md, mình tạo từng command một lúc, bắt đầu với command `/standup`
2. **MCP rất mạnh mẽ** - Tích hợp Atlassian MCP làm việc truy cập JIRA trở nên đơn giản
3. **Claude Code rất linh hoạt** - Các lệnh tùy chỉnh cho phép mở rộng Claude theo những cách tôi chưa tưởng tượng

## Có Thể Cải Thiện

- Thêm tính năng cho trợ lý để hỗ trợ nhiều lĩnh vực công việc hơn
- Update code để không bị phụ thuộc vào một nền tảng AI

Nếu bạn đang tốn nhiều thời gian để quản lý task cá nhân hãy cân nhắc xây dựng cấu hình trợ lý của riêng mình. Claude Code làm điều này trở nên đơn giản đến ngạc nhiên.
