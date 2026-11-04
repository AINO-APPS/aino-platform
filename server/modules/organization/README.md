# Organization module

Team queries used by the organization routes. `teamListing` owns the read
queries for the team pickers and the admin team list; `teamOwnership` owns the
delete guard (a team that still owns tickets or sprints cannot be deleted) and
the member-detach step.

`serviceDeskProject` validates that a Service Desk destination is an active
project in the same organization. Organization settings accept a project id or
null (General fallback); omitting the field preserves the existing setting.
