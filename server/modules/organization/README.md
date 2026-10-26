# Organization module

Team queries used by the organization routes. `teamListing` owns the read
queries for the team pickers and the admin team list; `teamOwnership` owns the
delete guard (a team that still owns tickets or sprints cannot be deleted) and
the member-detach step.
