# User guide

What each role can do in the Test Case Management System, and the rules that apply to everyone. The rules
are enforced by the server: the UI hides buttons you can't use, but the server checks every request again.

Every role can open the analytics dashboard. It counts results, coverage, defects and the trend across the
projects you can see (an admin: every project), or one of them.

## Getting started (every role)

1. **An admin invites you.** There is no self-registration. You get an email with a link to set your
   password. The link works once and expires after 72 hours; if it expired, ask an admin to send a new one.
2. **Choose a password** on that page: 8 characters minimum. Then sign in with your email and that password.
3. **Your session lasts 1 hour**, then you sign in again. Signing out ends the session in your browser.

Good to know:

- **Forgotten password:** there is no self-service reset or change yet. Ask an admin.
- **Deactivated account:** if an admin deactivates you, you are signed out on your next action. You can't
  sign in until you are reactivated.
- **Role changes** apply immediately, on your next action.
- **"Too many requests":** to stop abuse, the server limits how often something can be done — 5 sign-in
  attempts per 15 minutes from one network, and per person per hour: 100 test case requests, 200 test execution
  requests, 50 dashboard loads. When you hit a limit, wait the time the message gives.
- **Trying the demo:** the demo site has one login per role (`admin@`, `lead@`, `tester@`, `tester2@`,
  `readonly@tcms-demo.example`). Whoever runs the demo gives you the password.

## Projects and membership

All work happens inside a project: test cases, suites, executions, defects and attachments belong to one
project.

- **Admins see every project.**
- **Everyone else sees only the projects they are a member of.** To you, any other project doesn't exist:
  opening its link shows "not found", the same as a deleted project.
- A project's team is set when it is created or edited. A test lead who creates or edits a project always
  stays on its team, so they can't lock themselves out.
- **Lists are sorted by name (or title), A to Z:** projects, users, roles, test suites, test cases, executions
  (by test case title), team members and attachments. Most lists let you change the order. A few keep their own
  order: the test cases of a suite (the order you set), steps, the audit trail, and a suite's runs (newest first).

## What each role can do

| | Admin | Test lead | Tester | Read-only |
| --- | :-: | :-: | :-: | :-: |
| **Users:** invite, edit, change role, deactivate/reactivate, re-send an invitation | ✓ | | | |
| **Projects:** view | all | own | own | own |
| **Projects:** create; edit details and team | ✓ | own | | |
| **Projects:** delete (only when empty) | ✓ | | | |
| **Test cases and suites:** view | ✓ | ✓ | ✓ | ✓ |
| **Test cases and suites:** create, edit, delete, bulk actions, reorder a suite | ✓ | ✓ | | |
| **Executions:** view the queue, history, progress and suite reports | ✓ | ✓ | ✓ | ✓ |
| **Executions:** record results, run a test case or a suite yourself | ✓ | ✓ | ✓ | |
| **Executions:** assign test cases to testers; run a suite for someone else | ✓ | ✓ | | |
| **Defects:** view | ✓ | ✓ | ✓ | ✓ |
| **Defects:** create from a failed execution | ✓ | ✓ | ✓ | |
| **Attachments:** download | ✓ | ✓ | ✓ | ✓ |
| **Attachments:** upload | ✓ | ✓ | ✓ | |

"Own" means projects you are a member of. Test leads, testers and read-only users can do the things in this
table only inside their own projects.

### Admin

Admins have full access to every project and are the only role that manages users.

**Inviting someone:**

- Give their first name, email and role; the last name is optional.
- They receive the set-password email and show as **Invited** until they set a password.
- If the email couldn't be sent, the user is still saved: use **Resend invitation**.
- Changing an invited user's email sends the invitation to the new address.

**Deactivating a user:**

- It signs them out on their next action and cancels a pending invitation.
- Reactivating a user who never set a password makes them **Invited** again.
- Users are deactivated, never deleted, so their name stays on the history they created.

**You can't change your own role or status.** This keeps an admin from locking themselves out, or
promoting themselves.

**Deleting a project:**

- Only an empty project can be deleted: one with no test cases, suites or execution history. Its team goes
  with it.
- A project with content can't be deleted, so its history is never lost. Set its status to **Archived**
  instead.

### Test lead

Test leads design and organize the testing for their projects.

- **Projects:** create projects, and edit the details and team of projects you are a member of.
- **Test cases:**
  - Each has a title, description, priority, type, pre- and post-conditions, tags, and at least one step
    with its expected result.
  - Tags are stored in lowercase.
  - Saving a test case replaces all its steps and suites with what the form shows.
- **Bulk actions:** select up to 100 test cases, then delete them, change their priority, or add them to a
  suite. It's all or nothing: if any selected case is no longer valid, nothing changes.
- **Suites:**
  - Suite names are unique within a project, ignoring case.
  - Adding test cases puts them at the end of the suite. You can reorder them at any time.
  - Removing a case from a suite, or deleting a whole suite, never deletes the test cases.
- **Assigning work:** assign test cases to a tester of the project, or run a whole suite and assign it to
  someone. The assignee must be an active member of the project who can execute tests. A test case that
  already has pending work is skipped.
- **Running tests** works as for testers (below).

### Tester

Testers execute tests and report what they find.

- **Your queue** lists pending executions; filter it to the ones assigned to you.
  - You may record any pending execution in your projects, not only the ones assigned to you.
  - The execution shows who it was assigned to and who actually ran it.
- **Recording a result:**
  - Choose **Pass**, **Fail**, **Blocked** or **Skipped**, and add a comment if useful.
  - You can also record a result per step. If any step failed, the overall result can't be Pass.
- **Results are final.** Once recorded, a result can't be edited; to correct it, run the test again, which
  creates a new execution. If two people record the same execution at once, only the first one is saved.
- **Running without an assignment:** run any test case of your project directly, or run a whole suite for
  yourself. You can't assign work to other people.
- **Defects:** from a **failed** execution, create one defect: title, description, and severity (Low,
  Medium, High, Critical). An execution can have only one defect.
- **Attachments:**
  - Add screenshots, logs or documents to an execution after its result is recorded.
  - Up to 5 files at a time, 10 MB each.
  - Allowed types: PNG, JPG, GIF, PDF, TXT, LOG and CSV.
  - The server checks what a file really contains, not its name. A renamed file of another type is refused.
  - Files always download as files; they never open inside the app.

### Read-only

Read-only users follow the work without changing it. In their projects, they can view:

- test cases and suites;
- the execution queue, history and audit trail;
- suite reports and defects.

They can also download attachments. Every button that would change something is disabled for them, and the
server refuses the request anyway.

## History and audit trail

- **History stays as it happened.** Each execution keeps a copy of the test case title and steps as they were
  when it ran:
  - editing a test case later doesn't change past results;
  - deleting a test case keeps its executed history, marked as deleted, but removes its pending executions;
  - a suite run keeps the suite's name and results even after the suite is deleted.
- **Audit trail:** every execution records who created it, who recorded its result, and who added
  attachments or a defect, with the time of each.
- **History** for a test case lists all its executions; sort it by date to see the newest first.
