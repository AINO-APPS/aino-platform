# 03: Project roles and member management

**What to build:** a project admin can give a person or a whole team the project admin, member or viewer role, change it and remove it from project settings on the web. When someone has a personal grant and a team grant, the higher one applies. A team can hold grants on any number of projects; it is never tied to one. A team lead or above can create a project and give one or more teams access as they create it, and the creator becomes project admin. Visibility doesn't use roles yet; that comes in ticket 06.

**Blocked by:** 01

**Status:** ready-for-agent

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017.

- [ ] **The project access module** is a new deep module in the tasks area, with its SQL in a repository. It is resolved once per request and returns:
  - the actor's effective role in a project: the highest of their personal grant and the grants of every team they belong to, with org admins (super admin, HR admin, platform admin) treated as project admin;
  - the set of projects the actor can access;
  - whether an action is allowed by role.
- [ ] **The members API** on the projects resource lists, grants, changes and removes grants:
  - Only project admins and org admins can change grants.
  - Granting a role that already exists updates it.
  - Removing or downgrading the last project admin is refused.
- [ ] **Creating a project:**
  - Needs team lead or above (it was manager).
  - The request can grant member access to one or more teams.
  - The creator becomes project admin.
- [ ] **The Members section in web project settings:** pick a user or a team, choose the role, and change or remove grants. Controls are hidden when the actor doesn't have the project-level `canManageMembers` capability.
- [ ] **Project responses carry the project-level `canAdminister` and `canManageMembers` capabilities.** The rest of the project-level capabilities come in ticket 07.
- [ ] **Unit and integration tests for the access module:** the effective role through a personal grant, through a team grant, the highest of several, and through membership of several teams across several projects; org admins; and an actor with no access.
- [ ] **Route test on real PostgreSQL:** grant, change and remove; the last-admin guard; create needs team lead or above; teams granted at create time; and one team holding grants on two projects.
- [ ] **Web tests:** the Members section adds and removes user and team grants, and controls are hidden without the capability.
- [ ] **Contracts:** the route snapshot, route inventory and OpenAPI are updated, and parity checks pass.
