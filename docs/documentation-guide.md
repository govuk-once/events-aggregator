# Documentation Guide

Standards for writing documentation in this repository.

---

## Principles

1. **Keep READMEs lean.** Summarise what something does and link to a deeper guide rather than repeating it.
2. **Use plain English.** Avoid jargon. Define acronyms (UNS, FIFO, DLQ, mTLS) the first time they appear in a document.
3. **Show, don't tell.** Prefer a real code snippet with a real file path over a long prose description.
4. **Be consistent.** Follow the templates below rather than inventing a new structure for each document.

### Code block conventions

- Always include a language identifier (`typescript`, `bash`, `json`, `yaml`, `text`).
- Use `text` for directory trees and CLI output.
- Prefer real snippets copied from the repository over invented examples. If a snippet is illustrative rather than real code, say so.

### Formatting

- Use `---` dividers between major sections.
- Use tables for structured, scannable data such as environment variables, alarm thresholds and commands.
- Use blockquotes (`>`) for asides and warnings that would otherwise interrupt the main flow.
- Use **bold** sparingly, only for terms that carry real weight.
- Prefer sentences to bullet points in prose. Keep bullets for items that are genuinely parallel.

> `docs/` and `README.md` are listed in [`.prettierignore`](/.prettierignore), so `pnpm run format:check` does not format markdown. Keep tables aligned by hand or with your editor.

---

## Where documentation lives

This repository has one `package.json` and one CDK app. Documentation is organised as follows:

| Content type                                         | Location                                       |
| ---------------------------------------------------- | ---------------------------------------------- |
| Cross-cutting guides and architecture                | [`docs/*.md`](.)                               |
| Operational runbooks                                 | [`docs/runbooks/*.md`](./runbooks/README.md)   |
| Conventions for one directory (naming, test setup)   | `README.md` colocated in that directory        |
| Per-Lambda behaviour                                 | `src/<lambda>/README.md`                       |
| Guidance for AI coding assistants                    | [`CLAUDE.md`](/CLAUDE.md)                      |

Every Lambda directory and `src/` itself has a colocated README. Check for one before adding another.

Don't copy a colocated README into a `docs/*.md` guide. Link to it instead. A `docs/*.md` guide explains the *why* and *how it fits together*. A colocated `README.md` explains the *conventions for files in this directory*.

---

## Templates

### A new `docs/*.md` guide

Start with a title and a one-sentence statement of what the guide covers and who it's for. Follow it with an **Overview** (a short table or paragraph), then the main sections, grounded in real file paths. End with a **Related** list of guides and code. Separate sections with `---`.

### A colocated directory `README.md`

Use this for conventions specific to the files in one directory. Keep it short: a page, not a guide. State the convention, give one real example, and link to a `docs/*.md` guide for anything that needs more explanation.

### A per-Lambda `README.md`

Every Lambda directory under `src/` has one, with these sections:

- **Summary.** One or two sentences on what the Lambda does.
- **Trigger, function name**, taken from [`events-aggregator-stack.ts`](/cdk/stacks/events-aggregator-stack.ts).
- **Sample event.** A realistic input event.
- **Infrastructure.** Every AWS resource it reads from or writes to.
- **Logic.** A `mermaid` sequence diagram of the request flow.
- **Failure behaviour.** What happens when it throws: retries, DLQ, or dropped.

### A runbook

See [`docs/runbooks/README.md`](./runbooks/README.md) for the runbook template and index.

---

## Keeping docs true

Every alarm name, threshold, resource name, SSM key and workflow mentioned in `docs/` must be traceable to code. When you change any of the following, update the documents listed next to it in the same PR:

| If you change                                                                                        | Also update                                                                                        |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [`StandardServiceAlarmsFactory.ts`](/cdk/cdk_constructs/StandardServiceAlarmsFactory.ts)             | [Infrastructure Development Guide: alarms](./infrastructure-development.md#cloudwatch-alarms) and every runbook |
| [`events-aggregator-stack.ts`](/cdk/stacks/events-aggregator-stack.ts)                               | [Architecture](./architecture.md) and the affected `src/<lambda>/README.md`                       |
| [`cdk.predeploy.ssm.ts`](/cdk/cdk.predeploy.ssm.ts)                                                  | [Infrastructure Development Guide: SSM parameters](./infrastructure-development.md#ssm-parameters) |
| [`.github/workflows/*`](/.github/workflows)                                                          | [Deployment Guide](./deployment.md)                                                                |
| [`.releaserc`](/.releaserc)                                                                          | [Releases and Versioning](./releases.md)                                                           |

---

## Related

**The GDS Way:**

- [README Guidance](https://gds-way.digital.cabinet-office.gov.uk/manuals/readme-guidance.html)
- [Writing for GOV.UK](https://www.gov.uk/guidance/content-design/writing-for-gov-uk)
