# 23: Task notification events

**What to build:** People are told about the five things that matter: being assigned a task, being added to a sprint, a sprint starting, a sprint completing with a summary of what moved, and a due date approaching. Nothing is emitted for status changes or reordering.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] All five events notify the relevant people
- [ ] The sprint-completion notification summarises what moved
- [ ] Status changes and reordering emit no notification
- [ ] Each notification deep-links to the task or sprint it concerns
- [ ] Notification payloads are validated by a contract test
