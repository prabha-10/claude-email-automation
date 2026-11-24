---
name: start
description: Start EmailQA. If needed, it runs the first-run setup on this computer. It makes the folder Claude is opened in the workspace, picks the client, and goes on to building or testing an email. Triggers: the user runs /emailqa:start, asks to start or set up EmailQA, or names a new or existing client. Another trigger is an EmailQA step that reports missing setup or no workspace.
---

# Start EmailQA

The folder Claude is opened in is the EmailQA workspace. Client projects go in it, one folder per client under `clients/`. EmailQA runs on macOS and Windows. Never ask for or print API keys or passwords, and never ask the user to paste a key into the chat.

## Ask less, do more

The goal is more finished emails in less time. Keep the flow moving:

- Never ask what a tool can tell you. Read it.
- If a sensible default exists, use it, say it in one line, and keep going. The user can correct you.
- If only the user knows a fact, ask for it. An example is a new client's name that nothing else gives. Ask also for actions that only the user can do, for example a login, the Figma bridge, or a plugin setting.
- Put your questions together in one message. For a choice, use AskUserQuestion with the recommended option first.

## 1. Setup

Call `setup_status` (email-build server).

- If the EmailQA tools are not available, go to [setup.md](setup.md) step 1.
- If the `workspace` check failed, call `create_workspace` with no path. Do not ask. It makes this session's folder the workspace and keeps the other files in it.
- If other checks failed, or `setup_done_on_this_computer` is false, follow [setup.md](setup.md) for the failed checks only. Then continue.

## 2. Pick the client

Call `list_clients`. Use the first rule that gives an answer, and do not ask:

1. The client that the user named. If it is not in the list, it is a new client.
2. The client whose Figma file is open in the bridge (`figma_list_open_files`, then `check_figma_file`).
3. The only client in the workspace.

If no rule gives an answer, ask once. Give up to 4 clients from `list_clients` as options (most emails first) and "New client".

If the user gives an old Email Template Tester project (a folder with `pipeline.json`), call `import_old_project`. It copies the project into the workspace and does not change the old folder.

### New client

You need the client name and the Figma file URL.

- If one Figma file is open in the bridge, use its URL. Take the client name from the user's message or from the file name, and say which name you used.
- If no file is open, ask for both in one message. A Litmus folder test address is optional.

Call `new_client`. In one line, tell the user where the client folder is.

Do not record the client's Klaviyo account now. The handoff-email skill records it at the first handoff.

### Existing client

Call `list_emails` for the client. Show the emails in a short table: version, last test, and test values left.

## 3. Continue

Go on with what the user asked for. If the user only ran /emailqa:start:

- If a frame is selected in Figma, build it with the build-email skill.
- If no frame is selected, ask "What do you want to do?" with these options:
  - "Build a new email from Figma"
  - "Change or rebuild an email"
  - "Test an email in Klaviyo and Litmus"
  - "Hand off a signed-off email to the client's Klaviyo"

Give every EmailQA tool the client folder name (`client`) and the email path (`email`). An example email path is `black-friday/teaser`.
