---
description: Schedule recurring work in an agent or Quick Chat.
---

# Automations

Automations send a prompt on a schedule. Use them for a daily project summary, a weekly dependency check, or another task you want an agent to repeat. You can continue an existing conversation or start a fresh Quick Chat for each run.

## Create an automation

1. Open **Automations** from the left rail. Choose **Local** or a connected remote host.
2. Select **New automation** and give it a name.
3. Write the prompt the agent should receive each time.
4. Under **Run in**, choose a team and conversation:
   - **Existing agent** runs in that agent's folder or worktree, with its conversation context.
   - **Existing Quick Chat** continues a chat you already use.
   - **New Quick Chat each run** starts with fresh context. Choose its coding engine, model, and reasoning effort, or leave the model and effort at their defaults.
5. Set the schedule, check **Next run**, and select **Save automation**.

Existing conversations keep their model and permissions. A new Quick Chat needs enough information in the prompt to find the project or service you want it to use. GitHub, GitLab, and Linear are only needed if the task uses them.

For example, schedule this prompt in a repository agent:

```text
Summarize this repository's commits from the past week. Group them
by feature, fix, and documentation. Flag any follow-up work mentioned
in the commits. Do not change files.
```

The first scheduled run starts at the next occurrence, not when you save. Use the play button to try an enabled automation immediately.

## Create one from chat

You can ask an agent or Quick Chat to set up the schedule for you:

```text
Every weekday at 9 AM Chicago time, use this conversation to check
the project's open pull requests and summarize which need my review.
Do not change files or post comments.
```

Say what should happen, when it should run, and which conversation to use. To keep runs separate, ask for a new Quick Chat each time. Open **Automations** to check or change the resulting prompt and schedule.

## Choose a schedule

- **Daily**, **Weekdays**, or **Weekly** runs at a chosen time.
- **Custom** supports patterns such as every two days, selected weekdays, or a day of the month.
- **Interval** repeats every set number of minutes or hours.

New calendar schedules use your local timezone and keep the same local time across daylight-saving changes. Existing schedules retain their saved timezone. Check **Next run**, especially when scheduling work on a remote computer. To use a specific timezone, include it when asking an agent to create the automation.

The computer running the automation must be awake, with Korus running or [kept ready in the background](../troubleshooting/faq#can-work-continue-after-i-close-the-desktop-app). If it misses several scheduled runs, Korus runs the task once when it can resume, rather than repeating every missed run.

## Check the result

Open **View logs** to see each run's conversation, start time, duration, and status. Use the conversation icon beside an entry to read its messages.

- **Working** means the agent is still responding.
- **Needs input** means you need to open the agent or Quick Chat and answer a question or approval request.
- **Completed** means the agent finished its response. Read it to see what was done and whether any follow-up remains.
- **Failed** includes an error to help you decide what to retry or change.

An automation waits if its conversation is busy; it does not interrupt your work or start overlapping runs. Remote automations use the accounts and tools available on the remote computer.

Be explicit about whether the agent may edit files, commit, or publish. Scheduling a prompt does not give it extra permissions.

## Change or stop an automation

Edit the automation to change its prompt, conversation, or schedule. Use the switch in the list to turn it off or on; switching it off stops future runs. This does not stop a run already in progress; interrupt that work from its conversation if needed.

Deleting an automation removes its schedule, not its conversations or worktrees. **Clear** in the log removes finished entries and keeps active runs.

If a run fails, check its error and the selected conversation. Reconnect the coding engine if needed. If you close the agent, Quick Chat, or team an automation runs in, Korus switches the automation off and ends any run in progress. Edit it to choose another conversation, then switch it back on.
